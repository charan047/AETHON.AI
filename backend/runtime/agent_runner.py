from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from config import AVAILABLE_MODELS, settings
from sqlalchemy import select

from database.db import AsyncSessionLocal
from database.models import IntegrationType, UserIntegration
from runtime.tools import make_custom_tool
from services.business_context_service import BusinessContextService
from services.cost_tracker import cost_tracker
from services.integration_crypto import decrypt_config
from services.reputation_service import ReputationService
from services.telemetry_service import telemetry_service
from tools.registry import tool_registry

logger = logging.getLogger(__name__)

KNOWN_MODEL_IDS = {model["id"] for model in AVAILABLE_MODELS}
FINAL_ANSWER_INSTRUCTION = (
    "When you have gathered enough information, stop using tools and write your final answer directly."
)


def _extract_text(content) -> str:
    """Handles str, list-of-dicts, or any other content shape."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content)


def build_llm(model: str, temperature: float = 0.7, max_tokens: int = 2000):
    is_ollama = model.startswith("ollama/")
    # Strip "ollama/" prefix — the base_url already points at the right server
    actual_model = model.removeprefix("ollama/")

    kwargs: dict = {
        "model": actual_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "api_key": settings.openai_compatible_api_key or "ollama",
    }
    if settings.openai_compatible_base_url:
        kwargs["base_url"] = settings.openai_compatible_base_url

    # Disable parallel tool calls for hosted APIs — some open-source models mangle
    # the tool name when calling multiple tools simultaneously. Ollama ignores/rejects it.
    if not is_ollama:
        kwargs["model_kwargs"] = {"parallel_tool_calls": False}

    return ChatOpenAI(**kwargs)


class AgentRunner:
    def __init__(
        self,
        agent_config,
        custom_tool_defs=None,
        memory_service=None,
        memory_config=None,
        business_context_service=None,
        reputation_service=None,
    ):
        self.config = agent_config
        self.custom_tool_defs = custom_tool_defs or []
        self.memory_service = memory_service
        self.business_context_service = business_context_service or BusinessContextService()
        self.reputation_service = reputation_service or ReputationService()
        if self.memory_service is None:
            from services.memory_service import MemoryService

            self.memory_service = MemoryService()
        self.memory_config = memory_config
        model = agent_config.model
        if model not in KNOWN_MODEL_IDS:
            logger.warning(
                "Agent %r uses unknown model %r; falling back to default model %r",
                agent_config.name,
                model,
                settings.default_model,
            )
            model = settings.default_model
        self.llm = build_llm(
            model,
            agent_config.temperature,
            agent_config.max_tokens,
        )
        self.tool_ids = agent_config.tools or []
        self.tools = []

    @staticmethod
    def _extract_usage_tokens(meta) -> tuple[int, int, int]:
        if not isinstance(meta, dict):
            return 0, 0, 0
        input_tokens = (
            meta.get("input_tokens")
            or meta.get("prompt_tokens")
            or meta.get("input_token_count")
            or 0
        )
        output_tokens = (
            meta.get("output_tokens")
            or meta.get("completion_tokens")
            or meta.get("output_token_count")
            or 0
        )
        total_tokens = meta.get("total_tokens") or meta.get("total_token_count") or input_tokens + output_tokens
        if total_tokens and not (input_tokens or output_tokens):
            input_tokens = int(total_tokens * 0.6)
            output_tokens = int(total_tokens) - input_tokens
        return int(input_tokens or 0), int(output_tokens or 0), int(total_tokens or 0)

    def _build_graph(self, system_prompt: str | None):
        return create_react_agent(
            self.llm,
            tools=self.tools,
            checkpointer=MemorySaver(),
            prompt=system_prompt or None,
        )

    async def _build_runtime_tools(self, user_id: str | None, execution_id: str | None = None):
        tool_ids = list(self.tool_ids or [])
        if "notifications" not in tool_ids:
            tool_ids.append("notifications")
        custom_by_id = {tool_def.id: tool_def for tool_def in (self.custom_tool_defs or [])}
        custom_tools = [
            make_custom_tool(custom_by_id[tool_id])
            for tool_id in tool_ids
            if tool_id in custom_by_id
        ]
        registry_tool_ids = [tool_id for tool_id in tool_ids if tool_id not in custom_by_id]
        tool_context = {
            "_context": {
                "agent_id": self.config.id,
                "agent_name": self.config.name,
                "execution_id": execution_id,
            }
        }

        integrations_by_tool: dict[str, dict] = {}
        if not user_id:
            integrations_by_tool = {tool_id: dict(tool_context) for tool_id in registry_tool_ids}
            return await tool_registry.get_langchain_tools_for_agent(
                registry_tool_ids,
                user_id="system",
                integrations=integrations_by_tool,
            ) + custom_tools

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(UserIntegration).where(
                        UserIntegration.user_id == user_id,
                        UserIntegration.org_id == self.config.org_id,
                        UserIntegration.is_active == True,
                    )
                )
                integrations = result.scalars().all()
        except Exception as exc:
            logger.warning("Integration lookup failed for user %s: %s", user_id, exc)
            integrations = []

        for integration in integrations:
            try:
                config = decrypt_config(integration.config)
                if integration.integration_type == IntegrationType.github:
                    integrations_by_tool["github"] = config
                elif integration.integration_type == IntegrationType.email_smtp:
                    integrations_by_tool["email"] = config
                elif integration.integration_type == IntegrationType.slack:
                    integrations_by_tool["slack"] = config
            except Exception as exc:
                logger.warning("Failed to load integration tool %s: %s", integration.id, exc)

        for tool_id in registry_tool_ids:
            integrations_by_tool.setdefault(tool_id, {})
            integrations_by_tool[tool_id].update(tool_context)

        registry_tools = await tool_registry.get_langchain_tools_for_agent(
            registry_tool_ids,
            user_id=user_id,
            integrations=integrations_by_tool,
        )
        return registry_tools + custom_tools

    def _memory_enabled(self) -> bool:
        if not self.memory_service:
            return False
        if self.memory_config is None:
            return True
        return bool(getattr(self.memory_config, "memory_enabled", True))

    def _max_memories_per_query(self) -> int:
        if self.memory_config is None:
            return 5
        return int(getattr(self.memory_config, "max_memories_per_query", 5) or 5)

    def _memory_window_days(self) -> int | None:
        if self.memory_config is None:
            return 30
        value = getattr(self.memory_config, "memory_window_days", 30)
        return int(value) if value else None

    def _filter_memories_by_window(self, memories: list[dict]) -> list[dict]:
        window_days = self._memory_window_days()
        if not window_days:
            return memories

        cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
        filtered = []
        for memory in memories:
            timestamp = (memory.get("metadata") or {}).get("timestamp")
            if not timestamp:
                filtered.append(memory)
                continue
            try:
                parsed = datetime.fromisoformat(timestamp)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                if parsed >= cutoff:
                    filtered.append(memory)
            except ValueError:
                filtered.append(memory)
        return filtered

    async def _build_business_context(self, user_id: str | None) -> str:
        if not user_id:
            return ""

        try:
            async with AsyncSessionLocal() as db:
                return await self.business_context_service.get_context_for_agent(
                    user_id,
                    db,
                    org_id=getattr(self.config, "org_id", None),
                )
        except Exception as exc:
            logger.warning("Business context retrieval failed for user %s: %s", user_id, exc)
            return ""

    async def _build_learning_context(self) -> str:
        try:
            async with AsyncSessionLocal() as db:
                return await self.reputation_service.get_learning_context(self.config.id, db)
        except Exception as exc:
            logger.warning("Learning context retrieval failed for agent %s: %s", self.config.id, exc)
            return ""

    async def _build_enhanced_system_prompt(self, message: str, user_id: str | None = None) -> str:
        original_system_prompt = self.config.system_prompt or ""
        business_context = await self._build_business_context(user_id)
        learning_context = await self._build_learning_context()
        memory_context = ""

        if self._memory_enabled():
            try:
                memories = await self.memory_service.retrieve_relevant_memory(
                    agent_id=self.config.id,
                    query=message,
                    top_k=self._max_memories_per_query(),
                )
                memories = self._filter_memories_by_window(memories)
            except Exception as exc:
                logger.warning("Memory retrieval failed for agent %s: %s", self.config.id, exc)
                memories = []

            if memories:
                memory_context = (
                    "RELEVANT MEMORY FROM PAST INTERACTIONS:\n"
                    + "\n---\n".join(memory["content"] for memory in memories if memory.get("content"))
                )

        parts = [
            part
            for part in (
                business_context,
                memory_context,
                learning_context,
                original_system_prompt,
                FINAL_ANSWER_INSTRUCTION,
            )
            if part
        ]
        return "\n\n".join(parts)

    async def _store_conversation_memory(
        self,
        thread_id: str,
        input_message: str,
        agent_output: str,
        workflow_id: str | None,
        execution_id: str | None,
    ) -> None:
        if not self._memory_enabled():
            return

        metadata = {
            "workflow_id": workflow_id or "",
            "execution_id": execution_id or "",
        }
        try:
            await self.memory_service.store_memory(
                agent_id=self.config.id,
                session_id=thread_id,
                role="user",
                content=input_message,
                metadata=metadata,
            )
            await self.memory_service.store_memory(
                agent_id=self.config.id,
                session_id=thread_id,
                role="assistant",
                content=agent_output,
                metadata=metadata,
            )
        except Exception as exc:
            logger.warning("Memory storage failed for agent %s: %s", self.config.id, exc)

    async def _broadcast_retry_event(self, broadcast, event: dict) -> None:
        if broadcast:
            await broadcast(event)
            return

        try:
            from services.websocket_manager import ws_manager

            await ws_manager.broadcast(event)
        except Exception as exc:
            logger.warning("Retry event broadcast failed for agent %s: %s", self.config.id, exc)

    async def _invoke_agent(
        self,
        message: str,
        graph,
        config: dict,
        enhanced_system_prompt: str,
        broadcast=None,
        thread_id: str = "default",
        workflow_id: str | None = None,
        execution_id: str | None = None,
        user_id: str | None = None,
    ) -> tuple[str, int]:
        total_tokens = 0
        input_tokens = 0
        output_tokens = 0

        try:
            async for event in graph.astream_events(
                {"messages": [HumanMessage(content=message)]},
                config=config,
                version="v2",
            ):
                kind = event["event"]

                if kind == "on_chat_model_end":
                    output = event["data"].get("output")
                    if output and hasattr(output, "usage_metadata") and output.usage_metadata:
                        usage_input, usage_output, usage_total = self._extract_usage_tokens(output.usage_metadata)
                        input_tokens += usage_input
                        output_tokens += usage_output
                        total_tokens += usage_total

                elif kind == "on_tool_start":
                    if broadcast:
                        await broadcast({
                            "type": "tool_call",
                            "agent": self.config.name,
                            "agent_id": self.config.id,
                            "agent_name": self.config.name,
                            "tool": event["name"],
                            "input": str(event["data"].get("input", ""))[:200],
                        })

                elif kind == "on_tool_end":
                    if broadcast:
                        await broadcast({
                            "type": "tool_result",
                            "agent": self.config.name,
                            "agent_id": self.config.id,
                            "agent_name": self.config.name,
                            "tool": event["name"],
                            "output": str(event["data"].get("output", ""))[:300],
                        })

        except Exception as e:
            # Malformed tool-call names (model appends args to the name) produce a
            # validation error mid-stream. Recover by reading whatever state was saved.
            logger.warning(f"Agent stream error (recovering): {e}")

        # Read the latest graph state regardless of whether streaming finished cleanly
        try:
            state = await graph.aget_state(config)
        except Exception:
            state = None

        final_response = ""
        if state and state.values.get("messages"):
            msgs = state.values["messages"]
            # 1st pass: find the last AIMessage that has actual text content
            for msg in reversed(msgs):
                if isinstance(msg, AIMessage):
                    text = _extract_text(msg.content)
                    if text.strip():
                        final_response = text
                        break
            # 2nd pass: if the AI only produced a tool-call intent (empty text), fall back
            # to the tool results themselves so downstream agents have something to work with
            if not final_response:
                tool_outputs = [
                    _extract_text(msg.content)
                    for msg in msgs
                    if isinstance(msg, ToolMessage) and _extract_text(msg.content).strip()
                ]
                if tool_outputs:
                    final_response = "\n\n".join(tool_outputs)

        # Last resort: call the LLM directly without tools if we still have nothing
        fallback_error = None
        if not final_response:
            try:
                direct_msgs = []
                if enhanced_system_prompt:
                    direct_msgs.append(SystemMessage(content=enhanced_system_prompt))
                direct_msgs.append(HumanMessage(content=message))
                resp = await self.llm.ainvoke(direct_msgs)
                final_response = _extract_text(resp.content)
                if hasattr(resp, "usage_metadata") and resp.usage_metadata:
                    usage_input, usage_output, usage_total = self._extract_usage_tokens(resp.usage_metadata)
                    input_tokens += usage_input
                    output_tokens += usage_output
                    total_tokens += usage_total
                logger.info("Used direct LLM fallback (tool graph produced no output)")
            except Exception as e2:
                fallback_error = e2
                logger.error(f"Direct LLM fallback also failed: {e2}")

        if not final_response.strip():
            detail = f" Last error: {fallback_error}" if fallback_error else ""
            raise RuntimeError(
                f"Agent '{self.config.name}' produced no output. "
                f"Check its model configuration and API credentials.{detail}"
            )

        await self._store_conversation_memory(
            thread_id=thread_id,
            input_message=message,
            agent_output=final_response,
            workflow_id=workflow_id,
            execution_id=execution_id,
        )

        if total_tokens and not (input_tokens or output_tokens):
            input_tokens = int(total_tokens * 0.6)
            output_tokens = total_tokens - input_tokens

        telemetry_service.record_agent_call(
            agent_id=self.config.id,
            model=self.config.model,
            status="success",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

        if execution_id and user_id:
            try:
                async with AsyncSessionLocal() as db:
                    await cost_tracker.record_execution_cost(
                        execution_id=execution_id,
                        agent_id=self.config.id,
                        model=self.config.model,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        db=db,
                        user_id=user_id,
                    )
            except Exception as exc:
                logger.warning("Cost tracking failed for agent %s: %s", self.config.id, exc)

        return final_response, total_tokens

    async def _execute_with_retry(
        self,
        message: str,
        config: dict,
        enhanced_system_prompt: str,
        broadcast=None,
        thread_id: str = "default",
        workflow_id: str | None = None,
        execution_id: str | None = None,
        user_id: str | None = None,
    ) -> tuple[str, int]:
        max_retries = max(0, int(getattr(self.config, "max_retries", 3) or 0))
        retry_delay_seconds = max(1, int(getattr(self.config, "retry_delay_seconds", 5) or 5))
        retry_backoff_multiplier = max(1.0, float(getattr(self.config, "retry_backoff_multiplier", 2.0) or 2.0))
        retry_on_timeout = bool(getattr(self.config, "retry_on_timeout", True))
        timeout = int(getattr(self.config, "timeout", 300) or 0)

        last_exception = None
        delay = 0

        for attempt in range(max_retries + 1):
            try:
                if attempt > 0:
                    await self._broadcast_retry_event(
                        broadcast,
                        {
                            "type": "agent_retry",
                            "agent_id": self.config.id,
                            "agent_name": self.config.name,
                            "attempt": attempt,
                            "max_retries": max_retries,
                            "delay": delay,
                        },
                )

                attempt_thread_id = thread_id if attempt == 0 else f"{thread_id}-retry-{attempt}"
                attempt_config = {
                    **config,
                    "configurable": {"thread_id": attempt_thread_id},
                }
                attempt_graph = self._build_graph(enhanced_system_prompt)
                invoke_coro = self._invoke_agent(
                    message=message,
                    graph=attempt_graph,
                    config=attempt_config,
                    enhanced_system_prompt=enhanced_system_prompt,
                    broadcast=broadcast,
                    thread_id=thread_id,
                    workflow_id=workflow_id,
                    execution_id=execution_id,
                    user_id=user_id,
                )
                if timeout > 0:
                    result = await asyncio.wait_for(invoke_coro, timeout=timeout)
                else:
                    result = await invoke_coro

                if attempt > 0:
                    await self._broadcast_retry_event(
                        broadcast,
                        {
                            "type": "agent_retry_succeeded",
                            "agent_id": self.config.id,
                            "agent_name": self.config.name,
                            "attempt": attempt,
                        },
                    )
                return result

            except asyncio.TimeoutError as exc:
                telemetry_service.record_agent_call(self.config.id, self.config.model, "timeout", 0, 0)
                last_exception = TimeoutError(
                    f"Agent {self.config.name} timed out after {timeout}s"
                )
                if not retry_on_timeout:
                    raise last_exception from exc

            except Exception as exc:
                telemetry_service.record_agent_call(self.config.id, self.config.model, "error", 0, 0)
                last_exception = exc
                error_str = str(exc).lower()
                non_retryable = [
                    "authentication",
                    "invalid api key",
                    "rate limit exceeded",
                    "context length",
                    "maximum context",
                ]
                if any(phrase in error_str for phrase in non_retryable):
                    raise

            if attempt < max_retries:
                delay = retry_delay_seconds * (retry_backoff_multiplier ** attempt)
                delay = min(delay, 300)
                await asyncio.sleep(delay)

        await self._broadcast_retry_event(
            broadcast,
            {
                "type": "agent_retry_exhausted",
                "agent_id": self.config.id,
                "agent_name": self.config.name,
                "attempts": max_retries + 1,
                "error": str(last_exception),
            },
        )
        raise last_exception

    async def run(
        self,
        message: str,
        user_id: str | None = None,
        thread_id: str = "default",
        broadcast=None,
        workflow_id: str | None = None,
        execution_id: str | None = None,
    ) -> tuple[str, int]:
        self.tools = await self._build_runtime_tools(user_id, execution_id=execution_id)
        enhanced_system_prompt = await self._build_enhanced_system_prompt(message, user_id=user_id)
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 25,
        }

        return await self._execute_with_retry(
            message=message,
            config=config,
            enhanced_system_prompt=enhanced_system_prompt,
            broadcast=broadcast,
            thread_id=thread_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
            user_id=user_id,
        )

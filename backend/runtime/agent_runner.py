from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from config import settings
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import Agent, AgentContract, AgentRole, CompanyProfile, ExecutionStep, IntegrationType, Organization, UserIntegration
from runtime.tools import make_custom_tool
from services.agent_memory_service import agent_memory_service
from services.agent_messenger import agent_messenger
from services.agent_naming_service import agent_naming_service
from services.business_context_service import BusinessContextService
from services.cost_tracker import cost_tracker
from services.integration_crypto import decrypt_config
from services.model_service import model_service
from services.permission_engine import PermissionResult, permission_engine
from services.reputation_service import ReputationService
from services.telemetry_service import telemetry_service
from services.trust_score_service import trust_score_service
from services.websocket_manager import ws_manager
from tools.base import BaseTool
from tools.registry import tool_registry

logger = logging.getLogger(__name__)
FINAL_ANSWER_INSTRUCTION = (
    "When you have gathered enough information, stop using tools and write your final answer directly."
)
BLOCKER_SIGNALS = (
    "tool error: 🚫 blocked",
    "tool error: ⏸ approval required",
    "max iterations",
    "recursion",
    "blocked",
    "stuck",
    "need help",
    "low confidence",
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


def _is_recoverable_stream_tool_error(error_text: str) -> bool:
    lowered = error_text.lower()
    return (
        ("attempted to call tool" in lowered and "not in request.tools" in lowered)
        or "failed to call a function" in lowered
        or "failed_generation" in lowered
    )


def _looks_like_tool_call_stub(text: str) -> bool:
    lowered = text.lower()
    return (
        "<action>" in lowered
        or ("using the " in lowered and " tool" in lowered)
        or "i will search" in lowered
        or "i'll search" in lowered
        or "failed_generation" in lowered
        or "tool call" in lowered
    )


def build_llm(model: str, temperature: float = 0.7, max_tokens: int = 2000):
    return model_service.build_legacy_llm(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )


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
        self.llm = None
        self.tool_ids = agent_config.tools or []
        self.tools = []
        self._context: dict[str, Any] = {}

    async def _resolve_llm(self, db: AsyncSession | None = None):
        temperature = getattr(self.config, "temperature", 0.7)
        max_tokens = getattr(self.config, "max_tokens", 2000)
        org_id = getattr(self.config, "org_id", None)
        agent_id = getattr(self.config, "id", None)

        model_config = None
        if org_id and agent_id:
            if db is not None:
                model_config = await model_service.get_for_agent(
                    agent_id=str(agent_id),
                    org_id=str(org_id),
                    db=db,
                )
            else:
                async with AsyncSessionLocal() as session:
                    model_config = await model_service.get_for_agent(
                        agent_id=str(agent_id),
                        org_id=str(org_id),
                        db=session,
                    )

        if model_config:
            if self.tool_ids and not bool(model_config.supports_tools):
                logger.warning(
                    "Agent %r is assigned to model %r which does not support tools; continuing anyway.",
                    self.config.name,
                    model_config.display_name,
                )
            return model_service.build_llm(
                config=model_config,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        legacy_model = getattr(self.config, "model", None) or settings.default_model
        return build_llm(legacy_model, temperature=temperature, max_tokens=max_tokens)

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

    @staticmethod
    def _schema_to_pydantic(schema: dict, name: str):
        from pydantic import create_model
        from typing import Optional

        fields = {}
        properties = schema.get("properties", {})
        required = set(schema.get("required", []))
        type_map = {
            "string": str,
            "integer": int,
            "number": float,
            "boolean": bool,
            "array": list,
            "object": dict,
        }

        for field_name, field_schema in properties.items():
            base_type = type_map.get(field_schema.get("type", "string"), str)
            if field_name in required:
                fields[field_name] = (base_type, ...)
            else:
                fields[field_name] = (Optional[base_type], field_schema.get("default", None))

        return create_model(f"{name.title().replace('_', '')}Input", **fields)

    async def _build_new_pattern_tools_as_langchain(
        self,
        org_id: str,
        user_id: str,
        execution_id: str,
    ) -> list:
        from langchain_core.tools import StructuredTool

        new_tools = []
        active_user_id = user_id or "system"
        context = {
            "_context": {
                "agent_id": self.config.id,
                "agent_name": self.config.name,
                "org_id": org_id,
                "user_id": user_id,
                "execution_id": execution_id,
            }
        }

        for tool_name in self.tool_ids:
            try:
                tool = await tool_registry.get_tool_instance(tool_name, active_user_id, dict(context))
            except Exception:
                continue

            if tool.__class__.execute is BaseTool.execute:
                continue

            async def tool_func(_tool=tool, **kwargs):
                if _tool.requires_auth and not await _tool.validate_auth(org_id, active_user_id):
                    return f"{_tool.display_name} requires authentication before it can run."
                result = await _tool.execute(
                    input_data=kwargs,
                    org_id=org_id,
                    user_id=active_user_id,
                )
                if result.success:
                    return result.result
                return f"Tool error: {result.error}"

            schema = tool.get_schema()
            langchain_tool = StructuredTool.from_function(
                coroutine=tool_func,
                name=tool.name,
                description=tool.description,
                args_schema=self._schema_to_pydantic(schema, tool.name),
            )
            new_tools.append(langchain_tool)

        return new_tools

    @staticmethod
    def _json_safe(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, list):
            return [AgentRunner._json_safe(item) for item in value]
        if isinstance(value, tuple):
            return [AgentRunner._json_safe(item) for item in value]
        if isinstance(value, dict):
            return {str(key): AgentRunner._json_safe(item) for key, item in value.items()}
        try:
            json.dumps(value)
            return value
        except TypeError:
            return str(value)

    @staticmethod
    def _truncate_text(value: Any, limit: int = 1000) -> str:
        text = _extract_text(value)
        return text if len(text) <= limit else f"{text[:limit]}..."

    @staticmethod
    def _next_step_index(step_index_ref: dict[str, int] | None) -> int:
        if step_index_ref is None:
            return 0
        index = int(step_index_ref.get("value", 0))
        step_index_ref["value"] = index + 1
        return index

    async def _persist_execution_step(
        self,
        *,
        execution_id: str | None,
        org_id: str | None,
        step_type: str,
        content: str,
        step_index: int,
        db: AsyncSession | None = None,
        tool_name: str | None = None,
        tool_input: Any = None,
        tool_output: Any = None,
        tool_success: bool | None = None,
        duration_ms: int | None = None,
        tokens_used: int | None = None,
        created_at: datetime | None = None,
    ) -> str | None:
        if not execution_id or not org_id:
            return None

        step = ExecutionStep(
            id=str(uuid4()),
            execution_id=execution_id,
            org_id=org_id,
            step_type=step_type,
            content=content,
            tool_name=tool_name,
            tool_input=self._json_safe(tool_input),
            tool_output=self._json_safe(tool_output),
            tool_success=tool_success,
            step_index=step_index,
            duration_ms=duration_ms,
            tokens_used=tokens_used,
            created_at=created_at or datetime.utcnow(),
        )

        if db is not None:
            db.add(step)
            await db.commit()
            return step.id

        async with AsyncSessionLocal() as session:
            session.add(step)
            await session.commit()
            return step.id

    async def _update_execution_step(
        self,
        step_id: str | None,
        values: dict[str, Any],
        db: AsyncSession | None = None,
    ) -> None:
        if not step_id:
            return

        statement = (
            update(ExecutionStep)
            .where(ExecutionStep.id == step_id)
            .values(**{key: self._json_safe(value) for key, value in values.items()})
        )

        if db is not None:
            await db.execute(statement)
            await db.commit()
            return

        async with AsyncSessionLocal() as session:
            await session.execute(statement)
            await session.commit()

    async def _broadcast_execution_step(
        self,
        execution_id: str | None,
        payload: dict[str, Any],
    ) -> None:
        if not execution_id:
            return
        await ws_manager.broadcast_to_channel(
            f"execution:{execution_id}",
            {
                "event": "execution_step",
                "execution_id": execution_id,
                "step": payload,
            },
        )

    async def _record_execution_step(
        self,
        *,
        execution_id: str | None,
        org_id: str | None,
        step_type: str,
        content: str,
        step_index_ref: dict[str, int] | None,
        db: AsyncSession | None = None,
        tool_name: str | None = None,
        tool_input: Any = None,
        tool_output: Any = None,
        tool_success: bool | None = None,
        duration_ms: int | None = None,
        tokens_used: int | None = None,
    ) -> tuple[str | None, dict[str, Any]]:
        timestamp = datetime.utcnow()
        step_index = self._next_step_index(step_index_ref)
        payload = {
            "step_type": step_type,
            "content": content,
            "tool_name": tool_name,
            "tool_input": self._json_safe(tool_input),
            "tool_output": self._json_safe(tool_output),
            "tool_success": tool_success,
            "step_index": step_index,
            "duration_ms": duration_ms,
            "tokens_used": tokens_used,
            "timestamp": timestamp.isoformat(),
            "agent_id": self.config.id,
            "agent_name": self.config.name,
        }
        step_id = await self._persist_execution_step(
            execution_id=execution_id,
            org_id=org_id,
            step_type=step_type,
            content=content,
            step_index=step_index,
            db=db,
            tool_name=tool_name,
            tool_input=tool_input,
            tool_output=tool_output,
            tool_success=tool_success,
            duration_ms=duration_ms,
            tokens_used=tokens_used,
            created_at=timestamp,
        )
        if step_id:
            payload["id"] = step_id
        await self._broadcast_execution_step(execution_id, payload)
        return step_id, payload

    async def _run_permission_guarded_tool(
        self,
        *,
        tool,
        tool_name: str,
        kwargs: dict[str, Any],
        execution_id: str | None,
        org_id: str | None,
        db: AsyncSession | None,
        step_index_ref: dict[str, int] | None,
    ) -> str:
        owns_session = db is None
        session = db or AsyncSessionLocal()

        try:
            perm = await permission_engine.check(
                agent_id=str(self.config.id),
                action=f"tool:{tool_name}",
                context={"execution_id": execution_id},
                db=session,
            )

            if perm.result == PermissionResult.FORBIDDEN:
                message = f"🚫 Blocked: {perm.reason}"
                await self._record_execution_step(
                    execution_id=execution_id,
                    org_id=org_id,
                    step_type="error",
                    content=message,
                    step_index_ref=step_index_ref,
                    db=session,
                    tool_name=tool_name,
                    tool_input=kwargs,
                    tool_success=False,
                )
                # TODO Task 6: await audit_service.log_permission_denied(...)
                return f"Tool error: {message}"

            if perm.result == PermissionResult.REQUIRES_APPROVAL:
                from services import audit_log_service
                from services.approval_service import approval_service

                agent_display = (
                    getattr(self.config, "persona_name", None) or self.config.name
                )

                approval = await approval_service.create(
                    org_id=org_id or str(self.config.org_id),
                    requesting_agent_id=str(self.config.id),
                    execution_id=execution_id,
                    approval_type=perm.approval_type or "tool_use",
                    title=f"{agent_display} wants to use: {tool_name}",
                    description=(
                        f"Tool: {tool_name}\n"
                        f"Reason: {perm.reason}\n"
                        f"Risk level: {perm.risk_level}\n"
                        f"Blast radius: {perm.blast_radius or 'Unknown'}\n"
                        f"Input preview: {str(list(kwargs.values()))[:300]}"
                    ),
                    risk_level=perm.risk_level,
                    db=session,
                )

                await self._record_execution_step(
                    execution_id=execution_id,
                    org_id=org_id,
                    step_type="human_input_required",
                    content=(
                        f"⏳ {agent_display} is waiting for CEO approval\n"
                        f"Tool: {tool_name}\n"
                        f"Reason: {perm.reason}\n"
                        f"Approval ID: {approval.id}"
                    ),
                    step_index_ref=step_index_ref,
                    db=session,
                    tool_name=tool_name,
                )

                try:
                    await session.execute(
                        update(Agent)
                        .where(Agent.id == str(self.config.id))
                        .values(
                            current_status="waiting_approval",
                            current_task_summary=f"Waiting CEO approval: {tool_name}",
                        )
                    )
                    await session.commit()
                except Exception:
                    pass

                await audit_log_service.log(
                    action="approval_requested",
                    org_id=org_id,
                    user_id=str(self.config.id),
                    resource_type="tool",
                    resource_id=tool_name,
                    details={
                        "agent_name": agent_display,
                        "approval_id": approval.id,
                        "risk_level": perm.risk_level,
                    },
                    db=session,
                )

                approved = await approval_service.wait_for_decision(
                    str(approval.id), timeout_seconds=1800
                )

                try:
                    await session.execute(
                        update(Agent)
                        .where(Agent.id == str(self.config.id))
                        .values(current_status="working")
                    )
                    await session.commit()
                except Exception:
                    pass

                if not approved:
                    return f"Skipped: CEO did not approve use of '{tool_name}'"

            if getattr(tool, "coroutine", None):
                return await tool.coroutine(**kwargs)
            if getattr(tool, "func", None):
                return tool.func(**kwargs)
            return "Tool error: Tool is not executable."
        finally:
            if owns_session:
                await session.close()

    def _wrap_tool_with_permissions(
        self,
        tool,
        *,
        execution_id: str | None,
        org_id: str | None,
        db: AsyncSession | None,
        step_index_ref: dict[str, int] | None,
    ):
        from langchain_core.tools import StructuredTool

        tool_name = getattr(tool, "name", "unknown")
        description = getattr(tool, "description", "") or ""
        args_schema = getattr(tool, "args_schema", None)

        async def guarded_runner(**kwargs):
            return await self._run_permission_guarded_tool(
                tool=tool,
                tool_name=tool_name,
                kwargs=kwargs,
                execution_id=execution_id,
                org_id=org_id,
                db=db,
                step_index_ref=step_index_ref,
            )

        return StructuredTool.from_function(
            coroutine=guarded_runner,
            name=tool_name,
            description=description,
            args_schema=args_schema,
        )

    async def _build_runtime_tools(
        self,
        user_id: str | None,
        execution_id: str | None = None,
        db: AsyncSession | None = None,
        step_index_ref: dict[str, int] | None = None,
    ):
        tool_ids = list(self.tool_ids or [])
        if "notifications" not in tool_ids:
            tool_ids.append("notifications")
        if "agent_communication" not in tool_ids:
            tool_ids.append("agent_communication")
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
                "org_id": getattr(self.config, "org_id", None),
                "user_id": user_id,
                "execution_id": execution_id,
            }
        }
        self._context = dict(tool_context["_context"])

        integrations_by_tool: dict[str, dict] = {}
        if not user_id:
            integrations_by_tool = {tool_id: dict(tool_context) for tool_id in registry_tool_ids}
            tools = await tool_registry.get_langchain_tools_for_agent(
                registry_tool_ids,
                user_id="system",
                integrations=integrations_by_tool,
            ) + custom_tools
        else:
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
            tools = registry_tools + custom_tools

        new_pattern_tools = await self._build_new_pattern_tools_as_langchain(
            org_id=self._context.get("org_id") or "",
            user_id=self._context.get("user_id") or "",
            execution_id=self._context.get("execution_id") or "",
        )
        if new_pattern_tools:
            duplicate_names = {tool.name for tool in tools} & {tool.name for tool in new_pattern_tools}
            tools = [tool for tool in tools if tool.name not in duplicate_names]
            tools.extend(new_pattern_tools)

        guarded_tools = [
            self._wrap_tool_with_permissions(
                tool,
                execution_id=execution_id,
                org_id=self._context.get("org_id"),
                db=db,
                step_index_ref=step_index_ref,
            )
            for tool in tools
        ]
        return guarded_tools

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

    async def _get_company_name(self, user_id: str | None = None) -> str:
        try:
            async with AsyncSessionLocal() as db:
                profile = await db.execute(
                    select(CompanyProfile).where(CompanyProfile.org_id == str(self.config.org_id))
                )
                company_profile = profile.scalar_one_or_none()
                if company_profile and company_profile.company_name:
                    return company_profile.company_name

                org = await db.execute(
                    select(Organization).where(Organization.id == str(self.config.org_id))
                )
                organization = org.scalar_one_or_none()
                if organization and organization.name:
                    return organization.name
        except Exception as exc:
            logger.warning("Company name lookup failed for org %s: %s", getattr(self.config, "org_id", None), exc)
        return "our company"

    async def _get_department_type(self) -> str:
        configured = getattr(self.config, "department_type", None)
        if configured:
            return configured
        role_slug = getattr(self.config, "role_slug", None)
        if not role_slug:
            return "operations"
        try:
            async with AsyncSessionLocal() as db:
                role = await db.scalar(select(AgentRole).where(AgentRole.slug == role_slug))
                if role and role.department_type:
                    return role.department_type
        except Exception as exc:
            logger.warning("Department lookup failed for role %s: %s", role_slug, exc)
        return "operations"

    async def _finalize_trust_and_status(
        self,
        *,
        success: bool,
        tools_called: list[str],
        db: AsyncSession | None,
        reset_status: bool = True,
    ) -> None:
        owns_session = db is None
        session = db or AsyncSessionLocal()

        try:
            contract = await session.scalar(select(AgentContract).where(AgentContract.agent_id == str(self.config.id)))
            budget_cents = (
                contract.max_cost_per_task_cents
                if contract and contract.max_cost_per_task_cents is not None
                else 100
            )

            await trust_score_service.record_task_completed(
                agent_id=str(self.config.id),
                success=success,
                on_time=True,
                cost_cents=0,
                budget_cents=budget_cents,
                tools_used=tools_called,
                db=session,
            )

            values = {}
            if success:
                values["total_tasks_completed"] = Agent.total_tasks_completed + 1
            if reset_status:
                values["current_status"] = "idle"
                values["current_task_summary"] = None
            await session.execute(
                update(Agent)
                .where(Agent.id == str(self.config.id))
                .values(**values)
            )
            await session.commit()
        except Exception as exc:
            logger.warning("Trust/status finalization failed for agent %s: %s", self.config.id, exc)
        finally:
            if owns_session:
                await session.close()

    async def _handle_blocker_escalation(
        self,
        *,
        blocker_text: str,
        org_id: str | None,
        execution_id: str | None,
        db: AsyncSession | None,
    ) -> bool:
        if not blocker_text or not org_id:
            return False
        normalized = blocker_text.lower()
        if not any(signal in normalized for signal in BLOCKER_SIGNALS):
            return False

        owns_session = db is None
        session = db or AsyncSessionLocal()
        try:
            await agent_messenger.send_escalation(
                from_agent_id=str(self.config.id),
                blocker=blocker_text[:500],
                org_id=str(org_id),
                execution_id=execution_id,
                db=session,
                redis=None,
            )
            await session.execute(
                update(Agent)
                .where(Agent.id == str(self.config.id))
                .values(
                    current_status="blocked",
                    current_task_summary=f"Blocked: {blocker_text[:100]}",
                )
            )
            await session.commit()
            return True
        except Exception as exc:
            logger.warning("Blocker escalation failed for agent %s: %s", self.config.id, exc)
            return False
        finally:
            if owns_session:
                await session.close()

    async def _build_enhanced_system_prompt(self, message: str, user_id: str | None = None) -> str:
        original_system_prompt = self.config.system_prompt or ""
        business_context = await self._build_business_context(user_id)
        learning_context = await self._build_learning_context()
        identity_block = ""
        living_memory_context = ""

        if getattr(self.config, "persona_name", None):
            company_name = await self._get_company_name(user_id)
            role_display = self.config.role or (
                self.config.role_slug.replace("_", " ").title() if getattr(self.config, "role_slug", None) else "AI Agent"
            )
            department_type = await self._get_department_type()
            identity_block = agent_naming_service.build_identity_block(
                persona_name=self.config.persona_name,
                role_display=role_display,
                company_name=company_name,
                department_type=department_type,
                seniority_level=getattr(self.config, "seniority_level", 1),
            )

        try:
            living_memory_context = await agent_memory_service.build_memory_context(
                agent_id=str(self.config.id),
                org_id=str(self.config.org_id),
                task=message,
                max_memories=5,
            )
        except Exception as exc:
            logger.warning("Living memory retrieval failed for agent %s: %s", self.config.id, exc)
            living_memory_context = ""

        parts = [
            part
            for part in (
                identity_block,
                business_context,
                living_memory_context,
                learning_context,
                original_system_prompt,
                (
                    "TOOL CALLING RULES:\n"
                    "- When using a tool, the tool name must exactly match one of the provided tool names.\n"
                    "- Put arguments only in the tool input object.\n"
                    "- Never include JSON, parentheses, or extra prose in the tool name.\n"
                    "- If you are unsure which tool to use, do not invent a tool name."
                ),
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
        org_id: str | None = None,
        db: AsyncSession | None = None,
        step_index_ref: dict[str, int] | None = None,
    ) -> tuple[str, int, list[str]]:
        total_tokens = 0
        input_tokens = 0
        output_tokens = 0
        pending_action_step_id: str | None = None
        pending_tool_started_at: datetime | None = None
        tools_called: list[str] = []
        consecutive_tool_errors = 0
        max_consecutive_tool_errors = 5
        last_tool_error: str | None = None

        recoverable_stream_error: str | None = None
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
                    tool_name = event.get("name", "unknown")
                    tool_input = event.get("data", {}).get("input", {})
                    if tool_name not in tools_called:
                        tools_called.append(tool_name)
                    pending_tool_started_at = datetime.utcnow()
                    pending_action_step_id, _payload = await self._record_execution_step(
                        execution_id=execution_id,
                        org_id=org_id,
                        step_type="action",
                        content=f"Using tool: {tool_name}",
                        step_index_ref=step_index_ref,
                        db=db,
                        tool_name=tool_name,
                        tool_input=tool_input,
                    )

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
                    tool_name = event.get("name", "unknown")
                    raw_output = event.get("data", {}).get("output", "")
                    output_text = self._truncate_text(raw_output, 1000)
                    output_payload = {"result": self._truncate_text(raw_output, 2000)}
                    success = not output_text.lower().startswith("tool error:")
                    duration_ms = None
                    if pending_tool_started_at is not None:
                        duration_ms = int((datetime.utcnow() - pending_tool_started_at).total_seconds() * 1000)
                    await self._record_execution_step(
                        execution_id=execution_id,
                        org_id=org_id,
                        step_type="observation",
                        content=output_text,
                        step_index_ref=step_index_ref,
                        db=db,
                        tool_name=tool_name,
                        tool_output=output_payload,
                        tool_success=success,
                        duration_ms=duration_ms,
                    )
                    if pending_action_step_id:
                        await self._update_execution_step(
                            pending_action_step_id,
                            {
                                "tool_output": output_payload,
                                "tool_success": success,
                                "duration_ms": duration_ms,
                            },
                            db=db,
                        )
                    pending_action_step_id = None
                    pending_tool_started_at = None
                    if success:
                        consecutive_tool_errors = 0
                        last_tool_error = None
                    else:
                        consecutive_tool_errors += 1
                        last_tool_error = output_text
                        if consecutive_tool_errors >= max_consecutive_tool_errors:
                            raise RuntimeError(
                                f"Execution stopped: {max_consecutive_tool_errors} consecutive "
                                f"tool errors. Last error: {last_tool_error}"
                            )

        except Exception as e:
            error_text = str(e)
            malformed_tool_call = _is_recoverable_stream_tool_error(error_text)
            logger.warning(f"Agent stream error (recovering): {e}")
            if malformed_tool_call:
                recoverable_stream_error = error_text
            else:
                await self._record_execution_step(
                    execution_id=execution_id,
                    org_id=org_id,
                    step_type="error",
                    content=f"Agent stream error, attempting recovery: {e}",
                    step_index_ref=step_index_ref,
                    db=db,
                )

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

        if recoverable_stream_error and (
            not final_response.strip() or _looks_like_tool_call_stub(final_response)
        ):
            final_response = (
                "I started the task, but the model produced an invalid tool call before "
                "the live work could complete. Please retry the request and I will try again."
            )

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

        return final_response, total_tokens, tools_called

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
        org_id: str | None = None,
        db: AsyncSession | None = None,
        step_index_ref: dict[str, int] | None = None,
    ) -> tuple[str, int, list[str]]:
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
                    await self._record_execution_step(
                        execution_id=execution_id,
                        org_id=org_id,
                        step_type="retry",
                        content=(
                            f"Retrying agent {self.config.name}: attempt {attempt} of {max_retries} "
                            f"after {delay} seconds."
                        ),
                        step_index_ref=step_index_ref,
                        db=db,
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
                    org_id=org_id,
                    db=db,
                    step_index_ref=step_index_ref,
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
                    await self._record_execution_step(
                        execution_id=execution_id,
                        org_id=org_id,
                        step_type="retry",
                        content=f"Retry succeeded for agent {self.config.name} on attempt {attempt}.",
                        step_index_ref=step_index_ref,
                        db=db,
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
        await self._record_execution_step(
            execution_id=execution_id,
            org_id=org_id,
            step_type="retry",
            content=f"Agent {self.config.name} exhausted retries: {last_exception}",
            step_index_ref=step_index_ref,
            db=db,
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
        org_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> tuple[str, int]:
        resolved_org_id = org_id or getattr(self.config, "org_id", None)
        step_index_ref = {"value": 0}
        tools_called: list[str] = []
        self.llm = await self._resolve_llm(db=db)
        if db is not None:
            try:
                await db.execute(
                    update(Agent)
                    .where(Agent.id == str(self.config.id))
                    .values(
                        current_status="working",
                        current_task_summary=message[:100],
                    )
                )
                await db.commit()
            except Exception as exc:
                logger.warning("Agent working status update failed for %s: %s", self.config.id, exc)
        self.tools = await self._build_runtime_tools(
            user_id,
            execution_id=execution_id,
            db=db,
            step_index_ref=step_index_ref,
        )
        enhanced_system_prompt = await self._build_enhanced_system_prompt(message, user_id=user_id)
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 25,
        }

        await self._record_execution_step(
            execution_id=execution_id,
            org_id=resolved_org_id,
            step_type="thought",
            content=(
                f"{getattr(self.config, 'name', 'Agent')} is reading the task: "
                f"\"{message[:120]}{'…' if len(message) > 120 else ''}\""
            ),
            step_index_ref=step_index_ref,
            db=db,
        )

        try:
            final_response, total_tokens, tools_called = await self._execute_with_retry(
                message=message,
                config=config,
                enhanced_system_prompt=enhanced_system_prompt,
                broadcast=broadcast,
                thread_id=thread_id,
                workflow_id=workflow_id,
                execution_id=execution_id,
                user_id=user_id,
                org_id=resolved_org_id,
                db=db,
                step_index_ref=step_index_ref,
            )
        except Exception as exc:
            await self._record_execution_step(
                execution_id=execution_id,
                org_id=resolved_org_id,
                step_type="error",
                content=f"Execution failed: {exc}",
                step_index_ref=step_index_ref,
                db=db,
            )
            try:
                await agent_memory_service.store_task_outcome(
                    agent_id=str(self.config.id),
                    org_id=str(resolved_org_id),
                    task_input=message[:500],
                    task_result=str(exc)[:500],
                    success=False,
                    tools_used=tools_called,
                    db=db,
                )
            except Exception as memory_exc:
                logger.warning("Task outcome failure memory store failed for agent %s: %s", self.config.id, memory_exc)
            was_blocked = await self._handle_blocker_escalation(
                blocker_text=str(exc),
                org_id=resolved_org_id,
                execution_id=execution_id,
                db=db,
            )
            await self._finalize_trust_and_status(
                success=False,
                tools_called=tools_called,
                db=db,
                reset_status=not was_blocked,
            )
            raise

        await self._record_execution_step(
            execution_id=execution_id,
            org_id=resolved_org_id,
            step_type="final_answer",
            content=final_response,
            step_index_ref=step_index_ref,
            db=db,
            tokens_used=total_tokens,
        )
        try:
            await agent_memory_service.store_task_outcome(
                agent_id=str(self.config.id),
                org_id=str(resolved_org_id),
                task_input=message[:500],
                task_result=final_response[:500],
                success=True,
                tools_used=tools_called,
                db=db,
            )
        except Exception as exc:
            logger.warning("Task outcome memory store failed for agent %s: %s", self.config.id, exc)
        was_blocked = await self._handle_blocker_escalation(
            blocker_text=final_response,
            org_id=resolved_org_id,
            execution_id=execution_id,
            db=db,
        )
        await self._finalize_trust_and_status(
            success=True,
            tools_called=tools_called,
            db=db,
            reset_status=not was_blocked,
        )
        return final_response, total_tokens

    async def generate_reply(
        self,
        agent: "Agent",
        prompt: str,
        org_id: str,
        db,
        max_tokens: int = 300,
    ) -> str:
        """
        Generate a short conversational reply from an agent.
        Single LLM call — no tools, no ReAct loop.
        Used exclusively for direct-message replies.
        """
        display_name = agent.persona_name or agent.name
        role_name = agent.role or agent.role_slug or "AI agent"
        system = (
            f"You are {display_name}, "
            f"a {role_name} at this company. "
            f"You are replying in a direct-message thread with the CEO. "
            f"Reply conversationally, naturally, and concisely. "
            f"Never use markdown formatting in your reply. "
            f"Write like you're sending a quick DM, not a report. "
            f"Only reference facts that are explicitly present in the prompt. "
            f"Do not invent files, meetings, reports, investors, deadlines, email threads, or past work. "
            f"Do not claim you sent an email, file, or any external message unless the prompt explicitly says it already happened. "
            f"If the CEO asks for something that has not happened yet, say that clearly and suggest the next step. "
            f"If they ask a direct question, answer it directly first."
        )

        async def _invoke_with_llm(llm):
            response = await llm.ainvoke([
                SystemMessage(content=system),
                HumanMessage(content=prompt),
            ])
            text = _extract_text(response.content) if not isinstance(response.content, str) else response.content
            return text.strip()

        try:
            model_config = await model_service.get_for_agent(
                agent_id=str(agent.id),
                org_id=org_id,
                db=db,
            )
            try:
                llm = model_service.build_llm(
                    config=model_config,
                    temperature=0.25,
                    max_tokens=max_tokens,
                )
                text = await _invoke_with_llm(llm)
                if text:
                    return text
            except Exception as exc:
                logger.warning(
                    "generate_reply primary model failed for agent %s (config=%s): %s",
                    agent.id,
                    getattr(model_config, "id", None),
                    exc,
                )

            llm = model_service.build_legacy_llm(
                getattr(settings, "default_model", "gpt-4o-mini"),
                temperature=0.25,
                max_tokens=max_tokens,
            )
            text = await _invoke_with_llm(llm)
            if text:
                return text
        except Exception as exc:
            logger.warning("generate_reply failed for agent %s: %s", agent.id, exc)

        lowered = prompt.lower()
        if "?" in prompt:
            return (
                f"I saw your question and I'm looking into it now. "
                f"I'll send you a concrete update as soon as I have it. — {display_name}"
            )
        if any(token in lowered for token in ("please", "can you", "do this", "work on", "research", "check", "review")):
            return (
                f"On it. I've picked this up and I'll follow up with a concrete update shortly. "
                f"— {display_name}"
            )
        return (
            f"Message received. I'm on it and I'll get back to you with something useful shortly. "
            f"— {display_name}"
        )

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
import logging

from config import settings
from runtime.tools import get_tools

logger = logging.getLogger(__name__)


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
    def __init__(self, agent_config, custom_tool_defs=None):
        self.config = agent_config
        self.llm = build_llm(
            agent_config.model,
            agent_config.temperature,
            agent_config.max_tokens,
        )
        self.tools = get_tools(agent_config.tools or [], custom_tool_defs)
        self.memory = MemorySaver()
        self._graph = create_react_agent(
            self.llm,
            tools=self.tools,
            checkpointer=self.memory,
            prompt=agent_config.system_prompt or None,
        )

    async def run(
        self,
        message: str,
        thread_id: str = "default",
        broadcast=None,
    ) -> tuple[str, int]:
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": self.config.max_iterations or 10,
        }

        total_tokens = 0

        try:
            async for event in self._graph.astream_events(
                {"messages": [HumanMessage(content=message)]},
                config=config,
                version="v2",
            ):
                kind = event["event"]

                if kind == "on_chat_model_end":
                    output = event["data"].get("output")
                    if output and hasattr(output, "usage_metadata") and output.usage_metadata:
                        meta = output.usage_metadata
                        if isinstance(meta, dict):
                            total_tokens += meta.get("total_tokens", 0)

                elif kind == "on_tool_start":
                    if broadcast:
                        await broadcast({
                            "type": "tool_call",
                            "agent": self.config.name,
                            "tool": event["name"],
                            "input": str(event["data"].get("input", ""))[:200],
                        })

                elif kind == "on_tool_end":
                    if broadcast:
                        await broadcast({
                            "type": "tool_result",
                            "agent": self.config.name,
                            "tool": event["name"],
                            "output": str(event["data"].get("output", ""))[:300],
                        })

        except Exception as e:
            # Malformed tool-call names (model appends args to the name) produce a
            # validation error mid-stream. Recover by reading whatever state was saved.
            logger.warning(f"Agent stream error (recovering): {e}")

        # Read the latest graph state regardless of whether streaming finished cleanly
        try:
            state = await self._graph.aget_state(config)
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
        if not final_response:
            try:
                direct_msgs = []
                if self.config.system_prompt:
                    direct_msgs.append(SystemMessage(content=self.config.system_prompt))
                direct_msgs.append(HumanMessage(content=message))
                resp = await self.llm.ainvoke(direct_msgs)
                final_response = _extract_text(resp.content)
                logger.info("Used direct LLM fallback (tool graph produced no output)")
            except Exception as e2:
                logger.error(f"Direct LLM fallback also failed: {e2}")

        return final_response, total_tokens

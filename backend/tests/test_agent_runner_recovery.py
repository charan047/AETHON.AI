from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from runtime.agent_runner import AgentRunner


class _EmptyState:
    values = {"messages": []}


class _FakeState:
    def __init__(self, text: str):
        self.values = {"messages": [AIMessage(content=text)]}


class _RecoveringGraph:
    def __init__(self):
        self._states: dict[str, object] = {}

    async def astream_events(self, *_args, **_kwargs):
        if False:
            yield None
        raise RuntimeError(
            "Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details."
        )

    async def aget_state(self, config):
        thread_id = config.get("configurable", {}).get("thread_id", "default")
        return self._states.get(thread_id, _EmptyState())

    async def ainvoke(self, _payload, config=None, **_kwargs):
        thread_id = config.get("configurable", {}).get("thread_id", "default")
        self._states[thread_id] = _FakeState(
            "Maya is waiting for approval to send the email draft."
        )
        return self._states[thread_id]


class _NoopMemoryService:
    async def store_memory(self, **_kwargs):
        return None


@pytest.mark.asyncio
async def test_agent_runner_retries_malformed_tool_call_before_apology():
    config = SimpleNamespace(
        id="agent-1",
        name="Maya",
        org_id="org-1",
        model="test-model",
        tools=["gmail_send"],
    )
    runner = AgentRunner(config, memory_service=_NoopMemoryService())
    runner.llm = SimpleNamespace()
    runner._record_execution_step = lambda **_kwargs: None  # type: ignore[method-assign]
    runner._update_execution_step = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

    async def _record_step(**_kwargs):
        return None, None

    async def _update_step(*_args, **_kwargs):
        return None

    runner._record_execution_step = _record_step  # type: ignore[method-assign]
    runner._update_execution_step = _update_step  # type: ignore[method-assign]

    graph = _RecoveringGraph()
    response, total_tokens, tools_called = await runner._invoke_agent(
        message="Draft the reply and send it for approval.",
        graph=graph,
        config={"configurable": {"thread_id": "chat-thread"}},
        enhanced_system_prompt="You are helpful.",
        thread_id="chat-thread",
        execution_id="exec-1",
        org_id="org-1",
    )

    assert response == "Maya is waiting for approval to send the email draft."
    assert "invalid tool call" not in response
    assert total_tokens == 0
    assert tools_called == []

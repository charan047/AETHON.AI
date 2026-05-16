from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from runtime import agent_runner as agent_runner_module
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


@pytest.mark.asyncio
async def test_failed_run_records_zero_cost_log(monkeypatch):
    config = SimpleNamespace(
        id="agent-2",
        name="Jordan",
        org_id="org-1",
        model="test-model",
        tools=[],
    )
    runner = AgentRunner(config, memory_service=_NoopMemoryService())
    runner.llm = SimpleNamespace()

    async def _noop_step(**_kwargs):
        return None, None

    async def _failing_execute(**_kwargs):
        raise RuntimeError("provider exploded")

    async def _noop(*_args, **_kwargs):
        return None

    async def _not_blocked(**_kwargs):
        return False

    recorded: dict[str, object] = {}

    class _FakeSession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def _fake_session_local():
        return _FakeSession()

    async def _fake_record_execution_cost(**kwargs):
        recorded.update(kwargs)
        return 0.0

    monkeypatch.setattr(runner, "_resolve_llm", _noop)
    monkeypatch.setattr(runner, "_build_runtime_tools", _noop)
    monkeypatch.setattr(runner, "_build_enhanced_system_prompt", _noop)
    monkeypatch.setattr(runner, "_record_execution_step", _noop_step)
    monkeypatch.setattr(runner, "_execute_with_retry", _failing_execute)
    monkeypatch.setattr(runner, "_handle_blocker_escalation", _not_blocked)
    monkeypatch.setattr(runner, "_finalize_trust_and_status", _noop)
    monkeypatch.setattr(agent_runner_module, "AsyncSessionLocal", _fake_session_local)
    monkeypatch.setattr(agent_runner_module.cost_tracker, "record_execution_cost", _fake_record_execution_cost)

    with pytest.raises(RuntimeError, match="provider exploded"):
        await runner.run(
            "Handle this request",
            user_id="user-1",
            thread_id="thread-1",
            execution_id="exec-123",
            org_id="org-1",
        )

    assert recorded["execution_id"] == "exec-123"
    assert recorded["agent_id"] == "agent-2"
    assert recorded["model"] == "test-model"
    assert recorded["input_tokens"] == 0
    assert recorded["output_tokens"] == 0
    assert recorded["user_id"] == "user-1"

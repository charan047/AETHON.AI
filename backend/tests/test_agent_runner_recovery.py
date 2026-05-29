from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from runtime import agent_runner as agent_runner_module
from datetime import datetime

from database.models import AgentMemoryEntry, ClientKnowledge, Execution, ExecutionStatus, OrgVariable
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


def test_search_failed_output_is_detected():
    reason = agent_runner_module._tool_failure_reason(
        "{'snippet': 'SEARCH_FAILED: Web search is unavailable. Configure BRAVE_SEARCH_API_KEY.'}"
    )

    assert reason is not None
    assert "SEARCH_FAILED:" in reason


def test_tool_failure_guidance_instructs_agent_not_to_guess():
    guidance = agent_runner_module._tool_failure_guidance(
        "google_docs_create",
        "Google Docs integration is not implemented yet in this phase",
    )

    assert "IMPORTANT: The tool 'google_docs_create' failed with:" in guidance
    assert "Do NOT guess or make up information." in guidance


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


@pytest.mark.asyncio
async def test_runtime_tools_do_not_auto_inject_notifications_or_agent_communication(monkeypatch):
    config = SimpleNamespace(
        id="agent-3",
        name="A2A Agent",
        org_id="org-1",
        model="test-model",
        tools=["web_search"],
    )
    runner = AgentRunner(config, memory_service=_NoopMemoryService())
    runner.custom_tool_defs = []

    captured: dict[str, object] = {}

    async def _fake_get_langchain_tools_for_agent(tool_ids, **kwargs):
        captured["tool_ids"] = list(tool_ids)
        return []

    async def _noop(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        agent_runner_module.tool_registry,
        "get_langchain_tools_for_agent",
        _fake_get_langchain_tools_for_agent,
    )
    monkeypatch.setattr(runner, "_build_new_pattern_tools_as_langchain", _noop)

    tools = await runner._build_runtime_tools(user_id=None)

    assert tools == []
    assert captured["tool_ids"] == ["web_search"]


@pytest.mark.asyncio
async def test_enhanced_system_prompt_injects_ceo_preferences_first(monkeypatch):
    config = SimpleNamespace(
        id="agent-pref",
        name="Maya",
        org_id="org-1",
        model="test-model",
        tools=[],
        system_prompt="You are a sharp research analyst.",
        persona_name=None,
    )
    runner = AgentRunner(config, memory_service=_NoopMemoryService())

    class _FakeResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return self._items

    pref = AgentMemoryEntry(
        id="pref-1",
        agent_id="agent-pref",
        org_id="org-1",
        mem0_memory_id="local:pref-1",
        content_preview="Keep responses under 400 words.",
        memory_type="ceo_preference",
        importance_score=1.0,
        always_inject=True,
        source="manual",
    )

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def scalar(self, *_args, **_kwargs):
            return 0

        async def execute(self, *_args, **_kwargs):
            return _FakeResult([pref])

    monkeypatch.setattr(agent_runner_module, "AsyncSessionLocal", lambda: _FakeSession())

    async def _business_context(_user_id=None):
        return "BUSINESS CONTEXT"

    async def _learning_context():
        return "LEARNING CONTEXT"

    async def _memory_context(**_kwargs):
        return "LIVING MEMORY"

    monkeypatch.setattr(runner, "_build_business_context", _business_context)
    monkeypatch.setattr(runner, "_build_learning_context", _learning_context)
    monkeypatch.setattr(agent_runner_module.agent_memory_service, "build_memory_context", _memory_context)

    prompt = await runner._build_enhanced_system_prompt("Write the update")

    assert prompt.startswith("CEO PREFERENCES — ALWAYS FOLLOW THESE:")
    assert "- Keep responses under 400 words." in prompt
    assert "BUSINESS CONTEXT" in prompt
    assert "LIVING MEMORY" in prompt


@pytest.mark.asyncio
async def test_enhanced_system_prompt_injects_client_knowledge_and_org_variables(monkeypatch):
    config = SimpleNamespace(
        id="agent-client",
        name="Jordan",
        org_id="org-1",
        model="test-model",
        tools=[],
        system_prompt="You are writing for {{agency_name}} in a {{agency_voice}} voice.",
        persona_name=None,
    )
    runner = AgentRunner(config, memory_service=_NoopMemoryService())
    runner._context = {
        "execution_client_id": "client-1",
    }

    class _FakeResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return self._items

    pref = AgentMemoryEntry(
        id="pref-1",
        agent_id="agent-client",
        org_id="org-1",
        mem0_memory_id="local:pref-1",
        content_preview="Keep it concise.",
        memory_type="ceo_preference",
        importance_score=1.0,
        always_inject=True,
        source="manual",
    )
    knowledge = ClientKnowledge(
        id="knowledge-1",
        org_id="org-1",
        client_id="client-1",
        content="The client prefers direct recommendations over long prose.",
        category="preference",
        confidence=0.91,
    )
    agency_name = OrgVariable(
        id="var-1",
        org_id="org-1",
        key="agency_name",
        value="Aethon Labs",
        description="Agency name",
    )
    agency_voice = OrgVariable(
        id="var-2",
        org_id="org-1",
        key="agency_voice",
        value="clear and executive",
        description="House voice",
    )

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def scalar(self, *_args, **_kwargs):
            return 0

        async def execute(self, statement, *_args, **_kwargs):
            text = str(statement)
            if "agent_memory_entries" in text:
                return _FakeResult([pref])
            if "client_knowledge" in text:
                return _FakeResult([knowledge])
            if "org_variables" in text:
                return _FakeResult([agency_name, agency_voice])
            return _FakeResult([])

    monkeypatch.setattr(agent_runner_module, "AsyncSessionLocal", lambda: _FakeSession())

    async def _business_context(_user_id=None):
        return "BUSINESS CONTEXT"

    async def _learning_context():
        return "LEARNING CONTEXT"

    async def _memory_context(**_kwargs):
        return "LIVING MEMORY"

    monkeypatch.setattr(runner, "_build_business_context", _business_context)
    monkeypatch.setattr(runner, "_build_learning_context", _learning_context)
    monkeypatch.setattr(agent_runner_module.agent_memory_service, "build_memory_context", _memory_context)

    prompt = await runner._build_enhanced_system_prompt("Draft the update")

    assert "WHAT WE KNOW ABOUT THIS CLIENT:" in prompt
    assert "- The client prefers direct recommendations over long prose." in prompt
    assert "ORG CONTEXT (use these in your responses):" in prompt
    assert "agency_name: Aethon Labs" in prompt
    assert "agency_voice: clear and executive" in prompt
    assert "{{agency_name}}" not in prompt
    assert "Aethon Labs" in prompt
    assert "clear and executive voice" in prompt


@pytest.mark.asyncio
async def test_finalize_trust_skips_auto_update_for_review_required_workflow(db, test_agent, test_workflow, monkeypatch):
    test_workflow.requires_review = True
    execution = Execution(
        org_id=test_workflow.org_id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="Needs review",
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    runner = AgentRunner(test_agent, memory_service=_NoopMemoryService())
    runner._context = {"execution_id": execution.id}

    called = False

    async def _fake_record_task_completed(**_kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(
        agent_runner_module.trust_score_service,
        "record_task_completed",
        _fake_record_task_completed,
    )

    await runner._finalize_trust_and_status(success=True, tools_called=[], db=db)

    assert called is False


@pytest.mark.asyncio
async def test_finalize_trust_still_auto_updates_when_review_not_required(db, test_agent, test_workflow, monkeypatch):
    execution = Execution(
        org_id=test_workflow.org_id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.running,
        input_message="No review needed",
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    runner = AgentRunner(test_agent, memory_service=_NoopMemoryService())
    runner._context = {"execution_id": execution.id}

    captured: dict[str, object] = {}

    async def _fake_record_task_completed(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(
        agent_runner_module.trust_score_service,
        "record_task_completed",
        _fake_record_task_completed,
    )

    await runner._finalize_trust_and_status(success=True, tools_called=["web_search"], db=db)

    assert captured["agent_id"] == test_agent.id
    assert captured["success"] is True
    assert captured["tools_used"] == ["web_search"]

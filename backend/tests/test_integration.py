import asyncio
import os
import re
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import api.approvals as approvals_api
import database.db as database_db_module
import runtime.agent_runner as agent_runner_module
import runtime.graph_builder as graph_builder_module
import services.hitl_service as hitl_service_module
from config import settings
from database.models import (
    Agent,
    ApprovalStatus,
    CompanyProfile,
    Execution,
    ExecutionStatus,
    HumanApprovalRequest,
    ToolCallLog,
    Workflow,
)
from runtime.agent_runner import AgentRunner
from runtime.graph_builder import WorkflowExecutor
from runtime.workflow_engine import WorkflowEngine
from services.memory_service import MemoryService
from services.websocket_manager import ws_manager


pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def _sentence_count(text: str) -> int:
    return len([part for part in re.split(r"[.!?]+", text) if part.strip()])


def _require_real_llm(monkeypatch) -> None:
    api_key = os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_COMPATIBLE_API_KEY")
    if not api_key:
        pytest.skip("GROQ_API_KEY or OPENAI_COMPATIBLE_API_KEY is not set")

    base_url = os.getenv("OPENAI_COMPATIBLE_BASE_URL") or "https://api.groq.com/openai/v1"
    monkeypatch.setattr(settings, "openai_compatible_api_key", api_key, raising=False)
    monkeypatch.setattr(settings, "openai_compatible_base_url", base_url, raising=False)
    monkeypatch.setattr(settings, "default_model", "llama-3.1-8b-instant", raising=False)


def _patch_session_factories(monkeypatch, db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(database_db_module, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(agent_runner_module, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(graph_builder_module, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(hitl_service_module, "AsyncSessionLocal", session_factory)
    return session_factory


class _FakeRedisBroker:
    def __init__(self):
        self.queue: asyncio.Queue[str] = asyncio.Queue()


class _FakePubSub:
    def __init__(self, broker: _FakeRedisBroker):
        self.broker = broker

    async def subscribe(self, *args, **kwargs):
        return None

    async def get_message(self, ignore_subscribe_messages=True, timeout=1.0):
        try:
            payload = await asyncio.wait_for(self.broker.queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        return {"type": "message", "data": payload}

    async def unsubscribe(self, *args, **kwargs):
        return None

    async def aclose(self):
        return None


class _FakeRedisClient:
    def __init__(self, broker: _FakeRedisBroker):
        self.broker = broker

    def pubsub(self):
        return _FakePubSub(self.broker)

    async def publish(self, channel: str, message: str):
        await self.broker.queue.put(message)
        return 1

    async def aclose(self):
        return None


def _patch_hitl_redis(monkeypatch):
    broker = _FakeRedisBroker()
    monkeypatch.setattr(
        hitl_service_module.redis,
        "from_url",
        lambda *args, **kwargs: _FakeRedisClient(broker),
    )
    monkeypatch.setattr(
        approvals_api.redis,
        "from_url",
        lambda *args, **kwargs: _FakeRedisClient(broker),
    )
    return broker


@pytest.mark.integration
async def test_single_agent_produces_coherent_output(monkeypatch, test_org, db):
    _require_real_llm(monkeypatch)

    agent = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Math Tutor",
        role="math tutor",
        description="A concise math tutor",
        system_prompt="You are a math tutor. Answer math questions concisely.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )

    runner = AgentRunner(agent)
    result, _tokens = await runner.run(
        "What is 15% of 240?",
        thread_id="test_thread_1",
        execution_id="test_exec_1",
    )

    assert result is not None
    assert len(result.strip()) > 0
    assert "36" in result
    assert "error" not in result.lower()
    assert "sorry" not in result.lower()


@pytest.mark.integration
async def test_agent_uses_web_search_tool(monkeypatch, db, db_engine, test_org, test_user):
    _require_real_llm(monkeypatch)
    _patch_session_factories(monkeypatch, db_engine)

    agent = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Researcher",
        role="researcher",
        description="Uses web search for current info",
        system_prompt=(
            "You are a researcher. You MUST use web_search before answering. "
            "Find the official FastAPI website and briefly explain what FastAPI is."
        ),
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=512,
        tools=["web_intelligence"],
    )
    db.add(agent)
    await db.commit()

    ws_manager.log_buffer.clear()
    runner = AgentRunner(agent)
    result, _tokens = await runner.run(
        "What is FastAPI?",
        user_id=test_user.id,
        thread_id="integration-web-search",
    )

    assert "fastapi" in result.lower()
    assert len(result) > 100

    logs = (
        await db.execute(
            select(ToolCallLog).where(
                ToolCallLog.agent_id == agent.id,
                ToolCallLog.tool_name == "web_intelligence",
            )
        )
    ).scalars().all()
    assert logs, "Expected at least one persisted web_intelligence tool call"


@pytest.mark.integration
async def test_sequential_workflow_passes_context(monkeypatch, test_org):
    _require_real_llm(monkeypatch)

    writer = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Writer",
        role="writer",
        description="Writes concise summaries",
        system_prompt="Write exactly 2 sentences summarizing Python.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    editor = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Editor",
        role="editor",
        description="Fixes grammar only",
        system_prompt="Fix grammar only. Return the corrected text in 2 sentences max. Do not expand the content.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    workflow = Workflow(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Writer to Editor",
        description="Sequential writing flow",
        nodes=[
            {"id": "writer-node", "type": "agentNode", "data": {"agent_id": writer.id}},
            {"id": "editor-node", "type": "agentNode", "data": {"agent_id": editor.id}},
        ],
        edges=[{"source": "writer-node", "target": "editor-node"}],
        execution_mode="sequential",
        trigger="manual",
        status="draft",
    )

    executor = WorkflowExecutor(
        workflow,
        {writer.id: writer, editor.id: editor},
    )
    result, _tokens = await executor.execute(
        "Write a 2-sentence summary of Python",
        execution_id=str(uuid4()),
    )

    assert "python" in result.lower()
    assert _sentence_count(result) <= 3


@pytest.mark.integration
async def test_agent_respects_business_context(monkeypatch, db, db_engine, test_org, test_user):
    _require_real_llm(monkeypatch)
    _patch_session_factories(monkeypatch, db_engine)

    profile = CompanyProfile(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        company_name="FinCore Labs",
        mission="Build financial infrastructure software",
        industry="fintech",
        stage="growth",
        monthly_revenue=5000,
        runway_months=8,
        onboarding_complete=True,
    )
    agent = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="CFO Agent",
        role="cfo",
        description="Financial strategist",
        system_prompt="You are a CFO. Evaluate spending with strong attention to runway and budget risk.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    db.add_all([profile, agent])
    await db.commit()

    runner = AgentRunner(agent)
    result, _tokens = await runner.run(
        "Should we hire a contractor for $10,000?",
        user_id=test_user.id,
        thread_id="business-context-test",
    )
    lower = result.lower()

    assert any(term in lower for term in ["runway", "budget", "cash", "revenue"])
    assert not lower.strip().startswith("yes, hire")


@pytest.mark.integration
async def test_agent_memory_persists_across_runs(monkeypatch, tmp_path, test_org):
    _require_real_llm(monkeypatch)

    chroma_dir = tmp_path / "integration-chroma"
    monkeypatch.setattr(settings, "chroma_persist_dir", str(chroma_dir), raising=False)

    agent = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Rememberer",
        role="assistant",
        description="Remembers user details",
        system_prompt="You are a helpful assistant who remembers user details accurately.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    memory_service = MemoryService()
    memory_config = SimpleNamespace(
        memory_enabled=True,
        max_memories_per_query=5,
        memory_window_days=30,
    )
    runner = AgentRunner(agent, memory_service=memory_service, memory_config=memory_config)

    await runner.run(
        "My name is Alex and I build fintech products.",
        thread_id="memory-test-thread",
    )
    result, _tokens = await runner.run(
        "What do you know about me?",
        thread_id="memory-test-thread",
    )
    lower = result.lower()

    assert "alex" in lower
    assert "fintech" in lower


@pytest.mark.integration
async def test_retry_on_rate_limit(monkeypatch, test_org):
    class DummyMemoryService:
        async def retrieve_relevant_memory(self, *args, **kwargs):
            return []

        async def store_memory(self, *args, **kwargs):
            return None

    class DummyBusinessContextService:
        async def get_context_for_agent(self, *args, **kwargs):
            return ""

    class DummyReputationService:
        async def get_learning_context(self, *args, **kwargs):
            return ""

    agent = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Retry Agent",
        role="assistant",
        description="Retries on transient failures",
        system_prompt="You are resilient.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
        max_retries=3,
        retry_delay_seconds=1,
    )
    runner = AgentRunner(
        agent,
        memory_service=DummyMemoryService(),
        business_context_service=DummyBusinessContextService(),
        reputation_service=DummyReputationService(),
    )
    attempts = {"count": 0}

    async def fake_sleep(_seconds):
        return None

    async def fake_build_runtime_tools(*args, **kwargs):
        return []

    async def fake_build_prompt(*args, **kwargs):
        return runner.config.system_prompt

    async def fake_invoke_agent(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise RuntimeError("Rate limit exceeded from upstream provider")
        return "Recovered after retries", 11

    monkeypatch.setattr(agent_runner_module.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(runner, "_build_runtime_tools", fake_build_runtime_tools)
    monkeypatch.setattr(runner, "_build_enhanced_system_prompt", fake_build_prompt)
    monkeypatch.setattr(runner, "_invoke_agent", fake_invoke_agent)
    ws_manager.log_buffer.clear()

    result, _tokens = await runner.run("Please recover")

    retry_events = [
        event
        for event in ws_manager.log_buffer
        if event.get("type") == "agent_retry" and event.get("agent_id") == agent.id
    ]
    assert result == "Recovered after retries"
    assert len(retry_events) == 2


@pytest.mark.integration
async def test_parallel_agents_all_complete(monkeypatch, test_org):
    _require_real_llm(monkeypatch)

    researcher = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Researcher",
        role="researcher",
        description="Researches the topic",
        system_prompt="Respond with one short paragraph prefixed exactly with 'Research:'.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    writer = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Writer",
        role="writer",
        description="Writes narrative framing",
        system_prompt="Respond with one short paragraph prefixed exactly with 'Writer:'.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    analyst = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Analyst",
        role="analyst",
        description="Analyzes implications",
        system_prompt="Respond with one short paragraph prefixed exactly with 'Analyst:'.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    workflow = Workflow(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Parallel Analysis",
        description="Parallel multi-agent flow",
        nodes=[
            {
                "id": "parallel-1",
                "type": "parallel_group",
                "data": {
                    "label": "Parallel Team",
                    "agent_ids": [researcher.id, writer.id, analyst.id],
                    "merge_strategy": "concatenate",
                    "merge_separator": "\n\n---\n\n",
                },
            }
        ],
        edges=[],
        execution_mode="sequential",
        trigger="manual",
        status="draft",
    )

    executor = WorkflowExecutor(
        workflow,
        {
            researcher.id: researcher,
            writer.id: writer,
            analyst.id: analyst,
        },
    )
    result, _tokens = await executor.execute(
        "Analyze the impact of AI on jobs",
        execution_id=str(uuid4()),
    )

    lower = result.lower()
    assert "research:" in lower
    assert "writer:" in lower
    assert "analyst:" in lower


@pytest.mark.integration
async def test_hitl_approval_flow(monkeypatch, authed_client, db, db_engine, test_org, test_user):
    _require_real_llm(monkeypatch)
    session_factory = _patch_session_factories(monkeypatch, db_engine)
    _patch_hitl_redis(monkeypatch)

    reviewer = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Reviewer",
        role="reviewer",
        description="Produces an initial draft",
        system_prompt="Reply with one concise sentence confirming the task.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    finisher = Agent(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Finisher",
        role="finisher",
        description="Finishes after approval",
        system_prompt="Reply with one concise completion sentence.",
        model="llama-3.1-8b-instant",
        temperature=0.1,
        max_tokens=256,
        tools=[],
    )
    workflow = Workflow(
        id=str(uuid4()),
        org_id=test_org.id,
        name="HITL Flow",
        description="Workflow with an approval gate",
        nodes=[
            {"id": "draft-node", "type": "agentNode", "data": {"agent_id": reviewer.id}},
            {"id": "approval-node", "type": "approval", "data": {"title": "Approve this output"}},
            {"id": "finish-node", "type": "agentNode", "data": {"agent_id": finisher.id}},
        ],
        edges=[
            {"source": "draft-node", "target": "approval-node"},
            {"source": "approval-node", "target": "finish-node"},
        ],
        execution_mode="sequential",
        trigger="manual",
        status="draft",
    )
    execution = Execution(
        id=str(uuid4()),
        org_id=test_org.id,
        workflow_id=workflow.id,
        trigger="manual",
        status=ExecutionStatus.running,
        input_message="Prepare the approved response",
    )
    db.add_all([reviewer, finisher, workflow, execution])
    await db.commit()

    async def run_engine():
        async with session_factory() as session:
            engine = WorkflowEngine(session)
            return await engine.run(
                workflow_id=workflow.id,
                input_message="Prepare the approved response",
                user_id=test_user.id,
                execution_id=execution.id,
            )

    task = asyncio.create_task(run_engine())

    approval = None
    current_execution = None
    for _ in range(60):
        await asyncio.sleep(0.1)
        await db.rollback()
        approval = await db.scalar(
            select(HumanApprovalRequest).where(HumanApprovalRequest.execution_id == execution.id)
        )
        current_execution = await db.scalar(select(Execution).where(Execution.id == execution.id))
        if approval and current_execution and current_execution.status == ExecutionStatus.waiting_approval:
            break

    assert approval is not None
    assert current_execution.status == ExecutionStatus.waiting_approval

    approve_response = await authed_client.post(
        f"/api/approvals/{approval.id}/approve",
        json={"comment": "Looks good"},
    )
    assert approve_response.status_code == 200

    output, _tokens = await asyncio.wait_for(task, timeout=30)
    await db.rollback()
    final_execution = await db.scalar(select(Execution).where(Execution.id == execution.id))
    final_approval = await db.scalar(select(HumanApprovalRequest).where(HumanApprovalRequest.id == approval.id))

    assert output
    assert final_execution.status == ExecutionStatus.completed
    assert final_execution.status != ExecutionStatus.waiting_approval
    assert final_approval is not None
    assert final_approval.status == ApprovalStatus.approved

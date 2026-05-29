from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import (
    ApprovalStatus,
    CTOMemory,
    CTOMemoryType,
    CTOTask,
    CTOTaskStatus,
    CTOAuthority,
    Client,
    CompanyChatMessage,
    Execution,
    ExecutionStatus,
    FileStatus,
    FileType,
    HumanApprovalRequest,
    Mission,
    MissionTask,
    MissionTaskStatus,
    OrgFile,
    Workflow,
)


@pytest.mark.asyncio
async def test_persist_message_marks_proactive(db):
    from api import company_chat as company_chat_module

    await company_chat_module._persist_message(
        conversation_id="conv-proactive",
        org_id="org-1",
        user_id="user-1",
        role="system",
        content="CTO proactive update",
        is_proactive=True,
        db=db,
    )

    message = await db.scalar(
        select(CompanyChatMessage).where(CompanyChatMessage.conversation_id == "conv-proactive")
    )

    assert message is not None
    assert message.is_proactive is True


def test_system_prompt_includes_cto_sections():
    from api import company_chat as company_chat_module

    context = {
        "org": SimpleNamespace(name="Aethon Labs"),
        "profile": None,
        "agents": [],
        "workflows": [],
        "executions": [],
        "approvals": [],
        "listings": [],
        "eval_suites": [],
    }
    cto_tasks = [
        SimpleNamespace(
            status=SimpleNamespace(value="monitoring"),
            original_request="Handle Acme weekly deliverables",
            ceo_action_needed=None,
        )
    ]
    cto_memories = [
        SimpleNamespace(content="Acme always wants bullet points"),
    ]
    cto_authority = SimpleNamespace(
        auto_approve_portal=True,
        auto_run_workflows=True,
        auto_create_missions=True,
        auto_approve_patterns=False,
    )

    prompt = company_chat_module._system_prompt(context, cto_tasks, cto_memories, cto_authority)

    assert "You are the CTO of Aethon Labs." in prompt
    assert "TASKS I OWN:" in prompt
    assert "[MONITORING] Handle Acme weekly deliverables" in prompt
    assert "WHAT I REMEMBER ABOUT THIS ORG:" in prompt
    assert "Acme always wants bullet points" in prompt
    assert "MY AUTHORITY (do these without asking CEO):" in prompt
    assert "portal deliveries" in prompt
    assert "create_cto_task" in prompt
    assert "cto_memory_add" in prompt
    assert "cto_status" in prompt
    assert "search_files" in prompt
    assert "open_document" in prompt
    assert "reference_file" in prompt


def test_cto_ownership_detector_handles_report_back_language():
    from services.cto_operator_service import looks_like_cto_ownership_request

    assert looks_like_cto_ownership_request("Create a mission for Acme and report me back after it is done") is True
    assert looks_like_cto_ownership_request("Start a mission and let me know when it's done") is True


@pytest.mark.asyncio
async def test_execute_action_handles_cto_actions(db, test_org, test_user):
    from api import company_chat as company_chat_module

    create_result = await company_chat_module._execute_action(
        {
            "type": "create_cto_task",
            "request": "Handle Acme weekly deliverables",
            "plan": "1. Research 2. Write 3. Deliver",
            "conversation_id": "conv-cto",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert create_result["type"] == "create_cto_task"
    assert create_result["success"] is True

    task = await db.scalar(
        select(CTOTask).where(CTOTask.org_id == test_org.id, CTOTask.conversation_id == "conv-cto")
    )
    assert task is not None
    assert task.original_request == "Handle Acme weekly deliverables"

    memory_result = await company_chat_module._execute_action(
        {
            "type": "cto_memory_add",
            "memory_type": "client_preference",
            "content": "Acme always wants bullet points",
            "entity_name": "Acme",
            "entity_type": "client",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert memory_result["type"] == "cto_memory_add"
    memory = await db.scalar(select(CTOMemory).where(CTOMemory.org_id == test_org.id))
    assert memory is not None
    assert memory.memory_type == CTOMemoryType.client_preference
    assert memory.entity_name == "Acme"

    status_result = await company_chat_module._execute_action(
        {"type": "cto_status"},
        test_user.id,
        test_org.id,
        db,
    )

    assert status_result["type"] == "cto_status"
    assert status_result["success"] is True
    assert len(status_result["tasks"]) == 1
    assert status_result["tasks"][0]["request"] == "Handle Acme weekly deliverables"


@pytest.mark.asyncio
async def test_execute_action_handles_file_actions(monkeypatch, db, test_org, test_user):
    from api import company_chat as company_chat_module

    client = Client(org_id=test_org.id, name="Acme", company_name="Acme Corp")
    db.add(client)
    await db.commit()
    await db.refresh(client)

    ready_file = OrgFile(
        id="file-acme-1",
        org_id=test_org.id,
        client_id=client.id,
        name="Acme Q2 Research.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/org-1/clients/acme/documents/file-acme-1/research.md",
        extracted_text="Acme competitor research and positioning notes",
        content_type="text/markdown",
    )
    db.add(ready_file)
    await db.commit()

    async def fake_search_org_files(query, org_id, client_name=None, limit=8):
        return f"Found 1 file(s) matching '{query}':\n- ID: file-acme-1"

    async def fake_read_org_file(file_id, org_id):
        if org_id != test_org.id:
            return "File not found or not accessible."
        return "=== File: Acme Q2 Research.md ===\n---\nFull file content for strategy planning."

    async def fake_write_document(*, org_id, file_id, content, content_type, client_id=None, filename="document.json"):
        assert org_id == test_org.id
        assert content_type == "application/json"
        return f"orgs/{org_id}/clients/{client_id}/documents/{file_id}/{filename}"

    monkeypatch.setattr("api.company_chat.search_org_files", fake_search_org_files, raising=False)
    monkeypatch.setattr("tools.storage.file_tools.search_org_files", fake_search_org_files)
    monkeypatch.setattr("tools.storage.file_tools.read_org_file", fake_read_org_file)
    monkeypatch.setattr("api.company_chat.storage_service.write_document", fake_write_document)

    search_result = await company_chat_module._execute_action(
        {"type": "search_files", "query": "Acme Q2 research", "client_name": "Acme"},
        test_user.id,
        test_org.id,
        db,
    )
    assert search_result["type"] == "search_files"
    assert search_result["success"] is True
    assert len(search_result["files"]) == 1
    assert search_result["files"][0]["id"] == "file-acme-1"

    open_result = await company_chat_module._execute_action(
        {"type": "open_document", "name": "Content Strategy Q3", "client_name": "Acme"},
        test_user.id,
        test_org.id,
        db,
    )
    assert open_result["type"] == "open_document"
    assert open_result["success"] is True
    assert open_result["navigate_to"] == f"/files/{open_result['file_id']}/edit"

    created_doc = await db.scalar(select(OrgFile).where(OrgFile.id == open_result["file_id"]))
    assert created_doc is not None
    assert created_doc.file_type == FileType.document
    assert created_doc.collab_room == open_result["collab_room"]

    reference_result = await company_chat_module._execute_action(
        {"type": "reference_file", "file_id": "file-acme-1", "context": "Use this as background"},
        test_user.id,
        test_org.id,
        db,
    )
    assert reference_result["type"] == "reference_file"
    assert reference_result["success"] is True
    assert "Full file content for strategy planning." in reference_result["content"]
    assert "Referenced file context" in reference_result["history_message"]


@pytest.mark.asyncio
async def test_search_files_falls_back_to_latest_files_for_broad_queries(monkeypatch, db, test_org, test_user):
    from api import company_chat as company_chat_module

    client = Client(
        org_id=test_org.id,
        name="Atlas",
        company_name="Atlas Corp",
        color="#6366F1",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    ready_file = OrgFile(
        id="file-atlas-1",
        org_id=test_org.id,
        client_id=client.id,
        name="atlas-research.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/test/clients/atlas/documents/atlas-research.md",
        extracted_text="Atlas positioning and customer research",
        content_type="text/markdown",
    )
    db.add(ready_file)
    await db.commit()

    async def fake_search_org_files(query, org_id, client_name=None, limit=8):
        return f"No files found matching '{query}'. The organization may not have any stored files yet."

    monkeypatch.setattr("tools.storage.file_tools.search_org_files", fake_search_org_files)

    result = await company_chat_module._execute_action(
        {"type": "search_files", "query": "What research have we done for clients?"},
        test_user.id,
        test_org.id,
        db,
    )

    assert result["success"] is True
    assert len(result["files"]) == 1
    assert result["files"][0]["id"] == "file-atlas-1"
    assert result["message"] == "No exact matches for 'What research have we done for clients?'. Showing the latest files in your workspace instead."


@pytest.mark.asyncio
async def test_run_workflow_requires_cto_workflow_authority(db, test_org, test_user):
    from api import company_chat as company_chat_module

    workflow = Workflow(
        org_id=test_org.id,
        name="Weekly Brief",
        description="Prepare the weekly brief",
        nodes=[],
        edges=[],
        trigger="manual",
        status="active",
    )
    authority = CTOAuthority(
        org_id=test_org.id,
        auto_run_workflows=False,
    )
    task = CTOTask(
        org_id=test_org.id,
        original_request="Handle Acme weekly deliverables",
        status=CTOTaskStatus.monitoring,
        conversation_id="conv-auth-workflow",
    )
    db.add_all([workflow, authority, task])
    await db.commit()

    result = await company_chat_module._execute_action(
        {
            "type": "run_workflow",
            "workflow_id": workflow.id,
            "input": "Run the weekly brief",
            "conversation_id": "conv-auth-workflow",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert result["type"] == "run_workflow"
    assert result["success"] is False
    assert result["requires_confirmation"] is True
    assert "requires ceo confirmation" in result["message"].lower()

    await db.refresh(task)
    assert task.status == CTOTaskStatus.waiting_ceo
    assert "workflow" in (task.ceo_action_needed or "").lower()


@pytest.mark.asyncio
async def test_create_mission_requires_cto_mission_authority(db, test_org, test_user):
    from api import company_chat as company_chat_module

    authority = CTOAuthority(
        org_id=test_org.id,
        auto_create_missions=False,
    )
    task = CTOTask(
        org_id=test_org.id,
        original_request="Handle Acme weekly deliverables",
        status=CTOTaskStatus.monitoring,
        conversation_id="conv-auth-mission",
    )
    db.add_all([authority, task])
    await db.commit()

    result = await company_chat_module._execute_action(
        {
            "type": "create_mission",
            "goal": "Handle Acme weekly deliverables",
            "conversation_id": "conv-auth-mission",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert result["type"] == "create_mission"
    assert result["success"] is False
    assert result["requires_confirmation"] is True
    assert "requires your approval" in result["message"].lower()

    await db.refresh(task)
    assert task.status == CTOTaskStatus.waiting_ceo
    assert "mission" in (task.ceo_action_needed or "").lower()


@pytest.mark.asyncio
async def test_sync_cto_dispatch_for_mission_spawns_watch_task(monkeypatch, db, test_org, test_user):
    from api import company_chat as company_chat_module
    import services.cto_task_service as cto_task_service_module

    captured_task_ids: list[str] = []
    spawned: list[object] = []

    async def fake_watch_task(task_id: str):
        captured_task_ids.append(task_id)

    def fake_spawn_background_task(coro):
        spawned.append(coro)
        return None

    monkeypatch.setattr(cto_task_service_module.cto_task_service, "watch_task", fake_watch_task)
    monkeypatch.setattr(company_chat_module, "_spawn_background_task", fake_spawn_background_task)

    task = CTOTask(
        org_id=test_org.id,
        original_request="Research Acme and prepare a project brief",
        status=CTOTaskStatus.active,
        conversation_id="conv-watch",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    await company_chat_module._sync_cto_dispatch_for_conversation(
        org_id=test_org.id,
        conversation_id="conv-watch",
        request_text="Research Acme and prepare a project brief",
        action_results=[
            {
                "type": "mission_created",
                "mission_id": "mission-123",
                "success": True,
            }
        ],
        db=db,
        task_plan="1. Research 2. Draft 3. Deliver",
        ensure_task=False,
    )
    assert len(spawned) == 1
    await spawned[0]

    await db.refresh(task)

    assert task.mission_id == "mission-123"
    assert task.status == CTOTaskStatus.monitoring
    assert captured_task_ids == [str(task.id)]


@pytest.mark.asyncio
async def test_run_workflow_respects_cto_spend_cap_with_unknown_cost(db, test_org, test_user):
    from api import company_chat as company_chat_module

    workflow = Workflow(
        org_id=test_org.id,
        name="Weekly Brief",
        description="Prepare the weekly brief",
        nodes=[],
        edges=[],
        trigger="manual",
        status="active",
    )
    authority = CTOAuthority(
        org_id=test_org.id,
        auto_run_workflows=True,
        max_auto_spend_usd=5.0,
    )
    task = CTOTask(
        org_id=test_org.id,
        original_request="Handle Acme weekly deliverables",
        status=CTOTaskStatus.monitoring,
        conversation_id="conv-auth-budget",
    )
    db.add_all([workflow, authority, task])
    await db.commit()

    result = await company_chat_module._execute_action(
        {
            "type": "run_workflow",
            "workflow_id": workflow.id,
            "input": "Run the weekly brief",
            "conversation_id": "conv-auth-budget",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert result["type"] == "error"
    assert result["success"] is False
    assert "cost estimate" in result["message"].lower()

    await db.refresh(task)
    assert task.status == CTOTaskStatus.waiting_ceo
    assert "cost" in (task.ceo_action_needed or "").lower()


@pytest.mark.asyncio
async def test_bulk_approve_requires_explicit_or_learned_authority(db, test_org, test_user):
    from api import company_chat as company_chat_module

    workflow = Workflow(
        id="wf-bulk-approve-1",
        org_id=test_org.id,
        name="Approve Me",
        description="Workflow needing approval",
        nodes=[],
        edges=[],
        trigger="manual",
        status="active",
    )
    pending = HumanApprovalRequest(
        workflow_id="wf-bulk-approve-1",
        execution_id="exec-1",
        node_id="node-1",
        title="Review this",
        description="Needs review",
        status=ApprovalStatus.pending,
        resume_token="resume-1",
    )
    authority = CTOAuthority(
        org_id=test_org.id,
        auto_approve_patterns=False,
        auto_approve_action_types=[],
    )
    task = CTOTask(
        org_id=test_org.id,
        original_request="Clear routine approvals",
        status=CTOTaskStatus.monitoring,
        conversation_id="conv-auth-approve",
    )
    db.add_all([workflow, pending, authority, task])
    await db.commit()

    blocked = await company_chat_module._execute_action(
        {
            "type": "bulk_approve",
            "conversation_id": "conv-auth-approve",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert blocked["type"] == "error"
    assert blocked["success"] is False
    assert "not authorized" in blocked["label"].lower()

    await db.refresh(task)
    assert task.status == CTOTaskStatus.waiting_ceo

    authority.auto_approve_action_types = ["bulk_approve"]
    task.status = CTOTaskStatus.monitoring
    task.ceo_action_needed = None
    pending.status = ApprovalStatus.pending
    await db.commit()

    allowed = await company_chat_module._execute_action(
        {
            "type": "bulk_approve",
            "conversation_id": "conv-auth-approve",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert allowed["type"] == "bulk_approve"
    assert allowed["success"] is True

    await db.refresh(pending)
    assert pending.status == ApprovalStatus.approved


@pytest.mark.asyncio
async def test_run_workflow_uses_lazy_default_authority_when_missing(db, test_org, test_user):
    from api import company_chat as company_chat_module

    workflow = Workflow(
        org_id=test_org.id,
        name="Weekly Brief",
        description="Prepare the weekly brief",
        nodes=[],
        edges=[],
        trigger="manual",
        status="active",
    )
    db.add(workflow)
    await db.commit()

    async def fake_enqueue(*_args, **_kwargs):
        return None

    from api import executions as executions_module

    original_enqueue = executions_module.enqueue_workflow_execution
    executions_module.enqueue_workflow_execution = fake_enqueue

    try:
        result = await company_chat_module._execute_action(
            {
                "type": "run_workflow",
                "workflow_id": workflow.id,
                "input": "Run the weekly brief",
                "conversation_id": "conv-default-authority",
            },
            test_user.id,
            test_org.id,
            db,
        )
    finally:
        executions_module.enqueue_workflow_execution = original_enqueue

    assert result["type"] == "run_workflow"
    assert result["success"] is True

    authority = await db.scalar(select(CTOAuthority).where(CTOAuthority.org_id == test_org.id))
    assert authority is not None
    assert authority.auto_run_workflows is True
    assert authority.auto_create_missions is True
    assert authority.auto_approve_portal is True


@pytest.mark.asyncio
async def test_deliver_execution_requires_portal_authority(db, test_org, test_user):
    from api import company_chat as company_chat_module

    client = Client(
        id="client-portal-1",
        org_id=test_org.id,
        name="Acme",
        company_name="Acme Corp",
        portal_enabled=False,
    )
    workflow = Workflow(
        id="workflow-portal-1",
        org_id=test_org.id,
        name="Weekly Brief",
        description="Prepare the weekly brief",
        nodes=[],
        edges=[],
        trigger="manual",
        status="active",
        requires_review=True,
    )
    authority = CTOAuthority(
        org_id=test_org.id,
        auto_approve_portal=False,
    )
    execution = Execution(
        id="execution-portal-1",
        org_id=test_org.id,
        workflow_id=workflow.id,
        client_id=client.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Prepare the weekly brief",
        output_message="Ready for the client.",
        started_at=datetime.utcnow(),
        approved_at=datetime.utcnow(),
    )
    db.add_all([client, workflow, authority, execution])
    await db.commit()

    result = await company_chat_module._execute_action(
        {
            "type": "deliver_execution",
            "execution_id": execution.id,
            "method": "portal",
            "conversation_id": "conv-portal-delivery",
        },
        test_user.id,
        test_org.id,
        db,
    )

    assert result["type"] == "deliver_execution"
    assert result["success"] is False
    assert result["requires_confirmation"] is True
    assert "portal delivery requires your approval" in result["message"].lower()


@pytest.mark.asyncio
async def test_bulk_approve_allows_repeated_workflow_approval_pattern(db, test_org, test_user):
    from api import company_chat as company_chat_module

    workflow = Workflow(
        id="wf-bulk-approve-2",
        org_id=test_org.id,
        name="Approve Me",
        description="Workflow needing approval",
        nodes=[],
        edges=[],
        trigger="manual",
        status="active",
    )
    pending = HumanApprovalRequest(
        workflow_id="wf-bulk-approve-2",
        execution_id="exec-2",
        node_id="node-2",
        title="Review this too",
        description="Needs review",
        status=ApprovalStatus.pending,
        resume_token="resume-2",
    )
    authority = CTOAuthority(
        org_id=test_org.id,
        auto_approve_patterns=True,
        auto_approve_action_types=[],
    )
    learned_pattern = CTOMemory(
        org_id=test_org.id,
        memory_type=CTOMemoryType.approval_pattern,
        content="CEO approved workflow approvals repeatedly",
        entity_name="workflow_approval",
        entity_type="action_type",
        observation_count=3,
        confidence=0.8,
        source="approval",
    )
    db.add_all([workflow, pending, authority, learned_pattern])
    await db.commit()

    result = await company_chat_module._execute_action(
        {"type": "bulk_approve", "conversation_id": "conv-pattern-approve"},
        test_user.id,
        test_org.id,
        db,
    )

    assert result["type"] == "bulk_approve"
    assert result["success"] is True

    await db.refresh(pending)
    assert pending.status == ApprovalStatus.approved


@pytest.mark.asyncio
async def test_company_chat_stream_injects_cto_context_and_links_mission(
    monkeypatch,
    db_engine,
    authed_client,
    db,
    test_org,
    test_user,
):
    from api import company_chat as company_chat_module
    from services import cto_memory_service as cto_memory_service_module
    from services import cto_task_service as cto_task_service_module
    from services.goal_decomposer import goal_decomposer
    from tasks.mission_tasks import run_mission_task

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(cto_task_service_module, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(cto_memory_service_module, "AsyncSessionLocal", session_factory)

    captured = {"llm_called": False, "watch_started": False}

    client = Client(org_id=test_org.id, name="Acme", company_name="Acme Corp")
    db.add(client)
    await db.commit()

    class FakeChunk:
        def __init__(self, content: str):
            self.content = content

    class FakeLLM:
        async def astream(self, messages):
            captured["llm_called"] = True
            text = (
                "On it."
                '<action>{"type":"create_cto_task","request":"Handle Acme weekly deliverables",'
                '"plan":"1. Maya research 2. Jordan write 3. Deliver portal"}</action>'
                '<action>{"type":"create_mission","goal":"Handle Acme weekly deliverables","client_name":"Acme"}</action>'
            )
            yield FakeChunk(text)

    mission = Mission(
        org_id=test_org.id,
        client_id=client.id,
        goal="Handle Acme weekly deliverables",
        title="Acme weekly deliverables",
        created_by=test_user.id,
    )
    task_one = MissionTask(
        org_id=test_org.id,
        mission_id="pending",
        sequence=1,
        title="Research",
        status=MissionTaskStatus.pending,
    )

    async def fake_create_mission(goal, org_id, client_id, created_by, db):
        db.add(mission)
        await db.flush()
        task_one.mission_id = mission.id
        db.add(task_one)
        await db.commit()
        await db.refresh(mission)
        return mission

    class FakeDelay:
        def __call__(self, mission_id):
            return mission_id

    def fake_create_task(coro):
        captured["watch_started"] = True
        coro.close()
        return None

    monkeypatch.setattr(company_chat_module, "build_llm", lambda *args, **kwargs: FakeLLM())
    monkeypatch.setattr(goal_decomposer, "create_mission", fake_create_mission)
    monkeypatch.setattr(run_mission_task, "delay", FakeDelay())
    monkeypatch.setattr(company_chat_module, "_spawn_background_task", fake_create_task)

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "Handle Acme weekly deliverables"},
    )

    assert response.status_code == 200
    assert response.headers["x-accel-buffering"] == "no"
    assert "no-cache" in response.headers["cache-control"]

    stored_task = await db.scalar(
        select(CTOTask).where(CTOTask.org_id == test_org.id).order_by(CTOTask.created_at.desc())
    )
    assert stored_task is not None
    assert stored_task.conversation_id
    assert stored_task.mission_id == mission.id
    assert captured["watch_started"] is True
    assert captured["llm_called"] is False


@pytest.mark.asyncio
async def test_company_chat_returns_fallback_for_empty_successful_llm_reply(
    monkeypatch,
    authed_client,
    db,
    test_org,
):
    from api import company_chat as company_chat_module

    class EmptyLLM:
        async def astream(self, messages):
            if False:
                yield messages

    monkeypatch.setattr(company_chat_module, "build_llm", lambda *args, **kwargs: EmptyLLM())

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "nice"},
    )

    assert response.status_code == 200

    lines = [line for line in response.text.splitlines() if line.strip()]
    assert any('"type": "text"' in line and '"Got it."' in line for line in lines)

    stored_message = await db.scalar(
        select(CompanyChatMessage)
        .where(
            CompanyChatMessage.org_id == test_org.id,
            CompanyChatMessage.role == "assistant",
        )
        .order_by(CompanyChatMessage.created_at.desc())
    )

    assert stored_message is not None
    assert stored_message.content == "Got it."


@pytest.mark.asyncio
async def test_cto_endpoints_return_tasks_memories_and_authority(
    monkeypatch,
    db_engine,
    authed_client,
    db,
    test_org,
):
    from services import cto_memory_service as cto_memory_service_module
    from services import cto_task_service as cto_task_service_module

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(cto_task_service_module, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(cto_memory_service_module, "AsyncSessionLocal", session_factory)

    authority = CTOAuthority(org_id=test_org.id)
    task = CTOTask(
        org_id=test_org.id,
        original_request="Handle Acme weekly deliverables",
        status=CTOTaskStatus.monitoring,
        conversation_id="conv-1",
    )
    memory = CTOMemory(
        org_id=test_org.id,
        memory_type=CTOMemoryType.client_preference,
        content="Acme always wants bullet points",
        entity_name="Acme",
        entity_type="client",
        source="explicit",
    )
    db.add_all([authority, task, memory])
    await db.commit()
    await db.refresh(memory)

    tasks_response = await authed_client.get("/api/company/company-chat/cto/tasks")
    assert tasks_response.status_code == 200
    assert tasks_response.json()["tasks"][0]["request"] == "Handle Acme weekly deliverables"

    memories_response = await authed_client.get("/api/company/company-chat/cto/memories")
    assert memories_response.status_code == 200
    assert memories_response.json()["memories"][0]["content"] == "Acme always wants bullet points"

    authority_response = await authed_client.get("/api/company/company-chat/cto/authority")
    assert authority_response.status_code == 200
    assert authority_response.json()["auto_approve_portal"] is True

    patch_response = await authed_client.patch(
        "/api/company/company-chat/cto/authority",
        json={"auto_approve_patterns": True, "max_auto_spend_usd": 25.0},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["auto_approve_patterns"] is True
    assert patch_response.json()["max_auto_spend_usd"] == 25.0

    delete_response = await authed_client.delete(f"/api/company/company-chat/cto/memories/{memory.id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True


@pytest.mark.asyncio
async def test_cto_memory_create_and_task_patch_endpoints(
    monkeypatch,
    db_engine,
    authed_client,
    db,
    test_org,
):
    from services import cto_memory_service as cto_memory_service_module
    from services import cto_task_service as cto_task_service_module

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(cto_task_service_module, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(cto_memory_service_module, "AsyncSessionLocal", session_factory)

    task = CTOTask(
        org_id=test_org.id,
        original_request="Handle Acme weekly deliverables",
        status=CTOTaskStatus.monitoring,
        conversation_id="conv-1",
        plan="1. Research 2. Deliver",
    )
    db.add(task)
    await db.commit()

    create_response = await authed_client.post(
        "/api/company/company-chat/cto/memories",
        json={
            "memory_type": "client_preference",
            "content": "Acme prefers bullet points in weekly updates",
            "entity_name": "Acme",
            "entity_type": "client",
        },
    )
    assert create_response.status_code == 200
    created_memory = create_response.json()["memory"]
    assert created_memory["memory_type"] == "client_preference"
    assert created_memory["content"] == "Acme prefers bullet points in weekly updates"

    patch_response = await authed_client.patch(
        f"/api/company/company-chat/cto/tasks/{task.id}",
        json={"status": "complete", "outcome_summary": "Closed manually from settings"},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["task"]["status"] == "complete"
    assert patch_response.json()["task"]["outcome_summary"] == "Closed manually from settings"

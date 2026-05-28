import json

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import CTOMemory, CTOMemoryType, CTOTask, CTOTaskStatus, CTOAuthority, Client, Mission


def stream_events(response) -> list[dict]:
    return [
        json.loads(line)
        for line in response.text.splitlines()
        if line.strip()
    ]


@pytest.mark.asyncio
async def test_company_chat_auto_creates_cto_task_for_owned_mission_request(
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

    captured = {"watch_started": False}

    class FakeChunk:
        def __init__(self, content: str):
            self.content = content

    class FakeLLM:
        async def astream(self, messages):
            yield FakeChunk(
                'On it. <action>{"type":"create_mission","goal":"Handle Acme weekly deliverables","client_name":"Acme"}</action>'
            )

    created_mission = Mission(
        org_id=test_org.id,
        client_id=None,
        goal="Handle Acme weekly deliverables",
        title="Acme weekly deliverables",
        created_by=test_user.id,
    )

    async def fake_create_mission(goal, org_id, client_id, created_by, db):
        db.add(created_mission)
        await db.commit()
        await db.refresh(created_mission)
        return created_mission

    def fake_spawn_task(coro):
        captured["watch_started"] = True
        coro.close()
        return None

    monkeypatch.setattr(company_chat_module, "build_llm", lambda *args, **kwargs: FakeLLM())
    monkeypatch.setattr(goal_decomposer, "create_mission", fake_create_mission)
    monkeypatch.setattr(run_mission_task, "delay", lambda mission_id: mission_id)
    monkeypatch.setattr(company_chat_module, "_spawn_background_task", fake_spawn_task)

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "Handle Acme weekly deliverables"},
    )

    assert response.status_code == 200

    task = await db.scalar(
        select(CTOTask)
        .where(CTOTask.org_id == test_org.id)
        .order_by(CTOTask.created_at.desc())
    )

    assert task is not None
    assert task.original_request == "Handle Acme weekly deliverables"
    assert task.mission_id == created_mission.id
    assert task.plan
    assert "mission" in task.plan.lower() or "deliverables" in task.plan.lower()
    assert captured["watch_started"] is True


@pytest.mark.asyncio
async def test_company_chat_deterministically_dispatches_owned_request_without_llm_action(
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

    captured = {"watch_started": False}

    class FakeChunk:
        def __init__(self, content: str):
            self.content = content

    class FakeLLM:
        async def astream(self, messages):
            yield FakeChunk("On it.")

    created_mission = Mission(
        org_id=test_org.id,
        client_id=None,
        goal="Handle Acme weekly deliverables",
        title="Acme weekly deliverables",
        created_by=test_user.id,
    )

    async def fake_create_mission(goal, org_id, client_id, created_by, db):
        db.add(created_mission)
        await db.commit()
        await db.refresh(created_mission)
        return created_mission

    def fake_spawn_task(coro):
        captured["watch_started"] = True
        coro.close()
        return None

    monkeypatch.setattr(company_chat_module, "build_llm", lambda *args, **kwargs: FakeLLM())
    monkeypatch.setattr(goal_decomposer, "create_mission", fake_create_mission)
    monkeypatch.setattr(run_mission_task, "delay", lambda mission_id: mission_id)
    monkeypatch.setattr(company_chat_module, "_spawn_background_task", fake_spawn_task)

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "Handle Acme weekly deliverables"},
    )

    assert response.status_code == 200
    events = stream_events(response)

    assert any(event.get("type") == "action" and event.get("action", {}).get("type") == "mission_created" for event in events)
    assert any("taking ownership" in (event.get("content", "") or "").lower() for event in events if event.get("type") == "text")

    task = await db.scalar(
        select(CTOTask)
        .where(CTOTask.org_id == test_org.id)
        .order_by(CTOTask.created_at.desc())
    )

    assert task is not None
    assert task.original_request == "Handle Acme weekly deliverables"
    assert task.mission_id == created_mission.id
    assert captured["watch_started"] is True


@pytest.mark.asyncio
async def test_company_chat_deterministically_reports_cto_status_without_llm(
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
        conversation_id="conv-status",
    )
    db.add(task)
    await db.commit()

    def fail_if_llm_called(*args, **kwargs):
        raise AssertionError("LLM should not be used for deterministic CTO status requests")

    monkeypatch.setattr("api.company_chat.build_llm", fail_if_llm_called)

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "What are you handling right now?"},
    )

    assert response.status_code == 200
    events = stream_events(response)
    text_chunks = "".join(event.get("content", "") for event in events if event.get("type") == "text")
    assert "Handle Acme weekly deliverables" in text_chunks
    assert any(event.get("type") == "action" and event.get("action", {}).get("type") == "cto_status" for event in events)


@pytest.mark.asyncio
async def test_company_chat_deterministically_records_explicit_memory_without_llm(
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

    client = Client(
        org_id=test_org.id,
        name="Acme",
        company_name="Acme Corp",
    )
    db.add(client)
    await db.commit()

    def fail_if_llm_called(*args, **kwargs):
        raise AssertionError("LLM should not be used for deterministic CTO memory capture")

    monkeypatch.setattr("api.company_chat.build_llm", fail_if_llm_called)

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "Always use bullet points for Acme."},
    )

    assert response.status_code == 200
    events = stream_events(response)
    text_chunks = "".join(event.get("content", "") for event in events if event.get("type") == "text")
    assert "remember" in text_chunks.lower()

    memory = await db.scalar(
        select(CTOMemory)
        .where(CTOMemory.org_id == test_org.id)
        .order_by(CTOMemory.created_at.desc())
    )
    assert memory is not None
    assert memory.memory_type == CTOMemoryType.client_preference
    assert memory.entity_name == "Acme"


@pytest.mark.asyncio
async def test_company_chat_owned_request_waits_for_ceo_when_missions_disallowed(
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

    authority = CTOAuthority(
        org_id=test_org.id,
        auto_create_missions=False,
    )
    db.add(authority)
    await db.commit()

    def fail_if_llm_called(*args, **kwargs):
        raise AssertionError("LLM should not be used for deterministic owned-task orchestration")

    monkeypatch.setattr("api.company_chat.build_llm", fail_if_llm_called)

    response = await authed_client.post(
        "/api/company/chat",
        json={"message": "Handle Acme weekly deliverables"},
    )

    assert response.status_code == 200
    events = stream_events(response)
    assert any(event.get("type") == "action" and event.get("action", {}).get("needs_ceo") is True for event in events)

    task = await db.scalar(
        select(CTOTask)
        .where(CTOTask.org_id == test_org.id)
        .order_by(CTOTask.created_at.desc())
    )
    assert task is not None
    assert task.status == CTOTaskStatus.waiting_ceo
    assert "mission" in (task.ceo_action_needed or "").lower()

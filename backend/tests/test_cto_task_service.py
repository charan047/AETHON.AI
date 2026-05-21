import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from api import company_chat as company_chat_module
from database.models import (
    CTOMemory,
    CTOTask,
    CTOTaskStatus,
    CompanyConversation,
    InAppNotification,
    Mission,
    MissionStatus,
)


@pytest_asyncio.fixture
async def cto_task_service_module():
    import services.cto_task_service as cto_task_service_module

    return cto_task_service_module


@pytest.mark.asyncio
async def test_create_task_persists_monitoring_record(
    db_engine,
    test_org,
    cto_task_service_module,
):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cto_task_service_module, "AsyncSessionLocal", session_factory)
    cto_task_service = cto_task_service_module.cto_task_service

    task = await cto_task_service.create_task(
        org_id=test_org.id,
        request="Handle Acme weekly deliverables",
        plan="Dispatch Maya, then Jordan.",
        conversation_id="conv-1",
        mission_id="mission-1",
        execution_ids=["exec-1", "exec-2"],
        db=None,
    )

    async with session_factory() as verify_db:
        stored = await verify_db.scalar(select(CTOTask).where(CTOTask.id == task.id))

    assert stored is not None
    assert stored.org_id == test_org.id
    assert stored.original_request == "Handle Acme weekly deliverables"
    assert stored.plan == "Dispatch Maya, then Jordan."
    assert stored.status == CTOTaskStatus.monitoring
    assert stored.mission_id == "mission-1"
    assert stored.execution_ids == ["exec-1", "exec-2"]
    assert stored.conversation_id == "conv-1"
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_get_active_tasks_returns_only_non_terminal_statuses(
    db_engine,
    test_org,
    cto_task_service_module,
):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cto_task_service_module, "AsyncSessionLocal", session_factory)
    cto_task_service = cto_task_service_module.cto_task_service

    async with session_factory() as seed_db:
        seed_db.add_all(
            [
                CTOTask(
                    org_id=test_org.id,
                    original_request="active task",
                    status=CTOTaskStatus.active,
                    conversation_id="conv-a",
                ),
                CTOTask(
                    org_id=test_org.id,
                    original_request="monitoring task",
                    status=CTOTaskStatus.monitoring,
                    conversation_id="conv-b",
                ),
                CTOTask(
                    org_id=test_org.id,
                    original_request="waiting task",
                    status=CTOTaskStatus.waiting_ceo,
                    conversation_id="conv-c",
                ),
                CTOTask(
                    org_id=test_org.id,
                    original_request="done task",
                    status=CTOTaskStatus.complete,
                    conversation_id="conv-d",
                ),
                CTOTask(
                    org_id=test_org.id,
                    original_request="failed task",
                    status=CTOTaskStatus.failed,
                    conversation_id="conv-e",
                ),
            ]
        )
        await seed_db.commit()

    tasks = await cto_task_service.get_active_tasks(test_org.id)
    requests = {task.original_request for task in tasks}

    assert requests == {"active task", "monitoring task", "waiting task"}
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_watch_task_completes_task_sends_update_and_extracts_learning(
    monkeypatch,
    db_engine,
    test_org,
    test_user,
    cto_task_service_module,
):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(cto_task_service_module, "AsyncSessionLocal", session_factory)

    captured_messages: list[dict] = []
    captured_broadcasts: list[tuple[str, dict]] = []

    class DummyLLM:
        async def ainvoke(self, _messages):
            class Response:
                content = "Acme deliverables are complete. Weekly brief is ready for review."

            return Response()

    async def fake_sleep(_seconds):
        return None

    async def fake_persist_message(
        conversation_id,
        org_id,
        user_id,
        role,
        content,
        actions=None,
        attachments=None,
        is_proactive=False,
        db=None,
    ):
        captured_messages.append(
            {
                "conversation_id": conversation_id,
                "org_id": org_id,
                "user_id": user_id,
                "role": role,
                "content": content,
                "is_proactive": is_proactive,
            }
        )

    async def fake_broadcast(channel, payload):
        captured_broadcasts.append((channel, payload))

    async def fake_get_relevant(_org_id, _request, _db):
        return []

    monkeypatch.setattr(cto_task_service_module.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(company_chat_module, "_persist_message", fake_persist_message)
    monkeypatch.setattr(cto_task_service_module.ws_manager, "broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr(cto_task_service_module.cto_memory_service, "get_relevant", fake_get_relevant)
    monkeypatch.setattr(cto_task_service_module, "build_llm", lambda *args, **kwargs: DummyLLM())

    async with session_factory() as seed_db:
        conversation = CompanyConversation(
            id="conv-cto",
            org_id=test_org.id,
            user_id=test_user.id,
            title="CTO thread",
            message_count=0,
        )
        mission = Mission(
            org_id=test_org.id,
            goal="Handle Acme weekly deliverables",
            title="Acme weekly deliverables",
            status=MissionStatus.completed,
            report="Lindy raised $20M. Jordan added it to the brief.",
            created_by=test_user.id,
        )
        seed_db.add_all([conversation, mission])
        await seed_db.commit()
        await seed_db.refresh(mission)

        task = CTOTask(
            org_id=test_org.id,
            original_request="Handle Acme weekly deliverables",
            plan="Maya researches, Jordan drafts, then portal delivery.",
            status=CTOTaskStatus.monitoring,
            mission_id=mission.id,
            conversation_id=conversation.id,
        )
        seed_db.add(task)
        await seed_db.commit()
        await seed_db.refresh(task)
        task_id = task.id

    await cto_task_service_module.cto_task_service.watch_task(task_id)

    async with session_factory() as verify_db:
        stored_task = await verify_db.scalar(select(CTOTask).where(CTOTask.id == task_id))
        memories = (
            await verify_db.execute(select(CTOMemory).where(CTOMemory.org_id == test_org.id))
        ).scalars().all()
        notifications = (
            await verify_db.execute(
                select(InAppNotification).where(
                    InAppNotification.org_id == test_org.id,
                    InAppNotification.user_id == test_user.id,
                )
            )
        ).scalars().all()
        notification_count = await verify_db.scalar(
            select(func.count()).select_from(InAppNotification).where(
                InAppNotification.org_id == test_org.id,
                InAppNotification.user_id == test_user.id,
            )
        )

    assert stored_task.status == CTOTaskStatus.complete
    assert stored_task.completed_at is not None
    assert stored_task.completion_notified is True
    assert "Mission complete: Acme weekly deliverables" in (stored_task.outcome_summary or "")
    assert len(memories) == 1
    assert memories[0].content.startswith("Request: 'Handle Acme weekly deliverables'")
    assert notification_count == 1
    assert notifications[0].title == "CTO Update"
    assert len(captured_messages) == 1
    assert captured_messages[0]["conversation_id"] == "conv-cto"
    assert captured_messages[0]["user_id"] == test_user.id
    assert captured_messages[0]["role"] == "system"
    assert "Acme deliverables are complete" in captured_messages[0]["content"]
    assert captured_messages[0]["is_proactive"] is True
    assert len(captured_broadcasts) == 1
    assert captured_broadcasts[0][0] == f"org:{test_org.id}"
    assert captured_broadcasts[0][1]["event"] == "cto_proactive_message"

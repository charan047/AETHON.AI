import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy import select

from database.models import Agent, Client, Execution, ExecutionStatus, FileStatus, FileType, Mission, MissionStatus, MissionTask, MissionTaskStatus, OrgFile, OrgStorageQuota, Workflow
from services.mission_orchestrator import MissionOrchestrator


@pytest.mark.asyncio
async def test_orchestrator_dispatches_parallel_before_dependent(monkeypatch, db, db_engine, test_org, test_user):
    mission = Mission(
        org_id=test_org.id,
        goal="Research and summarize Acme competitors",
        title="Acme mission",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    t1 = MissionTask(org_id=test_org.id, mission_id=mission.id, sequence=1, title="Parallel A", status=MissionTaskStatus.pending)
    t2 = MissionTask(org_id=test_org.id, mission_id=mission.id, sequence=1, title="Parallel B", status=MissionTaskStatus.pending)
    db.add_all([t1, t2])
    await db.commit()
    await db.refresh(t1)
    await db.refresh(t2)
    t3 = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=2,
        title="Dependent C",
        depends_on=f"{t1.id},{t2.id}",
        status=MissionTaskStatus.pending,
    )
    db.add(t3)
    await db.commit()
    await db.refresh(t3)

    dispatched: list[str] = []
    finalized = {"called": False}

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def fake_dispatch(self, task, _all_tasks, _mission):
        dispatched.append(task.id)
        async with session_factory() as session:
            current = await session.scalar(select(MissionTask).where(MissionTask.id == task.id))
            current.status = MissionTaskStatus.completed
            current.output_summary = f"output for {task.title}"
            await session.commit()

    async def fake_finalize(self, mission_id, tasks):
        finalized["called"] = True
        async with session_factory() as session:
            current = await session.scalar(select(Mission).where(Mission.id == mission_id))
            current.status = MissionStatus.completed
            current.report = "done"
            await session.commit()

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(MissionOrchestrator, "_dispatch_task", fake_dispatch)
    monkeypatch.setattr(MissionOrchestrator, "_finalize_mission", fake_finalize)
    monkeypatch.setattr("services.mission_orchestrator.asyncio.sleep", no_sleep)

    orchestrator = MissionOrchestrator()
    await orchestrator._orchestrate(mission.id)

    assert set(dispatched[:2]) == {t1.id, t2.id}
    assert dispatched[2] == t3.id
    assert finalized["called"] is True


@pytest.mark.asyncio
async def test_dispatch_task_includes_dependency_output_context(monkeypatch, db, db_engine, test_org, test_user, test_agent):
    mission = Mission(
        org_id=test_org.id,
        goal="Build an Acme strategy brief",
        title="Acme strategy",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    test_agent.org_id = test_org.id
    test_agent.is_active = True
    await db.commit()

    workflow = Workflow(
        org_id=test_org.id,
        name="Agent Workflow",
        description="Single agent workflow",
        nodes=[{"id": "node_1", "type": "agentNode", "data": {"agent_id": test_agent.id, "label": test_agent.name}}],
        edges=[],
        trigger="manual",
        status="draft",
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)

    dep = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Research",
        status=MissionTaskStatus.completed,
        output_summary="Acme competitors are Alpha and Beta with mid-market pricing.",
    )
    db.add(dep)
    await db.commit()
    await db.refresh(dep)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=2,
        title="Write brief",
        description="Write the final client brief.",
        agent_id=test_agent.id,
        depends_on=dep.id,
        status=MissionTaskStatus.pending,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    captured = {}

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **_kwargs):
        captured["execution_id"] = execution_id
        captured["workflow_id"] = workflow_id
        captured["input_message"] = input_message
        captured["user_id"] = user_id
        captured["org_id"] = org_id
        return "background"

    async def fake_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    monkeypatch.setattr("services.mission_orchestrator.enqueue_workflow_execution", fake_enqueue)
    monkeypatch.setattr("services.mission_orchestrator.ws_manager.broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr(MissionOrchestrator, "_monitor_task_completion", fake_broadcast)

    orchestrator = MissionOrchestrator()
    await orchestrator._dispatch_task(task, [dep, task], mission)

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        stored_task = await verify_db.scalar(select(MissionTask).where(MissionTask.id == task.id))
        execution = await verify_db.scalar(select(Execution).where(Execution.id == stored_task.execution_id))

    assert stored_task.status == MissionTaskStatus.running
    assert execution is not None
    assert execution.status == ExecutionStatus.pending
    assert "Mission goal: Build an Acme strategy brief" in captured["input_message"]
    assert "Summary from 'Research':" in captured["input_message"]
    assert "Acme competitors are Alpha and Beta" in captured["input_message"]
    assert "Your task: Write the final client brief." in captured["input_message"]


@pytest.mark.asyncio
async def test_dispatch_task_prefers_full_dependency_file_context(monkeypatch, db, db_engine, test_org, test_user, test_agent):
    mission = Mission(
        org_id=test_org.id,
        goal="Build an Acme strategy brief",
        title="Acme strategy",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    test_agent.org_id = test_org.id
    test_agent.is_active = True
    await db.commit()

    workflow = Workflow(
        org_id=test_org.id,
        name="Agent Workflow",
        description="Single agent workflow",
        nodes=[{"id": "node_1", "type": "agentNode", "data": {"agent_id": test_agent.id, "label": test_agent.name}}],
        edges=[],
        trigger="manual",
        status="draft",
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)

    dep = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Research",
        status=MissionTaskStatus.completed,
        output_summary="Short summary that should not be used when a file exists.",
        output_file_id="file-dep-1",
    )
    org_file = OrgFile(
        id="file-dep-1",
        org_id=test_org.id,
        mission_id=mission.id,
        name="research-output.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/test/documents/research-output.md",
        size_bytes=4096,
        content_type="text/markdown",
    )
    db.add_all([dep, org_file])
    await db.commit()
    await db.refresh(dep)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=2,
        title="Write brief",
        description="Write the final client brief.",
        agent_id=test_agent.id,
        depends_on=dep.id,
        status=MissionTaskStatus.pending,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    long_content = "Acme full research brief.\n" + ("Detailed finding.\n" * 120)
    captured = {}

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **_kwargs):
        captured["input_message"] = input_message
        return "background"

    async def fake_broadcast(*_args, **_kwargs):
        return None

    async def fake_read_document(_storage_key):
        return long_content.encode("utf-8")

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    monkeypatch.setattr("services.mission_orchestrator.enqueue_workflow_execution", fake_enqueue)
    monkeypatch.setattr("services.mission_orchestrator.ws_manager.broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr("services.mission_orchestrator.storage_service.read_document", fake_read_document)
    monkeypatch.setattr(MissionOrchestrator, "_monitor_task_completion", fake_broadcast)

    orchestrator = MissionOrchestrator()
    await orchestrator._dispatch_task(task, [dep, task], mission)

    assert "Full output from 'Research':" in captured["input_message"]
    assert long_content.strip() in captured["input_message"]
    assert "Short summary that should not be used" not in captured["input_message"]


@pytest.mark.asyncio
async def test_dispatch_task_assigns_fallback_agent_when_missing(monkeypatch, db, db_engine, test_org, test_user, test_agent, caplog):
    mission = Mission(
        org_id=test_org.id,
        goal="Research top selling Amazon products",
        title="Amazon mission",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    test_agent.org_id = test_org.id
    test_agent.is_active = True
    test_agent.trust_score = 77.0
    await db.commit()

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Identify products",
        description="Find top sellers.",
        agent_id=None,
        status=MissionTaskStatus.pending,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    captured = {}

    async def fake_find_or_create_workflow_for_agent(self, *, agent, mission, db):
        workflow = Workflow(
            id="wf-fallback",
            org_id=test_org.id,
            name="Fallback Workflow",
            description="Auto workflow",
            nodes=[],
            edges=[],
            trigger="manual",
            status="draft",
        )
        db.add(workflow)
        await db.flush()
        return workflow

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **_kwargs):
        captured["execution_id"] = execution_id
        captured["workflow_id"] = workflow_id
        return "background"

    async def fake_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(MissionOrchestrator, "_find_or_create_workflow_for_agent", fake_find_or_create_workflow_for_agent)
    monkeypatch.setattr("services.mission_orchestrator.enqueue_workflow_execution", fake_enqueue)
    monkeypatch.setattr("services.mission_orchestrator.ws_manager.broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr(MissionOrchestrator, "_monitor_task_completion", fake_broadcast)

    orchestrator = MissionOrchestrator()
    with caplog.at_level("INFO"):
        await orchestrator._dispatch_task(task, [task], mission)

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        stored_task = await verify_db.scalar(select(MissionTask).where(MissionTask.id == task.id))

    assert stored_task.agent_id == test_agent.id
    assert stored_task.status == MissionTaskStatus.running
    assert stored_task.execution_id is not None
    assert "using fallback agent" in caplog.text


@pytest.mark.asyncio
async def test_dispatch_task_skips_with_clear_reason_when_no_active_agents(monkeypatch, db, db_engine, test_org, test_user):
    mission = Mission(
        org_id=test_org.id,
        goal="Research top selling Amazon products",
        title="Amazon mission",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Identify products",
        description="Find top sellers.",
        agent_id=None,
        status=MissionTaskStatus.pending,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )

    orchestrator = MissionOrchestrator()
    await orchestrator._dispatch_task(task, [task], mission)

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        stored_task = await verify_db.scalar(select(MissionTask).where(MissionTask.id == task.id))

    assert stored_task.agent_id is None
    assert stored_task.status == MissionTaskStatus.skipped
    assert stored_task.output_summary == "No active agents"


@pytest.mark.asyncio
async def test_orchestrator_reconciles_completed_execution_without_monitor(monkeypatch, db, db_engine, test_org, test_user):
    mission = Mission(
        org_id=test_org.id,
        goal="Finish a live mission safely",
        title="Acme reconciliation",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    execution = Execution(
        org_id=test_org.id,
        workflow_id="wf-1",
        trigger="mission",
        status=ExecutionStatus.completed,
        input_message="run",
        output_message="final answer",
        started_at=mission.created_at,
        completed_at=mission.created_at,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Final task",
        status=MissionTaskStatus.running,
        execution_id=execution.id,
        started_at=mission.created_at,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )

    finalized = {}

    async def fake_finalize(self, mission_id, tasks):
        finalized["mission_id"] = mission_id
        finalized["statuses"] = [task.status for task in tasks]
        async with async_sessionmaker(db_engine, expire_on_commit=False)() as session:
            current = await session.scalar(select(Mission).where(Mission.id == mission_id))
            current.status = MissionStatus.completed
            current.report = "done"
            await session.commit()

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(MissionOrchestrator, "_finalize_mission", fake_finalize)
    monkeypatch.setattr("services.mission_orchestrator.asyncio.sleep", no_sleep)

    orchestrator = MissionOrchestrator()
    await orchestrator._orchestrate(mission.id)

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        stored_task = await verify_db.scalar(select(MissionTask).where(MissionTask.id == task.id))
        stored_mission = await verify_db.scalar(select(Mission).where(Mission.id == mission.id))

    assert stored_task.status == MissionTaskStatus.completed
    assert stored_task.output_summary == "final answer"
    assert finalized["mission_id"] == mission.id
    assert stored_mission.status == MissionStatus.completed


@pytest.mark.asyncio
async def test_monitor_task_completion_saves_full_output_as_org_file(monkeypatch, db, db_engine, test_org, test_user):
    mission = Mission(
        org_id=test_org.id,
        goal="Prepare a market brief",
        title="Market brief",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    execution = Execution(
        org_id=test_org.id,
        workflow_id="wf-1",
        trigger="mission",
        status=ExecutionStatus.completed,
        input_message="run",
        output_message="## Acme Research\n\n" + ("Long form finding. " * 40),
        started_at=mission.created_at,
        completed_at=mission.created_at,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Research the market",
        status=MissionTaskStatus.running,
        execution_id=execution.id,
        started_at=mission.created_at,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    async def fake_broadcast(*_args, **_kwargs):
        return None

    async def fake_write_document(*, org_id, file_id, content, content_type, client_id=None, filename="document.json"):
        assert org_id == test_org.id
        assert content_type == "text/markdown"
        assert filename.endswith(".md")
        return f"orgs/{org_id}/shared/documents/{file_id}/{filename}"

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    monkeypatch.setattr("services.mission_orchestrator.ws_manager.broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr("services.mission_orchestrator.storage_service.write_document", fake_write_document)

    orchestrator = MissionOrchestrator()
    await orchestrator._monitor_task_completion(task.id, execution.id, mission.id)

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        stored_task = await verify_db.scalar(select(MissionTask).where(MissionTask.id == task.id))
        stored_file = await verify_db.scalar(select(OrgFile).where(OrgFile.id == stored_task.output_file_id))
        quota = await verify_db.scalar(select(OrgStorageQuota).where(OrgStorageQuota.org_id == test_org.id))

    assert stored_task.status == MissionTaskStatus.completed
    assert stored_task.output_file_id is not None
    assert stored_file is not None
    assert stored_file.mission_id == mission.id
    assert stored_file.execution_id == execution.id
    assert stored_file.status == FileStatus.ready
    assert quota is not None
    assert int(quota.used_bytes or 0) >= len(execution.output_message.encode("utf-8"))


@pytest.mark.asyncio
async def test_orchestrator_marks_capability_mismatch_output_as_failed(monkeypatch, db, db_engine, test_org, test_user, test_agent):
    mission = Mission(
        org_id=test_org.id,
        goal="Research Amazon products",
        title="Amazon mission",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    test_agent.org_id = test_org.id
    test_agent.tools = ["web_search", "web_scrape"]
    await db.commit()

    execution = Execution(
        org_id=test_org.id,
        workflow_id="wf-1",
        trigger="mission",
        status=ExecutionStatus.completed,
        input_message="run",
        output_message="I’m unable to perform the required research because no applicable search or browsing tool is available.",
        started_at=mission.created_at,
        completed_at=mission.created_at,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Research the request",
        status=MissionTaskStatus.running,
        execution_id=execution.id,
        agent_id=test_agent.id,
        started_at=mission.created_at,
    )
    db.add(task)
    await db.commit()

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )

    orchestrator = MissionOrchestrator()
    await orchestrator._reconcile_running_tasks(mission.id, test_org.id)

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        refreshed_task = await verify_db.scalar(select(MissionTask).where(MissionTask.mission_id == mission.id))

    assert refreshed_task.status == MissionTaskStatus.failed


@pytest.mark.asyncio
async def test_finalize_mission_does_not_auto_deliver_report_to_portal(monkeypatch, db, db_engine, test_org, test_user):
    client = Client(
        org_id=test_org.id,
        name="Acme",
        company_name="Acme Corp",
        portal_enabled=True,
        portal_token="portal-token",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    mission = Mission(
        org_id=test_org.id,
        client_id=client.id,
        goal="Prepare Acme weekly report",
        title="Acme Weekly",
        status=MissionStatus.active,
        created_by=test_user.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    task = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Draft report",
        status=MissionTaskStatus.completed,
        output_summary="Weekly report draft",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    monkeypatch.setattr(
        "services.mission_orchestrator.AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )

    class FakeResponse:
        content = "## Weekly Report\n\nReady for approval."

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    monkeypatch.setattr(
        "services.mission_orchestrator.model_service._build_from_settings",
        lambda temperature=0.4, max_tokens=1500: FakeLLM(),
    )
    async def fake_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr("services.mission_orchestrator.ws_manager.broadcast_to_channel", fake_broadcast)

    orchestrator = MissionOrchestrator()
    await orchestrator._finalize_mission(mission.id, [task])

    async with async_sessionmaker(db_engine, expire_on_commit=False)() as verify_db:
        stored_mission = await verify_db.scalar(select(Mission).where(Mission.id == mission.id))

    assert stored_mission is not None
    assert stored_mission.status == MissionStatus.completed
    assert stored_mission.report_delivered is False

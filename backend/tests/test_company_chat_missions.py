import pytest

from database.models import Client, Mission, MissionTask, MissionTaskStatus


@pytest.mark.asyncio
async def test_company_chat_create_mission_action_dispatches_run(monkeypatch, db, test_org, test_user):
    client = Client(org_id=test_org.id, name="Acme Corp", company_name="Acme Corp")
    db.add(client)
    await db.commit()
    await db.refresh(client)

    mission = Mission(
        org_id=test_org.id,
        client_id=client.id,
        goal="Research and create a content plan for Acme Corp",
        title="Acme content plan",
        created_by=test_user.id,
    )
    task_one = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=1,
        title="Research",
        status=MissionTaskStatus.pending,
    )
    task_two = MissionTask(
        org_id=test_org.id,
        mission_id=mission.id,
        sequence=2,
        title="Plan",
        status=MissionTaskStatus.pending,
    )

    async def fake_create_mission(goal, org_id, client_id, created_by, db):
        db.add(mission)
        await db.flush()
        task_one.mission_id = mission.id
        task_two.mission_id = mission.id
        db.add_all([task_one, task_two])
        await db.commit()
        await db.refresh(mission)
        return mission

    captured = {}

    class FakeDelay:
        def __call__(self, mission_id):
            captured["mission_id"] = mission_id

    from api import company_chat as company_chat_module
    from services.goal_decomposer import goal_decomposer
    from tasks.mission_tasks import run_mission_task

    monkeypatch.setattr(goal_decomposer, "create_mission", fake_create_mission)
    monkeypatch.setattr(run_mission_task, "delay", FakeDelay())

    result = await company_chat_module._execute_action(
        {"type": "create_mission", "goal": "Research and create a content plan for Acme Corp", "client_name": "Acme"},
        test_user.id,
        test_org.id,
        db,
    )

    assert result["type"] == "mission_created"
    assert result["success"] is True
    assert result["task_count"] == 2
    assert result["mission_title"] == "Acme content plan"
    assert captured["mission_id"] == mission.id

import pytest
from sqlalchemy import select

from database.models import Mission, MissionTask


@pytest.mark.asyncio
async def test_create_mission_decomposes_goal_into_tasks(authed_client, db, test_org, test_agent, monkeypatch):
    class FakeResponse:
        content = """
        {
          "mission_title": "Acme competitor research",
          "tasks": [
            {
              "sequence": 1,
              "title": "Research Acme competitors",
              "description": "Find the main competitors for Acme Corp.",
              "prompt": "Research Acme Corp competitors",
              "agent_name": "tester",
              "depends_on": [],
              "estimated_minutes": 8
            },
            {
              "sequence": 2,
              "title": "Analyze competitor pricing",
              "description": "Review pricing and positioning.",
              "prompt": "Analyze pricing for Acme competitors",
              "agent_name": "tester",
              "depends_on": [1],
              "estimated_minutes": 10
            }
          ]
        }
        """

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    from services import model_service as model_service_module
    from api import missions as missions_module

    dispatched = {}

    monkeypatch.setattr(
        model_service_module.model_service,
        "_build_from_settings",
        lambda temperature=0.3, max_tokens=2000: FakeLLM(),
    )
    monkeypatch.setattr(missions_module.run_mission_task, "delay", lambda mission_id: dispatched.setdefault("mission_id", mission_id))

    response = await authed_client.post(
        "/api/missions",
        json={"goal": "Research competitors for Acme Corp"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["goal"] == "Research competitors for Acme Corp"
    assert payload["title"] == "Acme competitor research"
    assert payload["status"] == "active"
    assert len(payload["tasks"]) == 2
    assert payload["tasks"][0]["title"] == "Research Acme competitors"
    assert payload["tasks"][0]["sequence"] == 1
    assert payload["tasks"][0]["depends_on"] in (None, "", [])
    first_task_id = payload["tasks"][0]["id"]
    assert payload["tasks"][1]["depends_on"] == first_task_id
    assert dispatched["mission_id"] == payload["id"]

    mission = await db.scalar(
        select(Mission).where(Mission.id == payload["id"], Mission.org_id == test_org.id)
    )
    assert mission is not None
    assert mission.goal == "Research competitors for Acme Corp"
    assert mission.title == "Acme competitor research"
    assert mission.status.value == "active"

    tasks = (
        await db.execute(
            select(MissionTask)
            .where(MissionTask.mission_id == mission.id, MissionTask.org_id == test_org.id)
            .order_by(MissionTask.sequence.asc())
        )
    ).scalars().all()
    assert len(tasks) == 2
    assert tasks[0].title == "Research Acme competitors"
    assert tasks[0].agent_id is not None
    assert tasks[0].depends_on is None
    assert tasks[1].title == "Analyze competitor pricing"
    assert tasks[1].depends_on == tasks[0].id


@pytest.mark.asyncio
async def test_create_mission_falls_back_to_best_available_agent_when_name_is_unknown(authed_client, db, test_org, monkeypatch):
    from database.models import Agent, AgentTrustScore

    weaker_agent = Agent(
        org_id=test_org.id,
        name="Operations Generalist",
        role="Operations Generalist",
        role_slug="operations_agent",
        system_prompt="Help with operations tasks.",
        trust_score=41,
        is_active=True,
    )
    stronger_agent = Agent(
        org_id=test_org.id,
        name="Market Researcher",
        role="Market Researcher",
        role_slug="research_agent",
        system_prompt="Research markets and competitors.",
        trust_score=88,
        is_active=True,
    )
    db.add_all([weaker_agent, stronger_agent])
    await db.commit()
    await db.refresh(weaker_agent)
    await db.refresh(stronger_agent)

    db.add_all([
        AgentTrustScore(agent_id=weaker_agent.id, overall_score=41),
        AgentTrustScore(agent_id=stronger_agent.id, overall_score=88),
    ])
    await db.commit()

    class FakeResponse:
        content = """
        {
          "mission_title": "Acme launch plan",
          "tasks": [
            {
              "sequence": 1,
              "title": "Prepare launch narrative",
              "description": "Draft the client narrative and talking points.",
              "prompt": "Prepare a launch narrative",
              "agent_name": "Nonexistent Agent",
              "depends_on": [],
              "estimated_minutes": 12
            }
          ]
        }
        """

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    from services import model_service as model_service_module
    from api import missions as missions_module

    monkeypatch.setattr(
        model_service_module.model_service,
        "_build_from_settings",
        lambda temperature=0.3, max_tokens=2000: FakeLLM(),
    )
    monkeypatch.setattr(missions_module.run_mission_task, "delay", lambda mission_id: mission_id)

    response = await authed_client.post(
        "/api/missions",
        json={"goal": "Plan Acme launch messaging"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "active"
    assert len(payload["tasks"]) == 1
    assert payload["tasks"][0]["title"] == "Prepare launch narrative"
    assert payload["tasks"][0]["agent_id"] == stronger_agent.id

    task = await db.scalar(
        select(MissionTask)
        .where(MissionTask.mission_id == payload["id"], MissionTask.org_id == test_org.id)
    )
    assert task is not None
    assert task.agent_id == stronger_agent.id


@pytest.mark.asyncio
async def test_create_mission_uses_fallback_matching_for_unknown_name(authed_client, db, test_org, test_agent, monkeypatch):
    class FakeResponse:
        content = """
        {
          "mission_title": "Amazon sourcing research",
          "tasks": [
            {
              "sequence": 1,
              "title": "Identify products",
              "description": "Find top selling products.",
              "prompt": "Find products",
              "agent_name": "Research Analyst",
              "depends_on": [],
              "estimated_minutes": 8
            }
          ]
        }
        """

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    from services import model_service as model_service_module
    from api import missions as missions_module

    monkeypatch.setattr(
        model_service_module.model_service,
        "_build_from_settings",
        lambda temperature=0.3, max_tokens=2000: FakeLLM(),
    )
    monkeypatch.setattr(missions_module.run_mission_task, "delay", lambda mission_id: mission_id)

    response = await authed_client.post(
        "/api/missions",
        json={"goal": "Research top selling Amazon products"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["tasks"][0]["agent_id"] == test_agent.id


@pytest.mark.asyncio
async def test_create_mission_falls_back_when_llm_returns_non_json(authed_client, test_agent, monkeypatch):
    class FakeResponse:
        content = "I would break this into research, analysis, and recommendations."

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    from services import model_service as model_service_module
    from api import missions as missions_module

    monkeypatch.setattr(
        model_service_module.model_service,
        "_build_from_settings",
        lambda temperature=0.3, max_tokens=2000: FakeLLM(),
    )
    monkeypatch.setattr(missions_module.run_mission_task, "delay", lambda mission_id: mission_id)

    response = await authed_client.post(
        "/api/missions",
        json={"goal": "Research top selling Amazon products"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "active"
    assert len(payload["tasks"]) == 3
    assert all(task["agent_id"] == test_agent.id for task in payload["tasks"])


@pytest.mark.asyncio
async def test_list_and_report_and_delete_mission(authed_client, db, test_org, monkeypatch):
    from api import missions as missions_module
    from services import model_service as model_service_module
    from database.models import Execution, ExecutionStatus, MissionStatus, MissionTaskStatus

    class FakeResponse:
        content = """
        {
          "mission_title": "Acme report",
          "tasks": [
            {
              "sequence": 1,
              "title": "Research",
              "description": "Research Acme",
              "prompt": "Research Acme",
              "agent_name": "",
              "depends_on": [],
              "estimated_minutes": 8
            }
          ]
        }
        """

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    monkeypatch.setattr(
        model_service_module.model_service,
        "_build_from_settings",
        lambda temperature=0.3, max_tokens=2000: FakeLLM(),
    )
    monkeypatch.setattr(missions_module.run_mission_task, "delay", lambda mission_id: mission_id)

    response = await authed_client.post("/api/missions", json={"goal": "Create Acme report"})
    assert response.status_code == 201
    payload = response.json()
    mission_id = payload["id"]

    mission = await db.scalar(select(Mission).where(Mission.id == mission_id))
    task = await db.scalar(select(MissionTask).where(MissionTask.mission_id == mission_id))
    execution = Execution(
        org_id=test_org.id,
        workflow_id="wf-1",
        trigger="mission",
        status=ExecutionStatus.running,
        input_message="hello",
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    task.execution_id = execution.id
    task.status = MissionTaskStatus.running
    mission.report = "## Done"
    mission.status = MissionStatus.completed
    await db.commit()

    list_response = await authed_client.get("/api/missions")
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == mission_id

    detail_response = await authed_client.get(f"/api/missions/{mission_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["tasks"][0]["execution_id"] == execution.id

    report_response = await authed_client.get(f"/api/missions/{mission_id}/report")
    assert report_response.status_code == 200
    assert report_response.json()["report"] == "## Done"

    delete_response = await authed_client.delete(f"/api/missions/{mission_id}")
    assert delete_response.status_code == 200

    await db.refresh(mission)
    await db.refresh(task)
    await db.refresh(execution)
    assert mission.status.value == "failed"
    assert task.status.value in {"failed", "skipped"}
    assert execution.status.value == "cancelled"


@pytest.mark.asyncio
async def test_retry_mission_creates_new_mission(authed_client, db, test_agent, monkeypatch):
    class FakeResponse:
        content = """
        {
          "mission_title": "Acme retry mission",
          "tasks": [
            {
              "sequence": 1,
              "title": "Research",
              "description": "Research Acme",
              "prompt": "Research Acme",
              "agent_name": "tester",
              "depends_on": [],
              "estimated_minutes": 8
            }
          ]
        }
        """

    class FakeLLM:
        async def ainvoke(self, _prompt: str):
            return FakeResponse()

    from services import model_service as model_service_module
    from api import missions as missions_module

    monkeypatch.setattr(
        model_service_module.model_service,
        "_build_from_settings",
        lambda temperature=0.3, max_tokens=2000: FakeLLM(),
    )
    monkeypatch.setattr(missions_module.run_mission_task, "delay", lambda mission_id: mission_id)

    first = await authed_client.post("/api/missions", json={"goal": "Retry Acme research"})
    assert first.status_code == 201
    first_payload = first.json()

    retry = await authed_client.post(f"/api/missions/{first_payload['id']}/retry")
    assert retry.status_code == 201
    retry_payload = retry.json()

    assert retry_payload["id"] != first_payload["id"]
    assert retry_payload["goal"] == first_payload["goal"]
    assert retry_payload["client_id"] == first_payload["client_id"]
    assert retry_payload["tasks"][0]["agent_id"] == test_agent.id

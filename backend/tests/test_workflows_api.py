import pytest
from sqlalchemy import select

from database.models import Workflow
from tests.factories import WorkflowFactory


@pytest.mark.asyncio
async def test_create_workflow_with_valid_nodes(authed_client, test_agent):
    payload = WorkflowFactory.build(
        nodes=[
            {
                "id": "node-1",
                "type": "agentNode",
                "data": {"agent_id": test_agent.id, "label": "Worker"},
            }
        ],
        edges=[],
    )

    response = await authed_client.post("/api/workflows", json=payload)

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == payload["name"]
    assert data["status"] == "draft"
    assert data["nodes"][0]["data"]["agent_id"] == test_agent.id


@pytest.mark.asyncio
async def test_workflow_schedule_validates_cron_expression(authed_client, test_workflow):
    response = await authed_client.put(
        f"/api/workflows/{test_workflow.id}/schedule",
        json={"cron_expression": "invalid cron"},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_workflow_schedule_returns_next_runs(authed_client, test_workflow):
    response = await authed_client.put(
        f"/api/workflows/{test_workflow.id}/schedule",
        json={"cron_expression": "0 9 * * 1-5"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["cron_expression"] == "0 9 * * 1-5"
    assert len(data["next_runs"]) == 5


@pytest.mark.asyncio
async def test_workflow_version_created_on_update(authed_client, test_workflow):
    update_response = await authed_client.put(
        f"/api/workflows/{test_workflow.id}",
        json={"name": "Updated Workflow Name", "changelog": "Rename workflow"},
    )
    versions_response = await authed_client.get(f"/api/workflows/{test_workflow.id}/versions")

    assert update_response.status_code == 200
    assert versions_response.status_code == 200
    versions = versions_response.json()
    assert len(versions) == 1
    assert versions[0]["version_number"] == 1


@pytest.mark.asyncio
async def test_workflow_rollback_restores_previous_state(authed_client, test_workflow):
    create_response = await authed_client.post(
        "/api/workflows",
        json={
            "name": "Version 1",
            "description": "Rollback candidate",
            "nodes": test_workflow.nodes,
            "edges": test_workflow.edges,
        },
    )
    workflow_id = create_response.json()["id"]
    update_response = await authed_client.put(
        f"/api/workflows/{workflow_id}",
        json={"name": "Version 2", "changelog": "Rename to v2"},
    )
    rollback_response = await authed_client.post(
        f"/api/workflows/{workflow_id}/rollback",
        json={"target_version": 1, "confirm": True},
    )
    get_response = await authed_client.get(f"/api/workflows/{workflow_id}")

    assert create_response.status_code == 201
    assert update_response.status_code == 200
    assert rollback_response.status_code == 200
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "Version 1"


@pytest.mark.asyncio
async def test_list_scheduled_workflows_returns_schedule_metadata(authed_client, db, test_org):
    scheduled = Workflow(
        org_id=test_org.id,
        name="Daily Research",
        description="",
        nodes=[],
        edges=[],
        trigger="schedule",
        schedule="0 8 * * 1-5",
        schedule_enabled=True,
        schedule_timezone="America/New_York",
    )
    db.add(scheduled)
    await db.commit()

    response = await authed_client.get("/api/workflows/scheduled")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["workflow_id"] == scheduled.id
    assert payload[0]["schedule"] == "0 8 * * 1-5"
    assert payload[0]["schedule_enabled"] is True
    assert payload[0]["schedule_timezone"] == "America/New_York"
    assert payload[0]["next_run_at"]


@pytest.mark.asyncio
async def test_patch_workflow_schedule_validates_and_updates_scheduler(authed_client, client, db, test_workflow, test_org):
    invalid = await authed_client.patch(
        f"/api/workflows/{test_workflow.id}/schedule",
        json={
            "schedule": "not a cron",
            "schedule_enabled": True,
            "schedule_timezone": "UTC",
        },
    )
    assert invalid.status_code == 422
    assert "cron" in invalid.json()["detail"].lower()

    response = await authed_client.patch(
        f"/api/workflows/{test_workflow.id}/schedule",
        json={
            "schedule": "*/5 * * * *",
            "schedule_enabled": True,
            "schedule_timezone": "America/New_York",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["schedule"] == "*/5 * * * *"
    assert payload["schedule_enabled"] is True
    assert payload["schedule_timezone"] == "America/New_York"
    assert payload["next_run_at"]

    refreshed = await db.scalar(select(Workflow).where(Workflow.id == test_workflow.id))
    assert refreshed is not None
    assert refreshed.schedule == "*/5 * * * *"
    assert refreshed.schedule_enabled is True
    assert refreshed.schedule_timezone == "America/New_York"
    assert client._transport.app.state.scheduler.scheduled[test_workflow.id]["cron_expression"] == "*/5 * * * *"


@pytest.mark.asyncio
async def test_automation_template_enable_creates_scheduled_workflow(authed_client, db, test_org, test_agent):
    test_agent.role_slug = "research-analyst"
    await db.commit()

    response = await authed_client.post("/api/workflows/automation-templates/daily_research/enable")

    assert response.status_code == 200
    payload = response.json()
    assert payload["template_id"] == "daily_research"
    assert payload["enabled"] is True
    assert payload["workflow"]["schedule_enabled"] is True
    assert payload["workflow"]["template_id"] == "automation:daily_research"


@pytest.mark.asyncio
async def test_workflow_webhook_url_and_public_trigger(monkeypatch, authed_client, client, db, test_workflow):
    import api.workflows as workflows_module

    captured = {}

    async def fake_run_workflow_background(execution_id, workflow_id, input_message, user_id=None, org_id=None, memory_service=None, hitl_service=None):
        captured["execution_id"] = execution_id
        captured["workflow_id"] = workflow_id
        captured["input_message"] = input_message
        captured["user_id"] = user_id
        captured["org_id"] = org_id

    monkeypatch.setattr(workflows_module, "run_workflow_background", fake_run_workflow_background)

    webhook_response = await authed_client.get(f"/api/workflows/{test_workflow.id}/webhook-url")
    assert webhook_response.status_code == 200
    signed_url = webhook_response.json()["webhook_url"]
    token = signed_url.rsplit("/", 1)[-1]

    public_response = await client.post(
        f"/api/webhooks/trigger/{token}",
        json={"topic": "hello"},
    )

    assert public_response.status_code == 200
    payload = public_response.json()
    assert payload["triggered"] is True
    assert payload["execution_id"]
    assert captured["workflow_id"] == test_workflow.id
    assert "hello" in captured["input_message"]

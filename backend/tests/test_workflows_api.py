import pytest

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

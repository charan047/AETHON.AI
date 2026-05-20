import pytest


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_create_agent(authed_client):
    payload = {
        "name": "Test Agent",
        "role": "tester",
        "description": "A test agent",
        "system_prompt": "You are a test agent.",
        "model": "llama-3.3-70b-versatile",
        "tools": [],
    }
    resp = await authed_client.post("/api/agents", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Agent"
    assert data["role"] == "tester"
    assert data["tools"] == []
    assert "id" in data


@pytest.mark.asyncio
async def test_list_agents(authed_client, test_agent):
    resp = await authed_client.get("/api/agents")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(agent["id"] == test_agent.id for agent in data)


@pytest.mark.asyncio
async def test_create_workflow(authed_client, test_agent):
    payload = {
        "name": "Test Workflow",
        "description": "A test workflow",
        "nodes": [
            {
                "id": "node-1",
                "type": "agentNode",
                "data": {"agent_id": test_agent.id},
            }
        ],
        "edges": [],
    }
    resp = await authed_client.post("/api/workflows", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Workflow"
    assert data["status"] == "draft"


@pytest.mark.asyncio
async def test_list_workflows(authed_client, test_workflow):
    resp = await authed_client.get("/api/workflows")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(workflow["id"] == test_workflow.id for workflow in data)


@pytest.mark.asyncio
async def test_get_templates(authed_client):
    resp = await authed_client.get("/api/workflows/templates")
    assert resp.status_code == 200
    templates = resp.json()
    assert len(templates) >= 2


@pytest.mark.asyncio
async def test_monitoring_stats(authed_client):
    resp = await authed_client.get("/api/monitoring/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert "workflows" in data
    assert "executions" in data

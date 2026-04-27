import pytest
import asyncio
from httpx import AsyncClient, ASGITransport
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("GOOGLE_API_KEY", "test-key")

from main import app
from database import init_db


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def setup_db():
    await init_db()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_create_agent(client):
    payload = {
        "name": "Test Agent",
        "role": "tester",
        "system_prompt": "You are a test agent.",
        "model": "gemini-2.5-flash",
        "tools": [],
    }
    resp = await client.post("/api/agents", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Agent"
    assert data["role"] == "tester"
    assert "id" in data
    return data["id"]


@pytest.mark.asyncio
async def test_list_agents(client):
    resp = await client.get("/api/agents")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_create_workflow(client):
    payload = {
        "name": "Test Workflow",
        "description": "A test workflow",
        "nodes": [],
        "edges": [],
    }
    resp = await client.post("/api/workflows", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Workflow"
    assert data["status"] == "draft"


@pytest.mark.asyncio
async def test_list_workflows(client):
    resp = await client.get("/api/workflows")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_templates(client):
    resp = await client.get("/api/workflows/templates")
    assert resp.status_code == 200
    templates = resp.json()
    assert len(templates) >= 2


@pytest.mark.asyncio
async def test_monitoring_stats(client):
    resp = await client.get("/api/monitoring/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert "workflows" in data
    assert "executions" in data

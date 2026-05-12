import asyncio
import base64
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from jose import jwt
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter

import api.executions as executions_api
import limits.storage.memory as limits_memory
import runtime.tools as runtime_tools
from api.monitoring import websocket_endpoint
from auth.security import create_access_token, hash_password
from config import settings
from database.models import (
    Agent,
    CustomTool,
    EvalCase,
    EvalSuite,
    ListingStatus,
    ListingType,
    MarketplaceCategory,
    MarketplaceListing,
    OrgMember,
    OrgMemberRole,
    Organization,
    User,
    UserRole,
)
from middleware.rate_limit import limiter
from tests.factories import AgentFactory
from tools.implementations.code_executor import CodeExecutorTool


def b64url(data: dict) -> str:
    raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def auth_headers_for(user: User, org: Organization) -> dict[str, str]:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "Authorization": f"Bearer {create_access_token(user.id, role)}",
        "X-Org-Id": org.id,
    }


async def create_user_with_org(
    db,
    *,
    email: str,
    role: UserRole,
    org_name: str,
    org_slug: str,
    plan: str = "open_source",
):
    user = User(
        email=email,
        hashed_password=hash_password("SecurePass123!"),
        full_name=org_name,
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    org = Organization(
        name=org_name,
        slug=org_slug,
        plan=plan,
        owner_user_id=user.id,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)

    db.add(OrgMember(org_id=org.id, user_id=user.id, role=OrgMemberRole.owner))
    await db.commit()
    return user, org


def enable_test_rate_limiter(monkeypatch):
    storage = MemoryStorage()
    previous = {
        "enabled": limiter.enabled,
        "storage": limiter._storage,
        "limiter": limiter._limiter,
        "headers_enabled": limiter._headers_enabled,
        "storage_dead": limiter._storage_dead,
    }
    current_time = {"value": 1_700_000_000.0}

    limiter.enabled = True
    limiter._storage = storage
    limiter._limiter = FixedWindowRateLimiter(storage)
    limiter._headers_enabled = True
    limiter._storage_dead = False
    monkeypatch.setattr(limits_memory.time, "time", lambda: current_time["value"])

    def advance(seconds: float):
        current_time["value"] += seconds

    def restore():
        limiter.enabled = previous["enabled"]
        limiter._storage = previous["storage"]
        limiter._limiter = previous["limiter"]
        limiter._headers_enabled = previous["headers_enabled"]
        limiter._storage_dead = previous["storage_dead"]

    return advance, restore


class FakeWebSocket:
    def __init__(self):
        self.closed = False
        self.close_code = None
        self.accepted = False

    async def close(self, code: int):
        self.closed = True
        self.close_code = code

    async def accept(self):
        self.accepted = True

    async def receive_text(self):
        raise RuntimeError("receive_text should not be reached in invalid token tests")


class FakeContainer:
    def __init__(self, status_code: int, output: str):
        self.status_code = status_code
        self.output = output
        self.removed = False

    def wait(self, timeout=None):
        return {"StatusCode": self.status_code}

    def logs(self, stdout=True, stderr=True):
        return self.output.encode("utf-8")

    def remove(self, force=True):
        self.removed = True


class FakeImageStore:
    def get(self, image):
        return image


class FakeContainers:
    def __init__(self, output: str, status_code: int = 1):
        self.output = output
        self.status_code = status_code
        self.last_kwargs = None

    def run(self, **kwargs):
        self.last_kwargs = kwargs
        return FakeContainer(self.status_code, self.output)


class FakeDockerClient:
    def __init__(self, output: str, status_code: int = 1):
        self.images = FakeImageStore()
        self.containers = FakeContainers(output=output, status_code=status_code)


async def noop_ensure_image(client):
    return None


@pytest.mark.asyncio
async def test_sql_injection_in_agent_name(authed_client):
    injection_name = "'; DROP TABLE agents; --"
    payload = AgentFactory.build(name=injection_name)

    create_response = await authed_client.post("/api/agents", json=payload)
    list_response = await authed_client.get("/api/agents")

    assert create_response.status_code == 201
    assert list_response.status_code == 200
    agents = list_response.json()
    assert len(agents) == 1
    assert agents[0]["name"] == injection_name


@pytest.mark.asyncio
async def test_sql_injection_in_search_query(client, db, test_user, test_org):
    listings = [
        MarketplaceListing(
            id=str(uuid4()),
            publisher_user_id=test_user.id,
            publisher_org_id=test_org.id,
            listing_type=ListingType.agent,
            category=MarketplaceCategory.development,
            status=ListingStatus.published,
            name=f"Safe Listing {index}",
            slug=f"safe-listing-{index}-{uuid4().hex[:6]}",
            tagline="Safe tagline",
            description="Safe description",
            template_data=json.dumps({"name": f"Template {index}"}),
        )
        for index in range(2)
    ]
    db.add_all(listings)
    await db.commit()

    response = await client.get("/api/marketplace?query=' OR '1'='1")

    assert response.status_code == 200
    assert response.json()["total"] < 2


@pytest.mark.asyncio
async def test_xss_in_agent_system_prompt(authed_client):
    xss_prompt = "<script>alert('xss')</script>"
    payload = AgentFactory.build(system_prompt=xss_prompt)

    create_response = await authed_client.post("/api/agents", json=payload)
    get_response = await authed_client.get(f"/api/agents/{create_response.json()['id']}")

    assert create_response.status_code == 201
    assert get_response.status_code == 200
    assert get_response.json()["system_prompt"] == xss_prompt


@pytest.mark.asyncio
async def test_path_traversal_in_tool_code(authed_client):
    payload = {
        "name": "sandbox_path_test",
        "description": "Attempts file exfiltration",
        "code": "def run():\n    import os\n    os.system('cat /etc/passwd')\n    return 'done'\n",
    }
    create_response = await authed_client.post("/api/tools", json=payload)
    test_response = await authed_client.post(f"/api/tools/{create_response.json()['id']}/test", json={"params": {}})

    assert create_response.status_code == 201
    assert test_response.status_code == 200
    assert test_response.json()["output"] == ""
    assert "not allowed" in test_response.json()["error"].lower()
    assert "/etc/passwd" not in (test_response.json()["output"] or "")


@pytest.mark.asyncio
async def test_command_injection_via_tool_code(authed_client):
    payload = {
        "name": "sandbox_command_test",
        "description": "Attempts shell execution",
        "code": "def run():\n    return __import__('os').system('whoami')\n",
    }
    create_response = await authed_client.post("/api/tools", json=payload)
    test_response = await authed_client.post(f"/api/tools/{create_response.json()['id']}/test", json={"params": {}})

    assert create_response.status_code == 201
    assert test_response.status_code == 200
    assert test_response.json()["output"] == ""
    assert "dangerous" in test_response.json()["error"].lower()


@pytest.mark.asyncio
async def test_brute_force_login_is_rate_limited(client, monkeypatch):
    await client.post(
        "/api/auth/register",
        json={"email": "bruteforce@example.com", "password": "SecurePass123!", "full_name": "Brute Force"},
    )
    advance, restore = enable_test_rate_limiter(monkeypatch)
    try:
        responses = []
        for _ in range(6):
            responses.append(
                await client.post(
                    "/api/auth/login",
                    json={"email": "bruteforce@example.com", "password": "wrong-password"},
                )
            )
        assert responses[-1].status_code == 429
        assert int(responses[0].headers["X-RateLimit-Remaining"]) > int(responses[4].headers["X-RateLimit-Remaining"])
    finally:
        restore()


@pytest.mark.asyncio
async def test_jwt_algorithm_confusion(client, test_org):
    header = {"alg": "none", "typ": "JWT"}
    payload = {"sub": "admin_user_id", "role": "admin", "type": "access"}
    token = f"{b64url(header)}.{b64url(payload)}."

    response = await client.get("/api/agents", headers={"Authorization": f"Bearer {token}", "X-Org-Id": test_org.id})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_jwt_secret_exhaustion(client, test_user, test_org):
    common_secrets = ["secret", "password", "123456", "jwt_secret", "your-secret"]
    for secret in common_secrets:
        forged = jwt.encode(
            {
                "sub": test_user.id,
                "role": "admin",
                "type": "access",
                "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
            },
            secret,
            algorithm="HS256",
        )
        response = await client.get(
            "/api/agents",
            headers={"Authorization": f"Bearer {forged}", "X-Org-Id": test_org.id},
        )
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_horizontal_privilege_escalation(client, db):
    user_a, org_a = await create_user_with_org(
        db,
        email=f"orga-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Org A",
        org_slug=f"org-a-{uuid4().hex[:8]}",
    )
    user_b, org_b = await create_user_with_org(
        db,
        email=f"orgb-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Org B",
        org_slug=f"org-b-{uuid4().hex[:8]}",
    )
    agent = Agent(
        name="Private Agent",
        role="assistant",
        description="Private",
        system_prompt="Org A only",
        model="llama-3.3-70b-versatile",
        org_id=org_a.id,
        tools=[],
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    headers_b = auth_headers_for(user_b, org_b)
    get_response = await client.get(f"/api/agents/{agent.id}", headers=headers_b)
    put_response = await client.put(f"/api/agents/{agent.id}", headers=headers_b, json={"name": "Hacked"})
    delete_response = await client.delete(f"/api/agents/{agent.id}", headers=headers_b)

    assert get_response.status_code == 404
    assert put_response.status_code == 404
    assert delete_response.status_code == 404


@pytest.mark.asyncio
async def test_vertical_privilege_escalation(client, db):
    viewer, viewer_org = await create_user_with_org(
        db,
        email=f"viewer-{uuid4().hex[:8]}@example.com",
        role=UserRole.viewer,
        org_name="Viewer Org",
        org_slug=f"viewer-org-{uuid4().hex[:8]}",
    )
    viewer_headers = auth_headers_for(viewer, viewer_org)

    agent = Agent(
        name="Protected Agent",
        role="assistant",
        description="protected",
        system_prompt="viewer cannot change this",
        model="llama-3.3-70b-versatile",
        org_id=viewer_org.id,
        tools=[],
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    suite = EvalSuite(
        id=str(uuid4()),
        org_id=viewer_org.id,
        user_id=viewer.id,
        agent_id=agent.id,
        name="Protected Eval Suite",
        description="viewer should not run this",
        pass_threshold=0.8,
    )
    db.add(suite)
    await db.commit()
    db.add(
        EvalCase(
            id=str(uuid4()),
            suite_id=suite.id,
            name="Case 1",
            input="hello",
            expected_output="hello",
        )
    )
    await db.commit()

    create_response = await client.post("/api/agents", headers=viewer_headers, json=AgentFactory.build(name="Blocked Agent"))
    delete_response = await client.delete(f"/api/agents/{agent.id}", headers=viewer_headers)
    run_eval_response = await client.post(
        f"/api/evals/suites/{suite.id}/run",
        headers=viewer_headers,
        json={"triggered_by": "manual"},
    )

    assert create_response.status_code == 403
    assert delete_response.status_code == 403
    assert run_eval_response.status_code == 403


@pytest.mark.asyncio
async def test_org_header_spoofing(client, db):
    user_a, org_a = await create_user_with_org(
        db,
        email=f"usera-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Org A",
        org_slug=f"org-a-{uuid4().hex[:8]}",
    )
    _, org_b = await create_user_with_org(
        db,
        email=f"userb-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Org B",
        org_slug=f"org-b-{uuid4().hex[:8]}",
    )
    spoofed_headers = {
        "Authorization": auth_headers_for(user_a, org_a)["Authorization"],
        "X-Org-Id": org_b.id,
    }

    response = await client.get("/api/agents", headers=spoofed_headers)

    assert response.status_code == 403
    assert "organization" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_workflow_execution_rate_limit(authed_client, test_workflow, monkeypatch):
    advance, restore = enable_test_rate_limiter(monkeypatch)
    async def fake_background(*args, **kwargs):
        return None

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)
    try:
        responses = []
        for _ in range(11):
            responses.append(
                await authed_client.post(
                    f"/api/executions/workflows/{test_workflow.id}/run",
                    json={"input_message": "run", "trigger": "manual"},
                )
            )
        assert responses[-1].status_code == 429
        advance(61)
        reset_response = await authed_client.post(
            f"/api/executions/workflows/{test_workflow.id}/run",
            json={"input_message": "run again", "trigger": "manual"},
        )
        assert reset_response.status_code == 202
    finally:
        restore()


@pytest.mark.asyncio
async def test_auth_endpoint_rate_limit(client, monkeypatch):
    await client.post(
        "/api/auth/register",
        json={"email": "ratelimit@example.com", "password": "SecurePass123!", "full_name": "Rate Limit"},
    )
    advance, restore = enable_test_rate_limiter(monkeypatch)
    try:
        for _ in range(5):
            await client.post("/api/auth/login", json={"email": "ratelimit@example.com", "password": "wrong"})
        response = await client.post("/api/auth/login", json={"email": "ratelimit@example.com", "password": "wrong"})
        assert response.status_code == 429
    finally:
        restore()


@pytest.mark.asyncio
async def test_rate_limit_per_user_not_global(client, db, monkeypatch):
    advance, restore = enable_test_rate_limiter(monkeypatch)
    async def fake_background(*args, **kwargs):
        return None

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)
    user_a, org_a = await create_user_with_org(
        db,
        email=f"rate-a-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Rate Org A",
        org_slug=f"rate-org-a-{uuid4().hex[:8]}",
    )
    user_b, org_b = await create_user_with_org(
        db,
        email=f"rate-b-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Rate Org B",
        org_slug=f"rate-org-b-{uuid4().hex[:8]}",
    )
    agent_a = Agent(name="A", role="assistant", description="", system_prompt="a", model="llama-3.3-70b-versatile", org_id=org_a.id, tools=[])
    agent_b = Agent(name="B", role="assistant", description="", system_prompt="b", model="llama-3.3-70b-versatile", org_id=org_b.id, tools=[])
    db.add_all([agent_a, agent_b])
    await db.commit()
    await db.refresh(agent_a)
    await db.refresh(agent_b)
    from database.models import Workflow
    workflow_a = Workflow(name="WA", description="", nodes=[{"id": "n1", "type": "agentNode", "data": {"agent_id": agent_a.id}}], edges=[], execution_mode="sequential", org_id=org_a.id, trigger="manual", status="draft")
    workflow_b = Workflow(name="WB", description="", nodes=[{"id": "n1", "type": "agentNode", "data": {"agent_id": agent_b.id}}], edges=[], execution_mode="sequential", org_id=org_b.id, trigger="manual", status="draft")
    db.add_all([workflow_a, workflow_b])
    await db.commit()
    await db.refresh(workflow_a)
    await db.refresh(workflow_b)
    headers_a = auth_headers_for(user_a, org_a)
    headers_b = auth_headers_for(user_b, org_b)
    try:
        for _ in range(10):
            await client.post(f"/api/executions/workflows/{workflow_a.id}/run", headers=headers_a, json={"input_message": "run", "trigger": "manual"})
        blocked = await client.post(f"/api/executions/workflows/{workflow_a.id}/run", headers=headers_a, json={"input_message": "run", "trigger": "manual"})
        allowed = await client.post(f"/api/executions/workflows/{workflow_b.id}/run", headers=headers_b, json={"input_message": "run", "trigger": "manual"})
        assert blocked.status_code == 429
        assert allowed.status_code == 202
    finally:
        restore()


@pytest.mark.asyncio
async def test_extremely_long_agent_name_rejected(authed_client):
    payload = AgentFactory.build(name="A" * 10000)

    response = await authed_client.post("/api/agents", json=payload)

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_malformed_json_workflow_definition(authed_client):
    response = await authed_client.post(
        "/api/workflows",
        json={
            "name": "Bad Workflow",
            "description": "invalid nodes",
            "nodes": "not valid json",
            "edges": [],
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_negative_max_retries_rejected(authed_client):
    payload = AgentFactory.build(max_retries=-1)

    response = await authed_client.post("/api/agents", json=payload)

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_cron_injection_in_schedule(authed_client, test_workflow):
    response = await authed_client.put(
        f"/api/workflows/{test_workflow.id}/schedule",
        json={"cron_expression": "0 9 * * *; rm -rf /"},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_docker_network_is_disabled(monkeypatch):
    fake_client = FakeDockerClient(output="Code exited with status 1:\nTemporary failure in name resolution", status_code=1)
    tool = CodeExecutorTool(user_id="test-user")
    monkeypatch.setattr(tool, "_ensure_image", noop_ensure_image)
    monkeypatch.setattr(tool, "_get_docker_client", lambda: fake_client)

    with pytest.raises(RuntimeError) as exc:
        await tool._execute_code("import urllib.request; urllib.request.urlopen('http://google.com')", 30)

    assert "name resolution" in str(exc.value).lower()
    assert fake_client.containers.last_kwargs["network_disabled"] is True


@pytest.mark.asyncio
async def test_docker_memory_limit_enforced(monkeypatch):
    fake_client = FakeDockerClient(output="Code exited with status 137:\nKilled", status_code=137)
    tool = CodeExecutorTool(user_id="test-user")
    monkeypatch.setattr(tool, "_ensure_image", noop_ensure_image)
    monkeypatch.setattr(tool, "_get_docker_client", lambda: fake_client)

    with pytest.raises(RuntimeError) as exc:
        await tool._execute_code("x = 'A' * (200 * 1024 * 1024)", 30)

    assert "killed" in str(exc.value).lower()
    assert fake_client.containers.last_kwargs["mem_limit"] == "128m"


@pytest.mark.asyncio
async def test_docker_timeout_enforced(monkeypatch):
    tool = CodeExecutorTool(user_id="test-user")
    monkeypatch.setattr(tool, "_ensure_image", noop_ensure_image)
    monkeypatch.setattr(tool, "_get_docker_client", lambda: FakeDockerClient(output="", status_code=0))

    original_wait_for = asyncio.wait_for

    async def immediate_timeout(awaitable, timeout):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(asyncio, "wait_for", immediate_timeout)
    started = time.monotonic()
    try:
        with pytest.raises(RuntimeError) as exc:
            await tool._execute_code("import time; time.sleep(60)", 30)
    finally:
        monkeypatch.setattr(asyncio, "wait_for", original_wait_for)
    elapsed = time.monotonic() - started

    assert elapsed < 35
    assert "timed out after 30s" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_docker_file_system_isolation(monkeypatch):
    generic_passwd = "root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin"
    fake_client = FakeDockerClient(output=generic_passwd, status_code=0)
    tool = CodeExecutorTool(user_id="test-user")
    monkeypatch.setattr(tool, "_ensure_image", noop_ensure_image)
    monkeypatch.setattr(tool, "_get_docker_client", lambda: fake_client)

    result = await tool._execute_code("print(open('/etc/passwd').read())", 30)

    assert "root:x:0:0" in result
    assert "charan" not in result.lower()


@pytest.mark.asyncio
async def test_marketplace_template_data_sanitized(authed_client, db, test_org):
    agent = Agent(
        name="Secret Agent",
        role="assistant",
        description="contains secret",
        system_prompt="My API key is sk-1234567890abcdef",
        model="llama-3.3-70b-versatile",
        org_id=test_org.id,
        tools=[],
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    publish_response = await authed_client.post(
        f"/api/marketplace/publish/agent/{agent.id}",
        json={
            "name": "Secret Agent Listing",
            "tagline": "Safe listing",
            "description": "Safe description",
            "category": "development",
            "tags": "safe",
        },
    )
    assert publish_response.status_code == 400
    assert publish_response.json()["detail"] == "System prompt contains secrets"


@pytest.mark.asyncio
async def test_marketplace_xss_in_listing_description(authed_client, test_agent):
    publish_response = await authed_client.post(
        f"/api/marketplace/publish/agent/{test_agent.id}",
        json={
            "name": "XSS Listing",
            "tagline": "Literal script storage",
            "description": "<script>alert(1)</script>",
            "category": "development",
            "tags": "xss",
        },
    )
    listing_id = publish_response.json()["id"]
    slug = publish_response.json()["slug"]
    await authed_client.post(f"/api/marketplace/admin/listings/{listing_id}/approve")

    detail_response = await authed_client.get(f"/api/marketplace/{slug}")

    assert detail_response.status_code == 200
    assert "<script>" not in detail_response.json()["description"]
    assert detail_response.json()["description"] == "alert(1)"


@pytest.mark.asyncio
async def test_websocket_requires_valid_token():
    websocket = FakeWebSocket()

    await websocket_endpoint(websocket, token="invalid")

    assert websocket.closed is True
    assert websocket.close_code == 4001


@pytest.mark.asyncio
async def test_websocket_expired_token_rejected(test_user):
    expired_token = jwt.encode(
        {
            "sub": test_user.id,
            "role": "admin",
            "type": "access",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    websocket = FakeWebSocket()

    await websocket_endpoint(websocket, token=expired_token)

    assert websocket.closed is True
    assert websocket.close_code == 4001

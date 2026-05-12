from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from jose import jwt

from auth.security import create_access_token, hash_password
from config import settings
from database.models import Agent, OrgMember, OrgMemberRole, Organization, User, UserRole, Workflow


async def register_user(
    client,
    email: str,
    password: str = "SecurePass123!",
    full_name: str = "Test User",
):
    return await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "full_name": full_name,
        },
    )


async def login_user(client, email: str, password: str):
    return await client.post(
        "/api/auth/login",
        json={
            "email": email,
            "password": password,
        },
    )


async def create_user_with_org(
    db,
    *,
    email: str,
    role: UserRole,
    org_name: str,
    org_slug: str,
    is_active: bool = True,
):
    user = User(
        email=email,
        hashed_password=hash_password("SecurePass123!"),
        full_name=org_name,
        role=role,
        is_active=is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    org = Organization(
        name=org_name,
        slug=org_slug,
        plan="open_source",
        owner_user_id=user.id,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)

    member = OrgMember(
        org_id=org.id,
        user_id=user.id,
        role=OrgMemberRole.owner,
    )
    db.add(member)
    await db.commit()

    return user, org


def auth_headers_for(user: User, org: Organization) -> dict[str, str]:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "Authorization": f"Bearer {create_access_token(user.id, role)}",
        "X-Org-Id": org.id,
    }


def agent_payload(name: str = "Secure Agent") -> dict:
    return {
        "name": name,
        "role": "assistant",
        "description": "Security test agent",
        "system_prompt": "You are a secure test agent.",
        "model": "llama-3.3-70b-versatile",
        "tools": [],
    }


@pytest.mark.asyncio
async def test_register_first_user_gets_admin_role(client):
    response = await register_user(client, "founder@example.com")

    assert response.status_code == 201
    data = response.json()
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["role"] == "admin"


@pytest.mark.asyncio
async def test_register_second_user_gets_editor_role(client):
    first_response = await register_user(client, "founder@example.com")
    second_response = await register_user(client, "operator@example.com")

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    assert second_response.json()["role"] == "editor"


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_409(client):
    first_response = await register_user(client, "duplicate@example.com")
    second_response = await register_user(client, "duplicate@example.com")

    assert first_response.status_code == 201
    assert second_response.status_code == 409


@pytest.mark.asyncio
async def test_register_short_password_returns_400(client):
    response = await register_user(client, "shortpass@example.com", password="abc")

    assert response.status_code == 400
    assert "8 characters" in response.json()["detail"]


@pytest.mark.asyncio
async def test_register_invalid_email_returns_422(client):
    response = await client.post(
        "/api/auth/register",
        json={
            "email": "notanemail",
            "password": "SecurePass123!",
            "full_name": "Bad Email",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_valid_credentials_returns_tokens(client):
    await register_user(client, "login@example.com")

    response = await login_user(client, "login@example.com", "SecurePass123!")

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password_returns_401(client):
    await register_user(client, "wrongpass@example.com")

    response = await login_user(client, "wrongpass@example.com", "wrong-password")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_login_wrong_email_returns_same_error(client):
    response = await login_user(client, "missing@example.com", "SecurePass123!")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_login_inactive_user_returns_403(client, db):
    user = User(
        email="inactive@example.com",
        hashed_password=hash_password("SecurePass123!"),
        full_name="Inactive User",
        role=UserRole.editor,
        is_active=False,
    )
    db.add(user)
    await db.commit()

    response = await login_user(client, "inactive@example.com", "SecurePass123!")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_expired_token_returns_401(client, test_user, test_org):
    expired_token = jwt.encode(
        {
            "sub": test_user.id,
            "role": test_user.role.value,
            "type": "access",
            "iat": datetime.now(timezone.utc) - timedelta(hours=2),
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
            "jti": str(uuid4()),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    response = await client.get(
        "/api/agents",
        headers={
            "Authorization": f"Bearer {expired_token}",
            "X-Org-Id": test_org.id,
        },
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_tampered_token_returns_401(client, test_user, test_org):
    valid_token = create_access_token(test_user.id, test_user.role.value)
    parts = valid_token.split(".")
    tampered_payload = parts[1][:-1] + ("A" if parts[1][-1] != "A" else "B")
    tampered_token = ".".join([parts[0], tampered_payload, parts[2]])

    response = await client.get(
        "/api/agents",
        headers={
            "Authorization": f"Bearer {tampered_token}",
            "X-Org-Id": test_org.id,
        },
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_as_access_returns_401(client, test_org):
    register_response = await register_user(client, "refresh-as-access@example.com")
    refresh_token = register_response.json()["refresh_token"]

    response = await client.get(
        "/api/agents",
        headers={
            "Authorization": f"Bearer {refresh_token}",
            "X-Org-Id": test_org.id,
        },
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_access_token_as_refresh_returns_401(client):
    register_response = await register_user(client, "access-as-refresh@example.com")
    access_token = register_response.json()["access_token"]

    response = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": access_token},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_token_refresh_returns_new_tokens(client):
    register_response = await register_user(client, "rotation@example.com")
    original_access_token = register_response.json()["access_token"]
    original_refresh_token = register_response.json()["refresh_token"]

    response = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": original_refresh_token},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"] != original_access_token
    assert data["refresh_token"] != original_refresh_token


@pytest.mark.asyncio
async def test_viewer_cannot_create_agent(client, db):
    viewer, viewer_org = await create_user_with_org(
        db,
        email="viewer@example.com",
        role=UserRole.viewer,
        org_name="Viewer Org",
        org_slug="viewer-org",
    )

    response = await client.post(
        "/api/agents",
        json=agent_payload(),
        headers=auth_headers_for(viewer, viewer_org),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_editor_can_create_agent(client, db):
    editor, editor_org = await create_user_with_org(
        db,
        email="editor@example.com",
        role=UserRole.editor,
        org_name="Editor Org",
        org_slug="editor-org",
    )

    response = await client.post(
        "/api/agents",
        json=agent_payload(name="Editor Agent"),
        headers=auth_headers_for(editor, editor_org),
    )

    assert response.status_code == 201


@pytest.mark.asyncio
async def test_unauthenticated_request_returns_401(client):
    agents_response = await client.get("/api/agents")
    workflows_response = await client.get("/api/workflows")
    executions_response = await client.get("/api/executions")

    assert agents_response.status_code == 401
    assert workflows_response.status_code == 401
    assert executions_response.status_code == 401


@pytest.mark.asyncio
async def test_api_key_authentication_works(authed_client, client, test_org):
    create_key_response = await authed_client.post("/api/auth/api-keys?name=CI%20Key")
    api_key = create_key_response.json()["api_key"]

    response = await client.get(
        "/api/agents",
        headers={
            "X-Api-Key": api_key,
            "X-Org-Id": test_org.id,
        },
    )

    assert create_key_response.status_code == 200
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_revoked_api_key_returns_401(authed_client, client, test_org):
    create_key_response = await authed_client.post("/api/auth/api-keys?name=Revocable%20Key")
    payload = create_key_response.json()

    revoke_response = await authed_client.delete(f"/api/auth/api-keys/{payload['id']}")
    response = await client.get(
        "/api/agents",
        headers={
            "X-Api-Key": payload["api_key"],
            "X-Org-Id": test_org.id,
        },
    )

    assert revoke_response.status_code == 204
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_user_cannot_see_other_orgs_agents(client, db):
    user_a, org_a = await create_user_with_org(
        db,
        email="orga@example.com",
        role=UserRole.editor,
        org_name="Org A",
        org_slug=f"org-a-{uuid4().hex[:8]}",
    )
    user_b, org_b = await create_user_with_org(
        db,
        email="orgb@example.com",
        role=UserRole.editor,
        org_name="Org B",
        org_slug=f"org-b-{uuid4().hex[:8]}",
    )

    agent = Agent(
        name="Org A Agent",
        role="researcher",
        description="Hidden from Org B",
        system_prompt="Only Org A should see this.",
        model="llama-3.3-70b-versatile",
        org_id=org_a.id,
        tools=[],
    )
    db.add(agent)
    await db.commit()

    response = await client.get("/api/agents", headers=auth_headers_for(user_b, org_b))

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_user_cannot_access_other_orgs_agent_by_id(client, db):
    user_a, org_a = await create_user_with_org(
        db,
        email="orga2@example.com",
        role=UserRole.editor,
        org_name="Org A2",
        org_slug=f"org-a2-{uuid4().hex[:8]}",
    )
    user_b, org_b = await create_user_with_org(
        db,
        email="orgb2@example.com",
        role=UserRole.editor,
        org_name="Org B2",
        org_slug=f"org-b2-{uuid4().hex[:8]}",
    )

    agent = Agent(
        name="Private Agent",
        role="ops",
        description="Hidden agent",
        system_prompt="You are private.",
        model="llama-3.3-70b-versatile",
        org_id=org_a.id,
        tools=[],
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    response = await client.get(
        f"/api/agents/{agent.id}",
        headers=auth_headers_for(user_b, org_b),
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_user_cannot_run_other_orgs_workflow(client, db):
    user_a, org_a = await create_user_with_org(
        db,
        email="orga3@example.com",
        role=UserRole.editor,
        org_name="Org A3",
        org_slug=f"org-a3-{uuid4().hex[:8]}",
    )
    user_b, org_b = await create_user_with_org(
        db,
        email="orgb3@example.com",
        role=UserRole.editor,
        org_name="Org B3",
        org_slug=f"org-b3-{uuid4().hex[:8]}",
    )

    agent = Agent(
        name="Workflow Agent",
        role="builder",
        description="Agent for workflow execution isolation test",
        system_prompt="You help with workflows.",
        model="llama-3.3-70b-versatile",
        org_id=org_a.id,
        tools=[],
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    workflow = Workflow(
        name="Org A Workflow",
        description="Should not be executable by Org B",
        nodes=[{"id": "node-1", "type": "agentNode", "data": {"agent_id": agent.id}}],
        edges=[],
        trigger="manual",
        status="draft",
        execution_mode="sequential",
        org_id=org_a.id,
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)

    response = await client.post(
        f"/api/executions/workflows/{workflow.id}/run",
        json={"input_message": "Run this", "trigger": "manual"},
        headers=auth_headers_for(user_b, org_b),
    )

    assert response.status_code == 404

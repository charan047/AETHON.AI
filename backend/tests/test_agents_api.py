from uuid import uuid4

import pytest

from auth.security import create_access_token, hash_password
from database.models import Agent, OrgMember, OrgMemberRole, Organization, User, UserRole
from tests.factories import AgentFactory


async def create_user_with_org(
    db,
    *,
    email: str,
    role: UserRole,
    org_name: str,
    org_slug: str,
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
        plan="open_source",
        owner_user_id=user.id,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)

    db.add(
        OrgMember(
            org_id=org.id,
            user_id=user.id,
            role=OrgMemberRole.owner,
        )
    )
    await db.commit()
    return user, org


def auth_headers_for(user, org):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "Authorization": f"Bearer {create_access_token(user.id, role)}",
        "X-Org-Id": org.id,
    }


@pytest.mark.asyncio
async def test_create_agent_returns_201(authed_client, test_org):
    payload = AgentFactory.build()

    response = await authed_client.post("/api/agents", json=payload)

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == payload["name"]
    assert data["description"] == payload["description"]
    assert data["system_prompt"] == payload["system_prompt"]
    assert data["model"] == payload["model"]
    assert data["max_retries"] == payload["max_retries"]
    assert data["org_id"] == test_org.id


@pytest.mark.asyncio
async def test_create_agent_has_no_plan_limits(authed_client):
    for index in range(4):
        payload = AgentFactory.build(name=f"Open Agent {index}", memory_enabled=True)
        response = await authed_client.post("/api/agents", json=payload)
        assert response.status_code == 201


@pytest.mark.asyncio
async def test_list_agents_only_shows_current_org(authed_client, db, test_org, test_user):
    db.add_all(
        [
            Agent(
                name="Org A Agent 1",
                role="assistant",
                description="Org A first",
                system_prompt="A",
                model="llama-3.3-70b-versatile",
                org_id=test_org.id,
                tools=[],
            ),
            Agent(
                name="Org A Agent 2",
                role="assistant",
                description="Org A second",
                system_prompt="B",
                model="llama-3.3-70b-versatile",
                org_id=test_org.id,
                tools=[],
            ),
        ]
    )
    await db.commit()

    other_user, other_org = await create_user_with_org(
        db,
        email=f"other-{uuid4().hex[:8]}@example.com",
        role=UserRole.editor,
        org_name="Other Org",
        org_slug=f"other-org-{uuid4().hex[:8]}",
    )
    db.add(
        Agent(
            name="Org B Agent",
            role="assistant",
            description="Org B only",
            system_prompt="C",
            model="llama-3.3-70b-versatile",
            org_id=other_org.id,
            tools=[],
        )
    )
    await db.commit()

    response_a = await authed_client.get("/api/agents")
    response_b = await authed_client.get(
        "/api/agents",
        headers=auth_headers_for(other_user, other_org),
    )

    assert response_a.status_code == 200
    assert response_b.status_code == 200
    assert len(response_a.json()) == 2
    assert len(response_b.json()) == 1


@pytest.mark.asyncio
async def test_update_agent_system_prompt(authed_client, test_agent):
    update_payload = {"system_prompt": "You are an updated secure agent."}

    update_response = await authed_client.put(f"/api/agents/{test_agent.id}", json=update_payload)
    get_response = await authed_client.get(f"/api/agents/{test_agent.id}")

    assert update_response.status_code == 200
    assert get_response.status_code == 200
    assert get_response.json()["system_prompt"] == update_payload["system_prompt"]


@pytest.mark.asyncio
async def test_delete_agent_removes_it(authed_client, test_agent):
    delete_response = await authed_client.delete(f"/api/agents/{test_agent.id}")
    get_response = await authed_client.get(f"/api/agents/{test_agent.id}")

    assert delete_response.status_code == 204
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_agent_memory_config_defaults(authed_client, test_agent):
    response = await authed_client.get(f"/api/agents/{test_agent.id}/memory-config")

    assert response.status_code == 200
    data = response.json()
    assert data["memory_enabled"] is True
    assert data["max_memories_per_query"] == 5

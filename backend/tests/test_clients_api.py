from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from auth.security import create_access_token, hash_password
from database.models import Agent, Client, Execution, ExecutionStatus, OrgMember, OrgMemberRole, Organization, User, UserRole, Workflow


async def _create_user_with_org(db, *, email: str, org_name: str, org_slug: str):
    user = User(
        email=email,
        hashed_password=hash_password("SecurePass123!"),
        full_name=org_name,
        role=UserRole.editor,
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

    db.add(OrgMember(org_id=org.id, user_id=user.id, role=OrgMemberRole.owner))
    await db.commit()
    return user, org


def _headers_for(user: User, org: Organization) -> dict[str, str]:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "Authorization": f"Bearer {create_access_token(user.id, role)}",
        "X-Org-Id": org.id,
    }


@pytest.mark.asyncio
async def test_create_client(authed_client):
    response = await authed_client.post(
        "/api/clients",
        json={"name": "Acme", "company_name": "Acme Corp", "service_type": "Research"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "Acme"
    assert payload["company_name"] == "Acme Corp"
    assert payload["status"] == "active"


@pytest.mark.asyncio
async def test_list_clients_returns_agent_count_and_activity(authed_client, db, test_org, test_workflow, test_agent):
    client = Client(org_id=test_org.id, name="Growth Client", service_type="Content")
    db.add(client)
    await db.commit()
    await db.refresh(client)

    test_agent.client_id = client.id
    test_workflow.nodes = [
        {
            "id": "node_1",
            "type": "agentNode",
            "data": {"agent_id": test_agent.id, "label": test_agent.name},
        }
    ]
    db.add(
        Execution(
            org_id=test_org.id,
            workflow_id=test_workflow.id,
            client_id=client.id,
            trigger="manual",
            status=ExecutionStatus.completed,
            input_message="Analyze campaign",
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
        )
    )
    await db.commit()

    response = await authed_client.get("/api/clients")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["clients"][0]["agent_count"] == 1
    assert payload["clients"][0]["execution_count_30d"] == 1
    assert payload["clients"][0]["last_activity"] is not None


@pytest.mark.asyncio
async def test_enable_portal_returns_url(authed_client):
    create_response = await authed_client.post("/api/clients", json={"name": "Portal Client"})
    client_id = create_response.json()["id"]

    response = await authed_client.post(f"/api/clients/{client_id}/portal/enable")

    assert response.status_code == 200
    payload = response.json()
    assert payload["portal_token"]
    assert payload["portal_url"].startswith("/portal/")


@pytest.mark.asyncio
async def test_assign_agent_to_invalid_or_other_org_client_returns_400(authed_client, db, test_agent):
    missing_response = await authed_client.post(
        f"/api/agents/{test_agent.id}/assign-client",
        json={"client_id": str(uuid4())},
    )
    assert missing_response.status_code == 400

    other_user, other_org = await _create_user_with_org(
        db,
        email=f"other-{uuid4().hex[:8]}@example.com",
        org_name="Other Org",
        org_slug=f"other-org-{uuid4().hex[:8]}",
    )
    other_client = Client(org_id=other_org.id, name="Other Client")
    db.add(other_client)
    await db.commit()
    await db.refresh(other_client)

    other_response = await authed_client.post(
        f"/api/agents/{test_agent.id}/assign-client",
        json={"client_id": other_client.id},
    )

    assert other_response.status_code == 400
    assert "Client not found in your agency." in other_response.json()["detail"]


@pytest.mark.asyncio
async def test_get_other_org_client_returns_404(client, db, test_org, test_user):
    other_user, other_org = await _create_user_with_org(
        db,
        email=f"cross-{uuid4().hex[:8]}@example.com",
        org_name="Cross Org",
        org_slug=f"cross-org-{uuid4().hex[:8]}",
    )
    other_client = Client(org_id=other_org.id, name="Hidden Client")
    db.add(other_client)
    await db.commit()
    await db.refresh(other_client)

    response = await client.get(
        f"/api/clients/{other_client.id}",
        headers=_headers_for(test_user, test_org),
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_client_unassigns_agents(authed_client, db, test_org, test_agent):
    client = Client(org_id=test_org.id, name="Wrap Up Client")
    db.add(client)
    await db.commit()
    await db.refresh(client)
    test_agent.client_id = client.id
    await db.commit()

    response = await authed_client.delete(f"/api/clients/{client.id}")

    assert response.status_code == 200
    refreshed_client = await db.scalar(select(Client).where(Client.id == client.id))
    refreshed_agent = await db.scalar(select(Agent).where(Agent.id == test_agent.id))
    assert refreshed_client is not None
    assert refreshed_client.status.value == "completed"
    assert refreshed_agent is not None
    assert refreshed_agent.client_id is None

from uuid import uuid4

import pytest

from auth.security import create_access_token
from database.models import OrgMember, OrgMemberRole, Organization


@pytest.mark.asyncio
async def test_create_tool_allows_same_name_in_different_orgs(client, db, test_user, test_org):
    role = test_user.role.value if hasattr(test_user.role, "value") else str(test_user.role)
    token = create_access_token(test_user.id, role)

    second_org = Organization(
        id=str(uuid4()),
        name="Second Company",
        slug="second-company",
        plan="open_source",
        owner_user_id=test_user.id,
    )
    db.add(second_org)
    await db.commit()
    db.add(OrgMember(org_id=second_org.id, user_id=test_user.id, role=OrgMemberRole.owner))
    await db.commit()

    payload = {
        "name": "client_summary_builder",
        "description": "Build a summary",
        "code": "def run() -> str:\n    return 'ok'\n",
    }

    first_response = await client.post(
        "/api/tools",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "X-Org-Id": test_org.id},
    )
    second_response = await client.post(
        "/api/tools",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "X-Org-Id": second_org.id},
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    assert first_response.json()["name"] == payload["name"]
    assert second_response.json()["name"] == payload["name"]


@pytest.mark.asyncio
async def test_create_tool_rejects_duplicate_name_in_same_org(authed_client):
    payload = {
        "name": "client_summary_builder",
        "description": "Build a summary",
        "code": "def run() -> str:\n    return 'ok'\n",
    }

    first_response = await authed_client.post("/api/tools", json=payload)
    second_response = await authed_client.post("/api/tools", json=payload)

    assert first_response.status_code == 201
    assert second_response.status_code == 400
    assert "already exists" in second_response.json()["detail"].lower()

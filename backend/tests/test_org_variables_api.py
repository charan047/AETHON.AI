from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from auth.security import create_access_token, hash_password
from database.models import OrgMember, OrgMemberRole, OrgVariable, Organization, User, UserRole


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
async def test_org_variables_crud_is_org_scoped(client, db):
    user_a, org_a = await _create_user_with_org(
        db,
        email=f"orga-{uuid4().hex[:8]}@example.com",
        org_name="Org A",
        org_slug=f"org-a-{uuid4().hex[:8]}",
    )
    user_b, org_b = await _create_user_with_org(
        db,
        email=f"orgb-{uuid4().hex[:8]}@example.com",
        org_name="Org B",
        org_slug=f"org-b-{uuid4().hex[:8]}",
    )

    create = await client.post(
        "/api/org/variables",
        headers=_headers_for(user_a, org_a),
        json={
            "key": "agency_name",
            "value": "Aethon Labs",
            "description": "Display name",
        },
    )
    assert create.status_code == 201
    variable_id = create.json()["id"]

    list_a = await client.get("/api/org/variables", headers=_headers_for(user_a, org_a))
    assert list_a.status_code == 200
    assert len(list_a.json()) == 1
    assert list_a.json()[0]["key"] == "agency_name"

    list_b = await client.get("/api/org/variables", headers=_headers_for(user_b, org_b))
    assert list_b.status_code == 200
    assert list_b.json() == []

    updated = await client.patch(
        f"/api/org/variables/{variable_id}",
        headers=_headers_for(user_a, org_a),
        json={"value": "Aethon Executive Labs"},
    )
    assert updated.status_code == 200
    assert updated.json()["value"] == "Aethon Executive Labs"

    deleted = await client.delete(
        f"/api/org/variables/{variable_id}",
        headers=_headers_for(user_a, org_a),
    )
    assert deleted.status_code == 204

    stored = await db.scalar(
        select(OrgVariable).where(
            OrgVariable.id == variable_id,
            OrgVariable.org_id == org_a.id,
        )
    )
    assert stored is None

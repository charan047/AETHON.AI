from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest

from auth.security import create_access_token, hash_password
from database.models import (
    Agent,
    Client,
    Execution,
    ExecutionStatus,
    FileStatus,
    FileType,
    Mission,
    MissionStatus,
    OrgFile,
    OrgMember,
    OrgMemberRole,
    Organization,
    User,
    UserRole,
    Workflow,
)


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
async def test_global_search_returns_typed_results_and_scopes_by_org(
    authed_client,
    db,
    test_org,
    test_user,
):
    client = Client(org_id=test_org.id, name="Acme", company_name="Acme Corp")
    workflow = Workflow(
        org_id=test_org.id,
        name="Acme Launch Workflow",
        description="Launch work for Acme",
        nodes=[],
        edges=[],
    )
    agent = Agent(
        org_id=test_org.id,
        name="Acme Researcher",
        persona_name="Acme Strategist",
        role="Research Lead",
        role_slug="acme_research",
        description="Researches Acme",
        system_prompt="You are helpful.",
        model="llama-3.1-8b-instant",
        tools=[],
    )
    db.add_all([client, workflow, agent])
    await db.commit()
    await db.refresh(client)
    await db.refresh(workflow)
    await db.refresh(agent)

    execution = Execution(
        org_id=test_org.id,
        workflow_id=workflow.id,
        client_id=client.id,
        status=ExecutionStatus.completed,
        input_message="Acme launch strategy review",
        started_at=datetime.utcnow(),
    )
    mission = Mission(
        org_id=test_org.id,
        client_id=client.id,
        title="Acme Growth Mission",
        goal="Prepare the Acme expansion plan",
        status=MissionStatus.completed,
        created_at=datetime.utcnow(),
    )
    file = OrgFile(
        org_id=test_org.id,
        client_id=client.id,
        name="Acme Research Brief.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/test/clients/acme/documents/brief.md",
        extracted_text="Acme positioning, market map, and launch research",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add_all([execution, mission, file])
    await db.commit()

    other_user, other_org = await _create_user_with_org(
        db,
        email=f"other-{uuid4().hex[:8]}@example.com",
        org_name="Other Org",
        org_slug=f"other-org-{uuid4().hex[:8]}",
    )
    db.add(
        Client(
            org_id=other_org.id,
            name="Acme Hidden",
            company_name="Acme Hidden Corp",
        )
    )
    await db.commit()
    del other_user

    response = await authed_client.get(
        "/api/search",
        params={"q": "Acme", "types": "agents,clients,files,executions,missions,workflows"},
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["query"] == "Acme"
    assert payload["total"] >= 5

    result_types = {item["type"] for item in payload["results"]}
    assert "agent" in result_types
    assert "client" in result_types
    assert "file" in result_types
    assert "execution" in result_types
    assert "mission" in result_types
    assert "workflow" in result_types

    titles = {item["title"] for item in payload["results"]}
    assert "Acme Hidden" not in titles


@pytest.mark.asyncio
async def test_global_search_finds_file_content_and_respects_type_filters(
    authed_client,
    db,
    test_org,
):
    file = OrgFile(
        org_id=test_org.id,
        name="Q2 Brief.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/test/shared/documents/q2-brief.md",
        extracted_text="Competitor analysis for Atlas and Acme with pricing notes",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(file)
    await db.commit()

    response = await authed_client.get("/api/search", params={"q": "competitor", "types": "files"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["results"][0]["type"] == "file"
    assert payload["results"][0]["id"] == file.id


@pytest.mark.asyncio
async def test_global_search_rejects_short_queries(authed_client):
    response = await authed_client.get("/api/search", params={"q": "a"})
    assert response.status_code == 422
    assert "at least 2 characters" in response.json()["detail"].lower()

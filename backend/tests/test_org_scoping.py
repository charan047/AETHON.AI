"""Tests that org-scoped endpoints never return data from other orgs."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.security import create_access_token, hash_password
from database.models import (
    Agent,
    Execution,
    ExecutionCostLog,
    ExecutionStatus,
    OrgMember,
    OrgMemberRole,
    Organization,
    User,
    UserRole,
    Workflow,
)


async def _create_org_bundle(db: AsyncSession, email_prefix: str) -> tuple[User, Organization, dict[str, str]]:
    user = User(
        email=f"{email_prefix}@example.com",
        hashed_password=hash_password("testpassword123"),
        full_name=f"{email_prefix.title()} User",
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    org = Organization(
        name=f"{email_prefix.title()} Org",
        slug=f"{email_prefix}-org-{uuid4().hex[:6]}",
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

    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    headers = {
        "Authorization": f"Bearer {create_access_token(user.id, role)}",
        "X-Org-Id": org.id,
    }
    return user, org, headers


@pytest_asyncio.fixture
async def org_pair(db: AsyncSession):
    org_a_user, org_a, org_a_headers = await _create_org_bundle(db, "orga")
    org_b_user, org_b, org_b_headers = await _create_org_bundle(db, "orgb")
    return {
        "org_a_user": org_a_user,
        "org_a": org_a,
        "org_a_headers": org_a_headers,
        "org_b_user": org_b_user,
        "org_b": org_b,
        "org_b_headers": org_b_headers,
    }


@pytest.mark.asyncio
async def test_agents_list_is_org_scoped(client, org_pair, db: AsyncSession):
    response = await client.post(
        "/api/agents",
        json={
            "name": "OrgB Agent",
            "role": "Researcher",
            "system_prompt": "You are a scoped test agent.",
        },
        headers=org_pair["org_b_headers"],
    )
    assert response.status_code == 201

    response = await client.get("/api/agents", headers=org_pair["org_a_headers"])
    assert response.status_code == 200
    names = [a["name"] for a in response.json()]
    assert "OrgB Agent" not in names


@pytest.mark.asyncio
async def test_agent_detail_cross_org_returns_404(client, org_pair):
    create_resp = await client.post(
        "/api/agents",
        json={
            "name": "OrgB Detail Agent",
            "role": "Researcher",
            "system_prompt": "You are a scoped detail agent.",
        },
        headers=org_pair["org_b_headers"],
    )
    assert create_resp.status_code == 201
    org_b_agent_id = create_resp.json()["id"]

    response = await client.get(f"/api/agents/{org_b_agent_id}", headers=org_pair["org_a_headers"])
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_executions_list_is_org_scoped(client, org_pair, db: AsyncSession):
    workflow = Workflow(
        id=str(uuid4()),
        org_id=org_pair["org_b"].id,
        name="OrgB Workflow",
        description="Scoped workflow",
        nodes=[],
        edges=[],
        status="draft",
        trigger="manual",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.commit()

    execution = Execution(
        id=str(uuid4()),
        org_id=org_pair["org_b"].id,
        workflow_id=workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Scoped execution",
        output_message="done",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        max_runtime_seconds=3600,
    )
    db.add(execution)
    await db.commit()

    response = await client.get("/api/executions", headers=org_pair["org_a_headers"])
    assert response.status_code == 200
    ids = [e["id"] for e in response.json()]
    assert execution.id not in ids


@pytest.mark.asyncio
async def test_analytics_costs_are_org_scoped(client, org_pair, db: AsyncSession):
    workflow_a = Workflow(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        name="OrgA Workflow",
        description="Scoped workflow A",
        nodes=[],
        edges=[],
        status="draft",
        trigger="manual",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    workflow_b = Workflow(
        id=str(uuid4()),
        org_id=org_pair["org_b"].id,
        name="OrgB Workflow",
        description="Scoped workflow B",
        nodes=[],
        edges=[],
        status="draft",
        trigger="manual",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add_all([workflow_a, workflow_b])
    await db.commit()

    exec_a = Execution(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        workflow_id=workflow_a.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Org A execution",
        output_message="done",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        cost=1.25,
        max_runtime_seconds=3600,
    )
    exec_b = Execution(
        id=str(uuid4()),
        org_id=org_pair["org_b"].id,
        workflow_id=workflow_b.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Org B execution",
        output_message="done",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        cost=9.99,
        max_runtime_seconds=3600,
    )
    db.add_all([exec_a, exec_b])
    await db.commit()

    db.add_all(
        [
            ExecutionCostLog(
                id=str(uuid4()),
                execution_id=exec_a.id,
                agent_id=None,
                user_id=org_pair["org_a_user"].id,
                org_id=org_pair["org_a"].id,
                model="gpt-4o-mini",
                input_tokens=100,
                output_tokens=50,
                cost_usd=1.25,
            ),
            ExecutionCostLog(
                id=str(uuid4()),
                execution_id=exec_b.id,
                agent_id=None,
                user_id=org_pair["org_b_user"].id,
                org_id=org_pair["org_b"].id,
                model="gpt-4o",
                input_tokens=200,
                output_tokens=100,
                cost_usd=9.99,
            ),
        ]
    )
    await db.commit()

    response = await client.get("/api/analytics/costs", headers=org_pair["org_a_headers"])
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_cost"] == 1.25
    assert payload["by_model"].get("gpt-4o-mini") == 1.25
    assert "gpt-4o" not in payload["by_model"]


@pytest.mark.asyncio
async def test_analytics_overview_counts_executions_without_cost_logs(client, org_pair, db: AsyncSession):
    workflow = Workflow(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        name="Analytics Workflow",
        description="Execution-only analytics coverage",
        nodes=[],
        edges=[],
        status="draft",
        trigger="manual",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.commit()

    started_at = datetime.utcnow()
    executions = [
        Execution(
            id=str(uuid4()),
            org_id=org_pair["org_a"].id,
            workflow_id=workflow.id,
            trigger="manual",
            status=ExecutionStatus.completed,
            input_message=f"Execution {index}",
            output_message="done",
            started_at=started_at - timedelta(days=index),
            completed_at=started_at - timedelta(days=index),
            cost=0.0,
            max_runtime_seconds=3600,
        )
        for index in range(3)
    ]
    db.add_all(executions)
    await db.commit()

    response = await client.get("/api/analytics/overview?period_days=7", headers=org_pair["org_a_headers"])
    assert response.status_code == 200
    payload = response.json()
    assert payload["workflow_runs"] == 3
    assert payload["executions_this_week"] == 3
    assert payload["completed_this_week"] == 3
    assert payload["failed_this_week"] == 0
    assert payload["total_approved"] == 0
    assert payload["first_draft_approved"] == 0
    assert payload["first_draft_rate"] == 0
    assert payload["avg_revisions"] == 1.0
    assert payload["pending_review_count"] == 0
    assert payload["costs"]["total_cost"] == 0.0
    assert len(payload["daily_executions"]) == 7
    assert sum(day["count"] for day in payload["daily_executions"]) == 3


@pytest.mark.asyncio
async def test_analytics_overview_includes_review_quality_metrics(client, org_pair, db: AsyncSession):
    workflow = Workflow(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        name="Reviewed Workflow",
        description="Review metrics coverage",
        nodes=[],
        edges=[],
        status="draft",
        trigger="manual",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.commit()

    now = datetime.utcnow()
    approved_first_draft = Execution(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        workflow_id=workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="First draft approved",
        output_message="done",
        started_at=now - timedelta(days=1),
        completed_at=now - timedelta(days=1),
        approved_by=org_pair["org_a_user"].id,
        approved_at=now - timedelta(days=1),
        revision_number=1,
        max_runtime_seconds=3600,
    )
    approved_second_draft = Execution(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        workflow_id=workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Second draft approved",
        output_message="done",
        started_at=now - timedelta(hours=10),
        completed_at=now - timedelta(hours=10),
        approved_by=org_pair["org_a_user"].id,
        approved_at=now - timedelta(hours=10),
        revision_number=2,
        max_runtime_seconds=3600,
    )
    waiting_review = Execution(
        id=str(uuid4()),
        org_id=org_pair["org_a"].id,
        workflow_id=workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="Needs review",
        started_at=now - timedelta(hours=1),
        max_runtime_seconds=3600,
    )
    db.add_all([approved_first_draft, approved_second_draft, waiting_review])
    await db.commit()

    response = await client.get("/api/analytics/overview?period_days=30", headers=org_pair["org_a_headers"])
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_approved"] == 2
    assert payload["first_draft_approved"] == 1
    assert payload["first_draft_rate"] == 50
    assert payload["avg_revisions"] == 1.5
    assert payload["pending_review_count"] == 1

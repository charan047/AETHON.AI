from datetime import datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from api import agency_overview as agency_overview_module
from database.models import (
    Agent,
    AgentApprovalRequest,
    Client,
    Execution,
    ExecutionStatus,
    Workflow,
)


@pytest.mark.asyncio
async def test_agency_overview_includes_empty_attention_queue(
    authed_client,
    db_engine,
    monkeypatch,
):
    monkeypatch.setattr(
        agency_overview_module,
        "AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    response = await authed_client.get("/api/agency/overview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["needs_attention"] == []
    assert payload["attention_count"] == 0


@pytest.mark.asyncio
async def test_agency_overview_returns_sorted_attention_items(
    authed_client,
    db,
    db_engine,
    monkeypatch,
    test_org,
    test_agent,
    test_workflow,
):
    monkeypatch.setattr(
        agency_overview_module,
        "AsyncSessionLocal",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    client = Client(
        org_id=test_org.id,
        name="Acme Corp",
        company_name="Acme Corp",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    pending_review_execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        client_id=client.id,
        status=ExecutionStatus.pending_review,
        input_message="Research competitor pricing and summarize the findings for Acme.",
        started_at=datetime.utcnow() - timedelta(hours=2),
    )
    waiting_approval_execution = Execution(
        id="exec-waiting-approval",
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        client_id=client.id,
        status=ExecutionStatus.waiting_approval,
        input_message="Pause this workflow until the CEO approves the outbound step.",
        started_at=datetime.utcnow() - timedelta(hours=1, minutes=15),
    )
    failed_workflow = Workflow(
        org_id=test_org.id,
        name="Failure Monitor",
        description="Failure monitor",
        nodes=test_workflow.nodes,
        edges=[],
        execution_mode="sequential",
        trigger="manual",
        status="draft",
    )
    db.add_all([pending_review_execution, waiting_approval_execution, failed_workflow])
    await db.commit()
    await db.refresh(failed_workflow)

    failed_execution = Execution(
        org_id=test_org.id,
        workflow_id=failed_workflow.id,
        status=ExecutionStatus.failed,
        input_message="Monitor competitor websites",
        error="web_search: rate limit exceeded",
        started_at=datetime.utcnow() - timedelta(minutes=35),
    )
    approval_request = AgentApprovalRequest(
        org_id=test_org.id,
        requesting_agent_id=test_agent.id,
        execution_id=pending_review_execution.id,
        approval_type="send_email",
        title="Maya wants to send outreach",
        description="Outreach to 42 leads",
        risk_level="critical",
        status="pending",
        created_at=datetime.utcnow() - timedelta(minutes=5),
    )
    db.add_all([failed_execution, approval_request])
    await db.commit()

    response = await authed_client.get("/api/agency/overview")

    assert response.status_code == 200
    payload = response.json()

    assert payload["attention_count"] == 4
    assert [item["type"] for item in payload["needs_attention"]] == [
        "approval_request",
        "pending_review",
        "pending_review",
        "failed",
    ]

    review_items = {
        item["execution_id"]: item
        for item in payload["needs_attention"]
        if item["type"] == "pending_review"
    }
    review_item = review_items[pending_review_execution.id]
    assert review_item["title"] == f"Needs review: {test_workflow.name}"
    assert review_item["client_name"] == "Acme Corp"
    assert review_item["status_label"] == "needs review"
    assert review_item["review_state"] == "needs_review"
    assert review_item["review_stage"] == "final_review"
    assert review_item["requires_ceo_action"] is True
    assert review_item["url"] == f"/executions/{pending_review_execution.id}"

    paused_item = review_items[waiting_approval_execution.id]
    assert paused_item["title"] == f"Needs review: {test_workflow.name}"
    assert paused_item["status_label"] == "needs review"
    assert paused_item["review_state"] == "needs_review"
    assert paused_item["review_stage"] == "workflow_pause"
    assert paused_item["requires_ceo_action"] is True
    assert paused_item["subtitle"] == "Workflow paused and is waiting for your approval."
    assert paused_item["url"] == f"/executions/{waiting_approval_execution.id}"

    approval_item = payload["needs_attention"][0]
    assert approval_item["urgency"] == "critical"
    assert approval_item["approval_id"] == approval_request.id
    assert approval_item["url"] == "/approvals"

    failed_item = next(
        item for item in payload["needs_attention"] if item["type"] == "failed"
    )
    assert failed_item["subtitle"] == "web_search: rate limit exceeded"
    assert failed_item["url"] == f"/executions/{failed_execution.id}"

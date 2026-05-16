from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from database.models import (
    Agent,
    AgentApprovalRequest,
    AgentTrustScore,
    Client,
    ClientStatus,
    Execution,
    ExecutionStatus,
    Workflow,
)


@pytest.mark.asyncio
async def test_get_agency_status_returns_real_snapshot(db, test_org, test_user):
    agent = Agent(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Maya",
        persona_name="Maya",
        role="research",
        role_slug="research-analyst",
        system_prompt="Help with research",
        current_status="working",
        current_task_summary="Running weekly market scan",
        trust_score=72.0,
        is_active=True,
    )
    trust = AgentTrustScore(
        agent_id=agent.id,
        overall_score=72.0,
    )
    workflow = Workflow(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Research Workflow",
        nodes=[{"id": "n1", "type": "agent", "data": {"agent_id": agent.id}}],
        edges=[],
        trigger="manual",
        status="active",
    )
    execution = Execution(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        workflow_id=workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Run weekly research",
        output_message="Done",
        started_at=datetime.utcnow() - timedelta(hours=1),
        completed_at=datetime.utcnow(),
    )
    approval = AgentApprovalRequest(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        requesting_agent_id=agent.id,
        approval_type="external_action",
        title="Send results to client",
        description="Needs approval before sending",
        risk_level="high",
        ai_recommendation="approve",
        status="pending",
    )
    db.add_all([agent, trust, workflow, execution, approval])
    await db.commit()

    from mcp_server import get_agency_status_impl

    snapshot = await get_agency_status_impl(test_org.id, db)

    assert snapshot["org"]["id"] == test_org.id
    assert snapshot["agents"]["total"] == 1
    assert snapshot["agents"]["working"] == 1
    assert snapshot["approvals"]["pending"] == 1
    assert snapshot["tasks_today"] >= 1
    assert snapshot["trust_scores"][0]["overall_score"] == 72.0


@pytest.mark.asyncio
async def test_run_agent_task_dispatches_execution(monkeypatch, db, test_org, test_user):
    agent = Agent(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Maya",
        persona_name="Maya",
        role="research",
        system_prompt="Help with research",
        is_active=True,
    )
    workflow = Workflow(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Research Workflow",
        nodes=[{"id": "n1", "type": "agent", "data": {"agent_id": agent.id}}],
        edges=[],
        trigger="manual",
        status="active",
    )
    db.add_all([agent, workflow])
    await db.commit()

    called: dict[str, str] = {}

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **kwargs):
        called["execution_id"] = execution_id
        called["workflow_id"] = workflow_id
        called["input_message"] = input_message
        called["user_id"] = user_id
        called["org_id"] = org_id
        return "background"

    monkeypatch.setattr("mcp_server.enqueue_workflow_execution", fake_enqueue)

    from mcp_server import run_agent_task_impl

    result = await run_agent_task_impl(test_org.id, "Maya", "Research OpenAI updates", db)

    execution = await db.scalar(select(Execution).where(Execution.id == result["execution_id"]))
    assert execution is not None
    assert called["workflow_id"] == workflow.id
    assert called["input_message"] == "Research OpenAI updates"
    assert result["dispatch"] == "background"
    assert result["agent"]["id"] == agent.id


@pytest.mark.asyncio
async def test_approve_and_reject_request_require_notes(db, test_org):
    agent = Agent(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Maya",
        role="research",
        system_prompt="Help with research",
        is_active=True,
    )
    approval = AgentApprovalRequest(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        requesting_agent_id=agent.id,
        approval_type="external_action",
        title="Publish update",
        description="Needs approval",
        risk_level="medium",
        status="pending",
    )
    db.add_all([agent, approval])
    await db.commit()

    from mcp_server import MCPToolError, approve_request_impl, reject_request_impl

    with pytest.raises(MCPToolError, match="Approval note is required"):
        await approve_request_impl(test_org.id, approval.id, "", db)

    with pytest.raises(MCPToolError, match="Rejection note is required"):
        await reject_request_impl(test_org.id, approval.id, "", db)

    approved = await approve_request_impl(test_org.id, approval.id, "Looks good", db)
    assert approved["status"] == "approved"

    approval_two = AgentApprovalRequest(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        requesting_agent_id=agent.id,
        approval_type="external_action",
        title="Delete draft",
        description="Needs approval",
        risk_level="low",
        status="pending",
    )
    db.add(approval_two)
    await db.commit()

    rejected = await reject_request_impl(test_org.id, approval_two.id, "Not yet", db)
    assert rejected["status"] == "rejected"


@pytest.mark.asyncio
async def test_list_clients_and_activity_include_portal_urls(db, test_org):
    client = Client(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Acme Corp",
        status=ClientStatus.active,
        portal_enabled=True,
        portal_token="portal-token-123",
        color="#3B82F6",
    )
    agent = Agent(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Maya",
        role="research",
        system_prompt="Help with research",
        client_id=client.id,
        is_active=True,
    )
    workflow = Workflow(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        name="Client Workflow",
        nodes=[{"id": "n1", "type": "agent", "data": {"agent_id": agent.id}}],
        edges=[],
        trigger="manual",
        status="active",
    )
    execution = Execution(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        workflow_id=workflow.id,
        client_id=client.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Client task",
        output_message="Done",
        started_at=datetime.utcnow() - timedelta(days=1),
        completed_at=datetime.utcnow() - timedelta(days=1),
    )
    db.add_all([client, agent, workflow, execution])
    await db.commit()

    from mcp_server import get_client_activity_impl, list_clients_impl

    clients = await list_clients_impl(test_org.id, db)
    assert clients["clients"][0]["portal_url"].endswith("/portal/portal-token-123")

    activity = await get_client_activity_impl(test_org.id, client_name="Acme", days=7, db=db)
    assert activity["clients"][0]["name"] == "Acme Corp"
    assert activity["clients"][0]["executions"] == 1

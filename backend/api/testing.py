from datetime import datetime, timedelta, timezone
import json
import secrets
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import (
    Agent,
    AgentApprovalRequest,
    ApprovalStatus,
    Client,
    Execution,
    ExecutionStatus,
    ExecutionStep,
    HumanApprovalRequest,
    Mission,
    MissionStatus,
    MissionTask,
    MissionTaskStatus,
    User,
    Workflow,
)


router = APIRouter(prefix="/testing", tags=["testing"])


class OpenSourceOrgOverrideRequest(BaseModel):
    plan: str = "open_source"


class ExecutionStatusOverrideRequest(BaseModel):
    status: ExecutionStatus
    output_message: str | None = None
    error: str | None = None


class E2EExecutionStepCreateRequest(BaseModel):
    step_type: str
    content: str
    tool_name: str | None = None
    tool_input: dict | None = None
    tool_output: dict | None = None
    tool_success: bool | None = None
    duration_ms: int | None = None
    tokens_used: int | None = None


class E2EExecutionCreateRequest(BaseModel):
    workflow_id: str
    status: ExecutionStatus
    input_message: str = "E2E execution"
    output_message: str | None = None
    error: str | None = None
    max_runtime_seconds: int = 30
    steps: list[E2EExecutionStepCreateRequest] = []


class E2EWorkflowApprovalCreateRequest(BaseModel):
    workflow_id: str
    execution_id: str
    node_id: str = "review_node"
    title: str
    description: str | None = None
    context_data: dict | str | None = None
    requested_by_agent_id: str | None = None
    expires_in_minutes: int = 45


class E2EAgentApprovalCreateRequest(BaseModel):
    agent_id: str
    execution_id: str | None = None
    approval_type: str = "tool_access"
    title: str
    description: str
    risk_level: str = "medium"
    expires_in_minutes: int = 30


class E2EMissionTaskCreateRequest(BaseModel):
    title: str
    description: str | None = None
    status: MissionTaskStatus = MissionTaskStatus.completed
    output_summary: str | None = None


class E2EMissionCreateRequest(BaseModel):
    goal: str
    title: str | None = None
    client_id: str | None = None
    status: MissionStatus = MissionStatus.completed
    report: str | None = None
    report_delivered: bool = False
    tasks: list[E2EMissionTaskCreateRequest] = []


def _testing_enabled() -> bool:
    return not (
        settings.environment == "production"
        or (settings.environment != "test" and not settings.enable_testing_api)
    )


def _ensure_testing_enabled() -> None:
    if not _testing_enabled():
        raise HTTPException(status_code=404, detail="Not found")


@router.post("/e2e/org-plan")
async def set_e2e_org_plan(
    data: OpenSourceOrgOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _ensure_testing_enabled()

    ctx.org.plan = "open_source"
    ctx.org.updated_at = datetime.now(timezone.utc)
    ctx.org.max_members = 999999
    ctx.org.max_agents = 999999
    ctx.org.max_workflows = 999999
    ctx.org.max_monthly_executions = 999999
    ctx.org.monthly_budget_usd = 999999.0

    await db.commit()
    await db.refresh(ctx.org)

    return {
        "org_id": ctx.org.id,
        "plan": str(ctx.org.plan),
    }


@router.post("/e2e/executions")
async def create_e2e_execution(
    data: E2EExecutionCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _ensure_testing_enabled()

    workflow = await db.scalar(
        select(Workflow).where(
            Workflow.id == data.workflow_id,
            Workflow.org_id == ctx.org.id,
        )
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    execution = Execution(
        org_id=ctx.org.id,
        workflow_id=data.workflow_id,
        trigger="manual",
        status=data.status,
        input_message=data.input_message,
        output_message=data.output_message or "",
        started_at=datetime.utcnow(),
        completed_at=(
            datetime.utcnow()
            if data.status in {
                ExecutionStatus.completed,
                ExecutionStatus.failed,
                ExecutionStatus.cancelled,
                ExecutionStatus.timed_out,
                ExecutionStatus.rejected,
            }
            else None
        ),
        token_count=0,
        cost=0.0,
        error=data.error,
        max_runtime_seconds=data.max_runtime_seconds,
        is_demo=False,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    if data.steps:
        for index, step in enumerate(data.steps):
            db.add(
                ExecutionStep(
                    execution_id=execution.id,
                    org_id=ctx.org.id,
                    step_type=step.step_type,
                    content=step.content,
                    tool_name=step.tool_name,
                    tool_input=step.tool_input,
                    tool_output=step.tool_output,
                    tool_success=step.tool_success,
                    step_index=index,
                    duration_ms=step.duration_ms,
                    tokens_used=step.tokens_used,
                )
            )
        await db.commit()

    return {
        "execution_id": execution.id,
        "status": execution.status.value,
        "created_by": current_user.email,
    }


@router.post("/e2e/executions/{execution_id}/status")
async def set_e2e_execution_status(
    execution_id: str,
    data: ExecutionStatusOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _ensure_testing_enabled()

    execution = await db.scalar(
        select(Execution).where(
            Execution.id == execution_id,
            Execution.org_id == ctx.org.id,
        )
    )
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    execution.status = data.status
    if data.output_message is not None:
        execution.output_message = data.output_message
    if data.error is not None:
        execution.error = data.error

    if data.status in {
        ExecutionStatus.completed,
        ExecutionStatus.failed,
        ExecutionStatus.cancelled,
        ExecutionStatus.timed_out,
        ExecutionStatus.rejected,
    }:
        execution.completed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(execution)

    return {
        "execution_id": execution.id,
        "status": execution.status.value,
        "updated_by": current_user.email,
    }


@router.post("/e2e/approvals/workflow")
async def create_e2e_workflow_approval(
    data: E2EWorkflowApprovalCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _ensure_testing_enabled()

    workflow = await db.scalar(
        select(Workflow).where(Workflow.id == data.workflow_id, Workflow.org_id == ctx.org.id)
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    execution = await db.scalar(
        select(Execution).where(
            Execution.id == data.execution_id,
            Execution.workflow_id == data.workflow_id,
            Execution.org_id == ctx.org.id,
        )
    )
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    if data.requested_by_agent_id:
        agent = await db.scalar(
            select(Agent).where(
                Agent.id == data.requested_by_agent_id,
                Agent.org_id == ctx.org.id,
            )
        )
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

    approval = HumanApprovalRequest(
        id=str(uuid4()),
        workflow_id=data.workflow_id,
        execution_id=data.execution_id,
        node_id=data.node_id,
        title=data.title,
        description=data.description,
        context_data=(
            json.dumps(data.context_data)
            if isinstance(data.context_data, dict)
            else data.context_data
        ),
        status=ApprovalStatus.pending,
        requested_by_agent_id=data.requested_by_agent_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=data.expires_in_minutes),
        resume_token=secrets.token_urlsafe(24),
    )
    db.add(approval)
    execution.status = ExecutionStatus.waiting_approval
    await db.commit()
    await db.refresh(approval)

    return {
        "approval_id": approval.id,
        "execution_id": execution.id,
        "workflow_id": workflow.id,
    }


@router.post("/e2e/approvals/agent-request")
async def create_e2e_agent_approval(
    data: E2EAgentApprovalCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _ensure_testing_enabled()

    agent = await db.scalar(
        select(Agent).where(
            Agent.id == data.agent_id,
            Agent.org_id == ctx.org.id,
        )
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if data.execution_id:
        execution = await db.scalar(
            select(Execution).where(
                Execution.id == data.execution_id,
                Execution.org_id == ctx.org.id,
            )
        )
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")

    approval = AgentApprovalRequest(
        id=str(uuid4()),
        org_id=ctx.org.id,
        requesting_agent_id=data.agent_id,
        execution_id=data.execution_id,
        approval_type=data.approval_type,
        title=data.title,
        description=data.description,
        risk_level=data.risk_level,
        status="pending",
        expires_at=datetime.utcnow() + timedelta(minutes=data.expires_in_minutes),
        created_at=datetime.utcnow(),
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    return {
        "approval_id": approval.id,
        "agent_id": agent.id,
    }


@router.post("/e2e/missions")
async def create_e2e_mission(
    data: E2EMissionCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _ensure_testing_enabled()

    if data.client_id:
        client = await db.scalar(
            select(Client).where(
                Client.id == data.client_id,
                Client.org_id == ctx.org.id,
            )
        )
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")

    mission = Mission(
        id=str(uuid4()),
        org_id=ctx.org.id,
        client_id=data.client_id,
        goal=data.goal,
        title=data.title,
        status=data.status,
        report=data.report,
        report_delivered=data.report_delivered,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        completed_at=datetime.utcnow() if data.status in {MissionStatus.completed, MissionStatus.failed} else None,
    )
    db.add(mission)
    await db.flush()

    for index, task in enumerate(data.tasks, start=1):
        db.add(
            MissionTask(
                id=str(uuid4()),
                mission_id=mission.id,
                org_id=ctx.org.id,
                sequence=index,
                title=task.title,
                description=task.description,
                status=task.status,
                output_summary=task.output_summary,
                started_at=datetime.utcnow() if task.status != MissionTaskStatus.pending else None,
                completed_at=datetime.utcnow()
                if task.status in {MissionTaskStatus.completed, MissionTaskStatus.failed, MissionTaskStatus.skipped}
                else None,
            )
        )

    await db.commit()
    await db.refresh(mission)

    return {
        "mission_id": mission.id,
        "status": mission.status.value if hasattr(mission.status, "value") else str(mission.status),
    }

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import Execution, ExecutionStatus, ExecutionStep, User, Workflow


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


@router.post("/e2e/org-plan")
async def set_e2e_org_plan(
    data: OpenSourceOrgOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    if settings.environment == "production" or (
        settings.environment != "test" and not settings.enable_testing_api
    ):
        raise HTTPException(status_code=404, detail="Not found")

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
    if settings.environment == "production" or (
        settings.environment != "test" and not settings.enable_testing_api
    ):
        raise HTTPException(status_code=404, detail="Not found")

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
    if settings.environment == "production" or (
        settings.environment != "test" and not settings.enable_testing_api
    ):
        raise HTTPException(status_code=404, detail="Not found")

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

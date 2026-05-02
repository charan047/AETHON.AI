from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import (
    Agent,
    Execution,
    ExecutionCostLog,
    ExecutionStatus,
    ToolCallLog,
    User,
    Workflow,
)
from services.telemetry_service import telemetry_service


router = APIRouter(dependencies=[Depends(get_current_user)])


def _duration_seconds_expr():
    return func.extract("epoch", Execution.completed_at) - func.extract("epoch", Execution.started_at)


@router.get("/costs")
async def get_costs(
    period_days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    since = datetime.utcnow() - timedelta(days=period_days)

    total_cost = await db.scalar(
        select(func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0))
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            Execution.org_id == ctx.org.id,
            ExecutionCostLog.created_at >= since,
        )
    ) or 0.0

    by_agent_result = await db.execute(
        select(
            func.coalesce(Agent.name, ExecutionCostLog.agent_id, "Unknown").label("agent_name"),
            func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0).label("total_cost"),
        )
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .outerjoin(Agent, Agent.id == ExecutionCostLog.agent_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            Execution.org_id == ctx.org.id,
            ExecutionCostLog.created_at >= since,
        )
        .group_by(Agent.name, ExecutionCostLog.agent_id)
        .order_by(func.sum(ExecutionCostLog.cost_usd).desc())
    )

    by_model_result = await db.execute(
        select(
            ExecutionCostLog.model,
            func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0).label("total_cost"),
        )
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            Execution.org_id == ctx.org.id,
            ExecutionCostLog.created_at >= since,
        )
        .group_by(ExecutionCostLog.model)
        .order_by(func.sum(ExecutionCostLog.cost_usd).desc())
    )

    by_workflow_result = await db.execute(
        select(
            func.coalesce(Workflow.name, "Unknown workflow").label("workflow_name"),
            func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0).label("total_cost"),
        )
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .outerjoin(Workflow, Workflow.id == Execution.workflow_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            Execution.org_id == ctx.org.id,
            ExecutionCostLog.created_at >= since,
        )
        .group_by(Workflow.name)
        .order_by(func.sum(ExecutionCostLog.cost_usd).desc())
    )

    daily_result = await db.execute(
        select(
            func.date(ExecutionCostLog.created_at).label("day"),
            func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0).label("total_cost"),
        )
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            Execution.org_id == ctx.org.id,
            ExecutionCostLog.created_at >= since,
        )
        .group_by(func.date(ExecutionCostLog.created_at))
        .order_by(func.date(ExecutionCostLog.created_at).asc())
    )

    projected = (float(total_cost) / max(period_days, 1)) * 30
    return {
        "total_cost": round(float(total_cost), 8),
        "by_agent": {
            agent_name: round(float(cost or 0), 8)
            for agent_name, cost in by_agent_result.all()
        },
        "by_model": {
            model: round(float(cost or 0), 8)
            for model, cost in by_model_result.all()
        },
        "by_workflow": {
            workflow_name: round(float(cost or 0), 8)
            for workflow_name, cost in by_workflow_result.all()
        },
        "daily_breakdown": [
            {"date": str(day), "cost": round(float(cost or 0), 8)}
            for day, cost in daily_result.all()
        ],
        "projected_monthly": round(projected, 8),
        "period_days": period_days,
    }


@router.get("/performance")
async def get_performance(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    workflow_result = await db.execute(
        select(
            Workflow.id,
            Workflow.name,
            func.count(Execution.id).label("runs"),
            func.count(case((Execution.status == ExecutionStatus.completed, 1))).label("success"),
            func.count(case((Execution.status == ExecutionStatus.failed, 1))).label("failed"),
            func.coalesce(func.avg(case(((Execution.completed_at.is_not(None)) & (Execution.started_at.is_not(None)), _duration_seconds_expr()))), 0.0).label("avg_duration_seconds"),
            func.coalesce(func.avg(Execution.cost), 0.0).label("avg_cost"),
        )
        .outerjoin(Execution, Execution.workflow_id == Workflow.id)
        .where(Workflow.org_id == ctx.org.id)
        .group_by(Workflow.id, Workflow.name)
        .order_by(Workflow.name.asc())
    )

    retry_events = defaultdict(int)
    try:
        from services.websocket_manager import ws_manager

        for event in await ws_manager.get_recent_logs_for_org(ctx.org.id):
            if event.get("type") == "agent_retry":
                retry_events[event.get("agent_id")] += 1
    except Exception:
        pass

    total_runtime = await db.scalar(
        select(func.coalesce(func.sum(case(((Execution.completed_at.is_not(None)) & (Execution.started_at.is_not(None)), _duration_seconds_expr()), else_=0.0)), 0.0))
        .where(Execution.org_id == ctx.org.id)
    ) or 0.0

    agents_result = await db.execute(
        select(Agent.id, Agent.name)
        .where(Agent.org_id == ctx.org.id)
        .order_by(Agent.name.asc())
    )

    workflow_rows = []
    for workflow_id, workflow_name, runs, success, failed, avg_duration_seconds, avg_cost in workflow_result.all():
        denominator = max((success or 0) + (failed or 0), 1)
        workflow_rows.append(
            {
                "workflow_id": workflow_id,
                "workflow_name": workflow_name,
                "runs": runs or 0,
                "success": success or 0,
                "failed": failed or 0,
                "success_rate": round(((success or 0) / denominator) * 100, 2),
                "avg_duration_seconds": round(float(avg_duration_seconds or 0), 2),
                "avg_cost": round(float(avg_cost or 0), 8),
            }
        )

    utilization = [
        {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "utilization_percent": round((retry_events.get(agent_id, 0) / max(float(total_runtime or 0), 1)) * 100, 2),
            "retry_count": retry_events.get(agent_id, 0),
        }
        for agent_id, agent_name in agents_result.all()
    ]

    return {
        "workflows": workflow_rows,
        "agent_utilization": utilization,
        "retry_rates": {agent_id: count for agent_id, count in retry_events.items()},
    }


@router.get("/tools")
async def get_tool_analytics(
    period_days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    since = datetime.utcnow() - timedelta(days=period_days)

    result = await db.execute(
        select(
            ToolCallLog.tool_name,
            func.count(ToolCallLog.id).label("calls"),
            func.count(case((ToolCallLog.success == True, 1))).label("successes"),  # noqa: E712
            func.count(case((ToolCallLog.success == False, 1))).label("failures"),  # noqa: E712
            func.coalesce(func.avg(ToolCallLog.duration_ms), 0.0).label("avg_duration_ms"),
        )
        .outerjoin(Execution, Execution.id == ToolCallLog.execution_id)
        .where(
            ToolCallLog.user_id == current_user.id,
            ToolCallLog.created_at >= since,
            or_(ToolCallLog.execution_id.is_(None), Execution.org_id == ctx.org.id),
        )
        .group_by(ToolCallLog.tool_name)
    )

    cost_result = await db.execute(
        select(ExecutionCostLog.model, func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0))
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            ExecutionCostLog.created_at >= since,
            Execution.org_id == ctx.org.id,
        )
        .group_by(ExecutionCostLog.model)
        .order_by(func.sum(ExecutionCostLog.cost_usd).desc())
    )

    return {
        "tools": [
            {
                "tool_name": tool_name,
                "calls": calls or 0,
                "success_rate": round((((successes or 0) / max(calls or 0, 1)) * 100), 2),
                "avg_duration_ms": round(float(avg_duration_ms or 0), 2),
                "error_rate": round((((failures or 0) / max(calls or 0, 1)) * 100), 2),
            }
            for tool_name, calls, successes, failures, avg_duration_ms in sorted(
                result.all(),
                key=lambda item: item[1] or 0,
                reverse=True,
            )
        ],
        "most_expensive_tool_calls": [
            {"model": model, "cost_usd": round(float(cost or 0), 8)}
            for model, cost in cost_result.all()
        ],
    }


@router.get("/overview")
async def get_analytics_overview(
    period_days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    costs = await get_costs(period_days=period_days, db=db, current_user=current_user, ctx=ctx)
    execution_counts = (
        await db.execute(
            select(
                func.count(Execution.id).label("total"),
                func.count(case((Execution.status == ExecutionStatus.completed, 1))).label("completed"),
                func.count(case((Execution.status == ExecutionStatus.failed, 1))).label("failed"),
            )
            .where(Execution.org_id == ctx.org.id)
        )
    ).one()
    tool_calls = await db.scalar(
        select(func.count(ToolCallLog.id))
        .outerjoin(Execution, Execution.id == ToolCallLog.execution_id)
        .where(
            ToolCallLog.user_id == current_user.id,
            or_(ToolCallLog.execution_id.is_(None), Execution.org_id == ctx.org.id),
        )
    ) or 0

    return {
        "costs": costs,
        "workflow_runs": execution_counts.total or 0,
        "workflow_success_rate": round(((execution_counts.completed or 0) / max((execution_counts.completed or 0) + (execution_counts.failed or 0), 1)) * 100, 2),
        "tool_calls": tool_calls,
        "api_calls_last_minute": telemetry_service.get_api_calls_last_minute(),
    }

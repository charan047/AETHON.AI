import asyncio
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    Client,
    Execution,
    ExecutionCostLog,
    ExecutionStatus,
    FileStatus,
    OrgFile,
    OrgStorageQuota,
    ToolCallLog,
    User,
    Workflow,
)
from services.telemetry_service import telemetry_service


router = APIRouter(dependencies=[Depends(get_current_user)])


def _duration_seconds_expr():
    return func.extract("epoch", Execution.completed_at) - func.extract("epoch", Execution.started_at)


def _normalize_daily_series(
    rows: list[tuple[object, object]],
    period_days: int,
) -> list[dict[str, int]]:
    by_date = {
        str(day): int(value or 0)
        for day, value in rows
        if day is not None
    }
    start = (datetime.utcnow() - timedelta(days=period_days - 1)).date()
    return [
        {
            "date": (start + timedelta(days=index)).isoformat(),
            "count": by_date.get((start + timedelta(days=index)).isoformat(), 0),
        }
        for index in range(period_days)
    ]


async def _run_in_fresh_session(fn, *args):
    async with AsyncSessionLocal() as db:
        return await fn(*args, db)


async def _get_costs_for_overview(
    period_days: int,
    current_user: User,
    ctx: OrgContext,
    db: AsyncSession,
):
    return await get_costs(period_days=period_days, db=db, current_user=current_user, ctx=ctx)


async def _get_storage_metrics(
    org_id: str,
    date_from: datetime,
    db: AsyncSession,
) -> dict:
    files_this_period = await db.scalar(
        select(func.count(OrgFile.id))
        .where(
            OrgFile.org_id == org_id,
            OrgFile.status == FileStatus.ready,
            OrgFile.created_at >= date_from,
        )
    )

    files_by_type = (
        await db.execute(
            select(
                OrgFile.file_type,
                func.count(OrgFile.id).label("count"),
            )
            .where(
                OrgFile.org_id == org_id,
                OrgFile.status == FileStatus.ready,
            )
            .group_by(OrgFile.file_type)
        )
    ).all()

    quota = await db.scalar(
        select(OrgStorageQuota).where(OrgStorageQuota.org_id == org_id)
    )

    files_by_client = (
        await db.execute(
            select(
                Client.name,
                Client.company_name,
                func.count(OrgFile.id).label("file_count"),
            )
            .join(Client, OrgFile.client_id == Client.id)
            .where(
                OrgFile.org_id == org_id,
                OrgFile.status == FileStatus.ready,
            )
            .group_by(Client.id, Client.name, Client.company_name)
            .order_by(func.count(OrgFile.id).desc())
            .limit(5)
        )
    ).all()

    used_bytes = int(quota.used_bytes or 0) if quota else 0
    quota_bytes = int(quota.quota_bytes or settings.storage_quota_per_org) if quota else settings.storage_quota_per_org

    return {
        "files_this_period": int(files_this_period or 0),
        "files_by_type": {
            row.file_type.value if row.file_type else "other": int(row.count or 0)
            for row in files_by_type
        },
        "storage_used_bytes": used_bytes,
        "storage_quota_bytes": quota_bytes,
        "storage_percent": round((used_bytes / max(quota_bytes, 1)) * 100, 1),
        "files_by_client": [
            {
                "name": row.company_name or row.name,
                "count": int(row.file_count or 0),
            }
            for row in files_by_client
        ],
    }


async def _get_execution_counts(org_id: str, since: datetime, db: AsyncSession):
    return (
        await db.execute(
            select(
                func.count(Execution.id).label("total"),
                func.count(case((Execution.status == ExecutionStatus.completed, 1))).label("completed"),
                func.count(case((Execution.status == ExecutionStatus.failed, 1))).label("failed"),
            )
            .where(
                Execution.org_id == org_id,
                Execution.started_at >= since,
            )
        )
    ).one()


async def _get_approved_counts(org_id: str, since: datetime, db: AsyncSession):
    return (
        await db.execute(
            select(
                func.count(Execution.id).label("total_approved"),
                func.count(
                    case(
                        (
                            (Execution.approved_by.is_not(None))
                            & (Execution.revision_number == 1),
                            1,
                        )
                    )
                ).label("first_draft_approved"),
                func.coalesce(func.avg(Execution.revision_number), 1.0).label("avg_revisions"),
            )
            .where(
                Execution.org_id == org_id,
                Execution.started_at >= since,
                Execution.approved_by.is_not(None),
            )
        )
    ).one()


async def _get_pending_review_count(org_id: str, db: AsyncSession) -> int:
    return int(
        await db.scalar(
            select(func.count(Execution.id)).where(
                Execution.org_id == org_id,
                Execution.status == ExecutionStatus.pending_review,
            )
        )
        or 0
    )


async def _get_daily_execution_rows(org_id: str, since: datetime, db: AsyncSession):
    return (
        await db.execute(
            select(
                func.date(Execution.started_at).label("day"),
                func.count(Execution.id).label("count"),
            )
            .where(
                Execution.org_id == org_id,
                Execution.started_at >= since,
            )
            .group_by(func.date(Execution.started_at))
            .order_by(func.date(Execution.started_at).asc())
        )
    ).all()


async def _get_tool_call_count(org_id: str, user_id: str, db: AsyncSession) -> int:
    return int(
        await db.scalar(
            select(func.count(ToolCallLog.id))
            .outerjoin(Execution, Execution.id == ToolCallLog.execution_id)
            .where(
                ToolCallLog.user_id == user_id,
                or_(
                    and_(ToolCallLog.execution_id.is_(None), ToolCallLog.org_id == org_id),
                    Execution.org_id == org_id,
                ),
            )
        )
        or 0
    )


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
            ExecutionCostLog.org_id == ctx.org.id,
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
            ExecutionCostLog.org_id == ctx.org.id,
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
            ExecutionCostLog.org_id == ctx.org.id,
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
            ExecutionCostLog.org_id == ctx.org.id,
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
            ExecutionCostLog.org_id == ctx.org.id,
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
            or_(
                and_(ToolCallLog.execution_id.is_(None), ToolCallLog.org_id == ctx.org.id),
                Execution.org_id == ctx.org.id,
            ),
        )
        .group_by(ToolCallLog.tool_name)
    )

    cost_result = await db.execute(
        select(ExecutionCostLog.model, func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0))
        .join(Execution, Execution.id == ExecutionCostLog.execution_id)
        .where(
            ExecutionCostLog.user_id == current_user.id,
            ExecutionCostLog.created_at >= since,
            ExecutionCostLog.org_id == ctx.org.id,
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
    since = datetime.utcnow() - timedelta(days=period_days)
    if "sqlite" in str(db.bind.url).lower():
        costs = await _get_costs_for_overview(period_days, current_user, ctx, db)
        execution_counts = await _get_execution_counts(ctx.org.id, since, db)
        approved_counts = await _get_approved_counts(ctx.org.id, since, db)
        pending_review_count = await _get_pending_review_count(ctx.org.id, db)
        daily_execution_rows = await _get_daily_execution_rows(ctx.org.id, since, db)
        tool_calls = await _get_tool_call_count(ctx.org.id, current_user.id, db)
        storage_metrics = await _get_storage_metrics(ctx.org.id, since, db)
    else:
        (
            costs,
            execution_counts,
            approved_counts,
            pending_review_count,
            daily_execution_rows,
            tool_calls,
            storage_metrics,
        ) = await asyncio.gather(
            _run_in_fresh_session(_get_costs_for_overview, period_days, current_user, ctx),
            _run_in_fresh_session(_get_execution_counts, ctx.org.id, since),
            _run_in_fresh_session(_get_approved_counts, ctx.org.id, since),
            _run_in_fresh_session(_get_pending_review_count, ctx.org.id),
            _run_in_fresh_session(_get_daily_execution_rows, ctx.org.id, since),
            _run_in_fresh_session(_get_tool_call_count, ctx.org.id, current_user.id),
            _run_in_fresh_session(_get_storage_metrics, ctx.org.id, since),
        )
    total_approved = int(approved_counts.total_approved or 0)
    first_draft_approved = int(approved_counts.first_draft_approved or 0)
    first_draft_rate = (
        round((first_draft_approved / total_approved) * 100)
        if total_approved > 0
        else 0
    )
    avg_revisions = round(float(approved_counts.avg_revisions or 1), 1)

    return {
        "costs": costs,
        "workflow_runs": int(execution_counts.total or 0),
        "workflow_success_rate": round(((execution_counts.completed or 0) / max((execution_counts.completed or 0) + (execution_counts.failed or 0), 1)) * 100, 2),
        "executions_this_week": int(execution_counts.total or 0),
        "completed_this_week": int(execution_counts.completed or 0),
        "failed_this_week": int(execution_counts.failed or 0),
        "daily_executions": _normalize_daily_series(
            daily_execution_rows,
            period_days=period_days,
        ),
        "total_approved": total_approved,
        "first_draft_approved": first_draft_approved,
        "first_draft_rate": first_draft_rate,
        "avg_revisions": avg_revisions,
        "pending_review_count": int(pending_review_count),
        "tool_calls": tool_calls,
        "storage_metrics": storage_metrics,
        "api_calls_last_minute": telemetry_service.get_api_calls_last_minute(),
    }

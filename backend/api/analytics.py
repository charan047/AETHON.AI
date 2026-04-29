from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
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
from services.cost_tracker import cost_tracker
from services.telemetry_service import telemetry_service


router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/costs")
async def get_costs(
    period_days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await cost_tracker.get_user_costs(current_user.id, period_days=period_days, db=db)


@router.get("/performance")
async def get_performance(db: AsyncSession = Depends(get_db)):
    workflows = (await db.execute(select(Workflow))).scalars().all()
    executions = (await db.execute(select(Execution))).scalars().all()
    agents = (await db.execute(select(Agent))).scalars().all()

    by_workflow = defaultdict(list)
    for execution in executions:
        by_workflow[execution.workflow_id].append(execution)

    workflow_rows = []
    for workflow in workflows:
        rows = by_workflow.get(workflow.id, [])
        completed = [row for row in rows if row.status == ExecutionStatus.completed]
        failed = [row for row in rows if row.status == ExecutionStatus.failed]
        total_cost = sum(row.cost or 0 for row in rows)
        durations = [
            (row.completed_at - row.started_at).total_seconds()
            for row in rows
            if row.completed_at and row.started_at
        ]
        workflow_rows.append(
            {
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "runs": len(rows),
                "success": len(completed),
                "failed": len(failed),
                "success_rate": round((len(completed) / max(len(completed) + len(failed), 1)) * 100, 2),
                "avg_duration_seconds": round(sum(durations) / max(len(durations), 1), 2),
                "avg_cost": round(total_cost / max(len(rows), 1), 8),
            }
        )

    retry_events = defaultdict(int)
    try:
        from services.websocket_manager import ws_manager

        for event in ws_manager.log_buffer:
            if event.get("type") == "agent_retry":
                retry_events[event.get("agent_id")] += 1
    except Exception:
        pass

    total_runtime = sum(
        (row.completed_at - row.started_at).total_seconds()
        for row in executions
        if row.completed_at and row.started_at
    )
    utilization = [
        {
            "agent_id": agent.id,
            "agent_name": agent.name,
            "utilization_percent": round((retry_events.get(agent.id, 0) / max(total_runtime, 1)) * 100, 2),
            "retry_count": retry_events.get(agent.id, 0),
        }
        for agent in agents
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
):
    since = datetime.utcnow() - timedelta(days=period_days)
    result = await db.execute(
        select(ToolCallLog).where(
            ToolCallLog.user_id == current_user.id,
            ToolCallLog.created_at >= since,
        )
    )
    logs = result.scalars().all()

    by_tool = defaultdict(list)
    for log in logs:
        by_tool[log.tool_name].append(log)

    rows = []
    for tool_name, tool_logs in by_tool.items():
        failures = [log for log in tool_logs if not log.success]
        total_duration = sum(log.duration_ms or 0 for log in tool_logs)
        rows.append(
            {
                "tool_name": tool_name,
                "calls": len(tool_logs),
                "success_rate": round(((len(tool_logs) - len(failures)) / max(len(tool_logs), 1)) * 100, 2),
                "avg_duration_ms": round(total_duration / max(len(tool_logs), 1), 2),
                "error_rate": round((len(failures) / max(len(tool_logs), 1)) * 100, 2),
            }
        )

    cost_result = await db.execute(
        select(ExecutionCostLog.model, func.sum(ExecutionCostLog.cost_usd))
        .where(
            ExecutionCostLog.user_id == current_user.id,
            ExecutionCostLog.created_at >= since,
        )
        .group_by(ExecutionCostLog.model)
        .order_by(func.sum(ExecutionCostLog.cost_usd).desc())
    )

    return {
        "tools": sorted(rows, key=lambda item: item["calls"], reverse=True),
        "most_expensive_tool_calls": [
            {"model": model, "cost_usd": round(cost or 0, 8)}
            for model, cost in cost_result.all()
        ],
    }


@router.get("/overview")
async def get_analytics_overview(
    period_days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    costs = await cost_tracker.get_user_costs(current_user.id, period_days=period_days, db=db)
    total_runs = await db.scalar(select(func.count(Execution.id))) or 0
    completed = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.completed)
    ) or 0
    failed = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.failed)
    ) or 0
    tool_calls = await db.scalar(
        select(func.count(ToolCallLog.id)).where(ToolCallLog.user_id == current_user.id)
    ) or 0

    return {
        "costs": costs,
        "workflow_runs": total_runs,
        "workflow_success_rate": round((completed / max(completed + failed, 1)) * 100, 2),
        "tool_calls": tool_calls,
        "api_calls_last_minute": telemetry_service.get_api_calls_last_minute(),
    }

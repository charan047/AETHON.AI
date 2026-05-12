import asyncio
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    AgentApprovalRequest,
    ApprovalStatus,
    Client,
    ClientStatus,
    Execution,
    ExecutionStatus,
    HumanApprovalRequest,
    Message,
    User,
    Workflow,
)


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


def _iso(value):
    return value.isoformat() if value else None


def _preview(value: str | None, limit: int = 120) -> str:
    text = (value or "").strip()
    if not text:
        return "No task summary available"
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}..."


async def _clients_overview(org_id: str) -> dict:
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    async with AsyncSessionLocal() as db:
        total = await db.scalar(select(func.count(Client.id)).where(Client.org_id == org_id)) or 0
        active = await db.scalar(
            select(func.count(Client.id)).where(
                Client.org_id == org_id,
                Client.status == ClientStatus.active,
            )
        ) or 0
        with_activity_today = await db.scalar(
            select(func.count(func.distinct(Execution.client_id))).where(
                Execution.org_id == org_id,
                Execution.client_id.isnot(None),
                Execution.started_at >= today_start,
            )
        ) or 0

        agent_counts_sq = (
            select(
                Agent.client_id.label("client_id"),
                func.count(Agent.id).label("agent_count"),
            )
            .where(
                Agent.org_id == org_id,
                Agent.client_id.isnot(None),
                Agent.is_active.is_(True),
            )
            .group_by(Agent.client_id)
            .subquery()
        )
        today_counts_sq = (
            select(
                Execution.client_id.label("client_id"),
                func.count(Execution.id).label("executions_today"),
            )
            .where(
                Execution.org_id == org_id,
                Execution.client_id.isnot(None),
                Execution.started_at >= today_start,
            )
            .group_by(Execution.client_id)
            .subquery()
        )
        last_activity_sq = (
            select(
                Execution.client_id.label("client_id"),
                func.max(Execution.started_at).label("last_activity"),
            )
            .where(
                Execution.org_id == org_id,
                Execution.client_id.isnot(None),
            )
            .group_by(Execution.client_id)
            .subquery()
        )

        top_clients_stmt = (
            select(
                Client.id,
                Client.name,
                Client.company_name,
                Client.color,
                Client.status,
                func.coalesce(agent_counts_sq.c.agent_count, 0).label("agent_count"),
                func.coalesce(today_counts_sq.c.executions_today, 0).label("executions_today"),
                last_activity_sq.c.last_activity,
            )
            .outerjoin(agent_counts_sq, agent_counts_sq.c.client_id == Client.id)
            .outerjoin(today_counts_sq, today_counts_sq.c.client_id == Client.id)
            .outerjoin(last_activity_sq, last_activity_sq.c.client_id == Client.id)
            .where(Client.org_id == org_id)
            .order_by(desc(last_activity_sq.c.last_activity).nullslast(), Client.created_at.desc())
            .limit(5)
        )

        top_clients = []
        for row in (await db.execute(top_clients_stmt)).all():
            top_clients.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "company_name": row.company_name,
                    "color": row.color or "#6366F1",
                    "status": row.status.value if hasattr(row.status, "value") else row.status,
                    "agent_count": row.agent_count or 0,
                    "executions_today": row.executions_today or 0,
                    "last_activity": _iso(row.last_activity),
                }
            )

    return {
        "total": total,
        "active": active,
        "with_activity_today": with_activity_today,
        "list": top_clients,
    }


async def _agents_overview(org_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Agent, Client.name.label("client_name"), Client.color.label("client_color"))
            .outerjoin(Client, Client.id == Agent.client_id)
            .where(
                Agent.org_id == org_id,
                Agent.is_active.is_(True),
            )
            .order_by(Agent.created_at.asc())
        )
        rows = (await db.execute(stmt)).all()

    agents = []
    working = 0
    idle = 0
    for agent, client_name, client_color in rows:
        status = (agent.current_status or "idle").strip() or "idle"
        if status == "working":
            working += 1
        else:
            idle += 1
        agents.append(
            {
                "id": agent.id,
                "name": agent.name,
                "persona_name": agent.persona_name,
                "role": agent.role,
                "role_slug": agent.role_slug,
                "current_status": status,
                "current_task_summary": agent.current_task_summary,
                "client_id": agent.client_id,
                "client_name": client_name,
                "client_color": client_color or "#6366F1",
                "tasks_completed": agent.total_tasks_completed or 0,
            }
        )

    return {
        "total": len(agents),
        "working": working,
        "idle": idle,
        "list": agents,
    }


async def _approvals_overview(org_id: str) -> dict:
    urgent_cutoff = datetime.utcnow() + timedelta(hours=2)
    async with AsyncSessionLocal() as db:
        agent_pending = (
            await db.execute(
                select(AgentApprovalRequest, Agent.name)
                .join(Agent, Agent.id == AgentApprovalRequest.requesting_agent_id)
                .where(
                    AgentApprovalRequest.org_id == org_id,
                    AgentApprovalRequest.status == "pending",
                )
                .order_by(AgentApprovalRequest.created_at.desc())
                .limit(6)
            )
        ).all()
        human_pending = (
            await db.execute(
                select(HumanApprovalRequest, Agent.name)
                .join(Workflow, Workflow.id == HumanApprovalRequest.workflow_id)
                .outerjoin(Agent, Agent.id == HumanApprovalRequest.requested_by_agent_id)
                .where(
                    Workflow.org_id == org_id,
                    HumanApprovalRequest.status == ApprovalStatus.pending,
                )
                .order_by(HumanApprovalRequest.requested_at.desc())
                .limit(6)
            )
        ).all()

    combined = []
    critical = 0

    for approval, agent_name in agent_pending:
        risk_level = approval.risk_level or "medium"
        if risk_level in {"high", "critical"}:
            critical += 1
        combined.append(
            {
                "id": approval.id,
                "type": "agent",
                "title": approval.title,
                "risk_level": risk_level,
                "agent_name": agent_name or "Agent",
                "created_at": _iso(approval.created_at),
            }
        )

    for approval, agent_name in human_pending:
        if approval.expires_at and approval.expires_at.replace(tzinfo=None) <= urgent_cutoff:
            critical += 1
        combined.append(
            {
                "id": approval.id,
                "type": "human",
                "title": approval.title,
                "risk_level": "high" if approval.expires_at and approval.expires_at.replace(tzinfo=None) <= urgent_cutoff else "medium",
                "agent_name": agent_name or "Workflow",
                "created_at": _iso(approval.requested_at),
            }
        )

    combined.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return {
        "pending": len(combined),
        "critical": critical,
        "list": combined[:3],
    }


async def _activity_overview(org_id: str) -> dict:
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    message_agent_sq = (
        select(
            Message.execution_id.label("execution_id"),
            func.min(Message.from_agent).label("agent_name"),
        )
        .group_by(Message.execution_id)
        .subquery()
    )

    async with AsyncSessionLocal() as db:
        executions_today = await db.scalar(
            select(func.count(Execution.id)).where(
                Execution.org_id == org_id,
                Execution.started_at >= today_start,
            )
        ) or 0
        completed_today = await db.scalar(
            select(func.count(Execution.id)).where(
                Execution.org_id == org_id,
                Execution.started_at >= today_start,
                Execution.status == ExecutionStatus.completed,
            )
        ) or 0
        recent_stmt = (
            select(
                Execution.id,
                Execution.client_id,
                Client.name.label("client_name"),
                message_agent_sq.c.agent_name,
                Execution.status,
                Execution.started_at,
                Execution.input_message,
            )
            .outerjoin(Client, Client.id == Execution.client_id)
            .outerjoin(message_agent_sq, message_agent_sq.c.execution_id == Execution.id)
            .where(Execution.org_id == org_id)
            .order_by(Execution.started_at.desc())
            .limit(8)
        )
        rows = (await db.execute(recent_stmt)).all()

    recent = []
    for row in rows:
        recent.append(
            {
                "id": row.id,
                "client_id": row.client_id,
                "client_name": row.client_name,
                "agent_name": row.agent_name or "Agent",
                "status": row.status.value if hasattr(row.status, "value") else row.status,
                "started_at": _iso(row.started_at),
                "input_preview": _preview(row.input_message, limit=110),
            }
        )

    return {
        "executions_today": executions_today,
        "completed_today": completed_today,
        "recent": recent,
    }


@router.get("/overview")
async def agency_overview(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    clients, agents, approvals, activity = await asyncio.gather(
        _clients_overview(ctx.org.id),
        _agents_overview(ctx.org.id),
        _approvals_overview(ctx.org.id),
        _activity_overview(ctx.org.id),
    )
    return {
        "agency_name": ctx.org.name,
        "owner_user_id": current_user.id,
        "clients": clients,
        "agents": agents,
        "approvals": approvals,
        "activity": activity,
        "generated_at": datetime.utcnow().isoformat(),
    }

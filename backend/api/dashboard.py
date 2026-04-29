import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    AgentReputation,
    ApprovalStatus,
    CompanyProfile,
    Execution,
    ExecutionStatus,
    FeedbackType,
    AgentFeedback,
    HumanApprovalRequest,
    InAppNotification,
    Message,
    User,
    Workflow,
)
from services.websocket_manager import ws_manager


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


def _iso(value):
    return value.isoformat() if value else None


async def _company_profile(user_id: str, org_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(CompanyProfile).where(CompanyProfile.user_id == user_id, CompanyProfile.org_id == org_id))
        profile = result.scalar_one_or_none()
        if not profile:
            return {"name": "Your AI Company", "industry": "Company OS", "stage": "setup", "monthly_revenue": 0, "runway_months": None}
        return {
            "name": profile.company_name,
            "industry": profile.industry,
            "stage": profile.stage,
            "monthly_revenue": profile.monthly_revenue or 0,
            "runway_months": profile.runway_months,
        }


async def _this_week(org_id: str) -> dict:
    cutoff = datetime.utcnow() - timedelta(days=7)
    async with AsyncSessionLocal() as db:
        total = await db.scalar(select(func.count(Execution.id)).where(Execution.started_at >= cutoff, Execution.org_id == org_id)) or 0
        completed = await db.scalar(
            select(func.count(Execution.id)).where(
                Execution.started_at >= cutoff,
                Execution.org_id == org_id,
                Execution.status == ExecutionStatus.completed,
            )
        ) or 0
        failed = await db.scalar(
            select(func.count(Execution.id)).where(
                Execution.started_at >= cutoff,
                Execution.org_id == org_id,
                Execution.status == ExecutionStatus.failed,
            )
        ) or 0
    success_rate = round((completed / max(completed + failed, 1)) * 100, 1)
    artifacts = len(_recent_artifacts_from_logs(cutoff)) + completed
    return {
        "workflows_run": total,
        "success_rate": success_rate,
        "tasks_completed": completed,
        "artifacts_produced": artifacts,
    }


async def _team_status(org_id: str) -> list[dict]:
    async with AsyncSessionLocal() as db:
        agents = (await db.execute(select(Agent).where(Agent.org_id == org_id).order_by(Agent.created_at.asc()))).scalars().all()
        reputations = {
            rep.agent_id: rep
            for rep in (await db.execute(select(AgentReputation))).scalars().all()
        }
        last_messages = {}
        result = await db.execute(
            select(Message.from_agent, func.max(Message.timestamp))
            .group_by(Message.from_agent)
        )
        for name, timestamp in result.all():
            last_messages[name] = timestamp

    running_by_name = {}
    waiting_by_name = {}
    for event in reversed(list(ws_manager.log_buffer)):
        agent_name = event.get("agent") or event.get("agent_name") or event.get("name")
        if not agent_name:
            continue
        event_type = event.get("type")
        if event_type in {"agent_started", "tool_call"} and agent_name not in running_by_name:
            running_by_name[agent_name] = event.get("task") or event.get("workflow") or event.get("input") or "Working..."
        if event_type in {"hitl_requested", "workflow_paused"} and agent_name not in waiting_by_name:
            waiting_by_name[agent_name] = event.get("title") or "Awaiting approval"

    rows = []
    for agent in agents:
        status = "idle"
        current_task = None
        if agent.name in waiting_by_name:
            status = "waiting"
            current_task = waiting_by_name[agent.name]
        elif agent.name in running_by_name:
            status = "running"
            current_task = running_by_name[agent.name]
        rep = reputations.get(agent.id)
        rows.append(
            {
                "agent_id": agent.id,
                "name": agent.name,
                "role": agent.role,
                "status": status,
                "current_task": current_task,
                "last_active": _iso(last_messages.get(agent.name)),
                "approval_rate": rep.approval_rate if rep and rep.total_tasks and rep.total_tasks > 5 else None,
            }
        )
    return rows


async def _pending_attention(user_id: str, org_id: str) -> list[dict]:
    now = datetime.now(timezone.utc)
    items = []
    async with AsyncSessionLocal() as db:
        profile_result = await db.execute(
            select(CompanyProfile).where(CompanyProfile.user_id == user_id)
            .where(CompanyProfile.org_id == org_id)
        )
        profile = profile_result.scalar_one_or_none()
        approvals = await db.execute(
            select(HumanApprovalRequest, Agent.name)
            .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
            .outerjoin(Agent, HumanApprovalRequest.requested_by_agent_id == Agent.id)
            .where(HumanApprovalRequest.status == ApprovalStatus.pending, Workflow.org_id == org_id)
            .order_by(HumanApprovalRequest.requested_at.asc())
        )
        flagged = await db.execute(
            select(AgentFeedback, Agent.name)
            .join(Agent, AgentFeedback.agent_id == Agent.id)
            .where(AgentFeedback.feedback_type == FeedbackType.flagged, Agent.org_id == org_id)
            .order_by(AgentFeedback.created_at.desc())
            .limit(5)
        )

    for approval, agent_name in approvals.all():
        urgent = bool(approval.expires_at and approval.expires_at < now + timedelta(hours=2))
        items.append(
            {
                "id": approval.id,
                "type": "approval",
                "title": approval.title,
                "description": approval.description or "Human approval requested before the workflow continues.",
                "priority": "urgent" if urgent else "normal",
                "agent_name": agent_name or "Agent",
                "created_at": _iso(approval.requested_at),
                "action_url": "/approvals",
            }
        )

    for feedback, agent_name in flagged.all():
        items.append(
            {
                "id": feedback.id,
                "type": "flagged_issue",
                "title": "Flagged agent output",
                "description": feedback.comment or (feedback.original_output[:180] if feedback.original_output else "Needs investigation."),
                "priority": "urgent",
                "agent_name": agent_name or "Agent",
                "created_at": _iso(feedback.created_at),
                "action_url": f"/chat/{feedback.execution_id}",
            }
        )

    runway = profile.runway_months if profile else None
    if runway is not None and runway < 6:
        items.append(
            {
                "id": "budget-runway",
                "type": "budget_alert",
                "title": "Runway needs attention",
                "description": f"Runway is down to {runway} months. Consider reviewing burn and priorities.",
                "priority": "urgent",
                "agent_name": "CFO Agent",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "action_url": "/",
            }
        )

    priority_rank = {"urgent": 0, "normal": 1}
    return sorted(items, key=lambda item: (priority_rank.get(item["priority"], 1), item.get("created_at") or ""))


def _recent_artifacts_from_logs(cutoff: datetime) -> list[dict]:
    artifacts = []
    for event in reversed(list(ws_manager.log_buffer)):
        timestamp = event.get("timestamp")
        try:
            created = datetime.fromisoformat(timestamp).replace(tzinfo=None) if timestamp else datetime.utcnow()
        except ValueError:
            created = datetime.utcnow()
        if created < cutoff:
            continue
        event_type = event.get("type", "")
        tool_name = event.get("tool", "")
        output = str(event.get("output") or event.get("response") or event.get("title") or "")
        artifact_type = None
        if "pull_request" in tool_name or "PR" in output:
            artifact_type = "github_pr"
        elif "email" in tool_name or "Email sent" in output:
            artifact_type = "email"
        elif "report" in output.lower():
            artifact_type = "report"
        elif "document" in output.lower():
            artifact_type = "document"
        elif event_type in {"artifact_created", "github_pr_opened", "email_sent"}:
            artifact_type = event_type.replace("_opened", "").replace("_sent", "")
        if not artifact_type:
            continue
        artifacts.append(
            {
                "type": artifact_type,
                "title": event.get("title") or output[:90] or "Artifact produced",
                "agent_name": event.get("agent") or event.get("agent_name") or "Agent",
                "created_at": timestamp,
                "url": event.get("url") or event.get("action_url"),
            }
        )
    return artifacts[:20]


async def _recent_artifacts(org_id: str) -> list[dict]:
    cutoff = datetime.utcnow() - timedelta(days=7)
    artifacts = _recent_artifacts_from_logs(cutoff)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Execution, Workflow.name)
            .join(Workflow, Execution.workflow_id == Workflow.id)
            .where(Execution.status == ExecutionStatus.completed, Execution.completed_at >= cutoff, Execution.org_id == org_id)
            .order_by(Execution.completed_at.desc())
            .limit(max(0, 20 - len(artifacts)))
        )
    for execution, workflow_name in result.all():
        artifacts.append(
            {
                "type": "report",
                "title": workflow_name,
                "agent_name": "Workflow",
                "created_at": _iso(execution.completed_at),
                "url": f"/chat/{execution.workflow_id}",
            }
        )
    return artifacts[:20]


async def _notification_count(user_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        unread = await db.scalar(
            select(func.count(InAppNotification.id)).where(
                InAppNotification.user_id == user_id,
                InAppNotification.is_read == False,  # noqa: E712
            )
        )
    return {"unread": unread or 0}


@router.get("/summary")
async def get_dashboard_summary(
    request: Request,
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    cache = getattr(request.app.state, "dashboard_summary_cache", None)
    if cache is None:
        cache = {}
        request.app.state.dashboard_summary_cache = cache

    cache_key = f"{current_user.id}:{ctx.org.id}"
    now = datetime.now(timezone.utc)
    cached = cache.get(cache_key)
    if cached and (now - cached["timestamp"]).total_seconds() < 10:
        return cached["data"]

    profile, this_week, team_status, recent_artifacts, notification_count, pending_attention = await asyncio.gather(
        _company_profile(current_user.id, ctx.org.id),
        _this_week(ctx.org.id),
        _team_status(ctx.org.id),
        _recent_artifacts(ctx.org.id),
        _notification_count(current_user.id),
        _pending_attention(current_user.id, ctx.org.id),
    )
    data = {
        "company_profile": profile,
        "this_week": this_week,
        "team_status": team_status,
        "pending_attention": pending_attention,
        "recent_artifacts": recent_artifacts,
        "notifications": notification_count,
    }
    cache[cache_key] = {"timestamp": now, "data": data}
    return data

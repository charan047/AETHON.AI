from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
import uvicorn

from api.executions import enqueue_workflow_execution, run_workflow_background
from config import settings
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    AgentApprovalRequest,
    AgentTrustScore,
    Client,
    ClientStatus,
    Execution,
    ExecutionStatus,
    Organization,
    Workflow,
)
from services.agent_messenger import agent_messenger

try:
    from mcp.server.fastmcp import FastMCP
except Exception:  # pragma: no cover - exercised only when MCP deps are missing
    class FastMCP:  # type: ignore[override]
        def __init__(self, *args, **kwargs):
            self._tools: dict[str, Any] = {}

        def tool(self, *args, **kwargs):
            def decorator(fn):
                self._tools[fn.__name__] = fn
                return fn

            if args and callable(args[0]):
                return decorator(args[0])
            return decorator

        def run(self, *args, **kwargs):
            raise RuntimeError("Install mcp>=1.6.0 and fastmcp>=2.3.0 to run the MCP server.")


logger = logging.getLogger(__name__)


class MCPToolError(RuntimeError):
    """Friendly tool-level validation error."""


def _portal_url(token: str | None) -> str | None:
    if not token:
        return None
    base_url = next((origin.rstrip("/") for origin in settings.cors_origins if origin.startswith("http")), "")
    if not base_url:
        return f"/portal/{token}"
    return f"{base_url}/portal/{token}"


def _workflow_contains_agent(workflow: Workflow, agent_id: str) -> bool:
    for node in (workflow.nodes or []) or []:
        data = (node or {}).get("data", {}) or {}
        if data.get("agent_id") == agent_id:
            return True
        if agent_id in (data.get("agent_ids") or node.get("agent_ids") or []):
            return True
    return False


def _workflow_agent_ids(workflow: Workflow) -> list[str]:
    agent_ids: list[str] = []
    seen: set[str] = set()
    for node in (workflow.nodes or []) or []:
        data = (node or {}).get("data", {}) or {}
        single = data.get("agent_id")
        if isinstance(single, str) and single and single not in seen:
            seen.add(single)
            agent_ids.append(single)
        for candidate in (data.get("agent_ids") or node.get("agent_ids") or []):
            if isinstance(candidate, str) and candidate and candidate not in seen:
                seen.add(candidate)
                agent_ids.append(candidate)
    return agent_ids


async def _require_org(org_id: str, db: AsyncSession) -> Organization:
    org = await db.scalar(select(Organization).where(Organization.id == org_id, Organization.is_active.is_(True)))
    if not org:
        raise MCPToolError(f"Organization '{org_id}' was not found.")
    return org


async def _find_agent(org_id: str, agent_name: str, db: AsyncSession) -> Agent:
    await _require_org(org_id, db)
    needle = (agent_name or "").strip().lower()
    if not needle:
        raise MCPToolError("agent_name is required.")

    rows = (
        await db.execute(
            select(Agent).where(
                Agent.org_id == org_id,
                Agent.is_active.is_(True),
            )
        )
    ).scalars().all()

    for agent in rows:
        names = [agent.name or "", agent.persona_name or ""]
        if any(needle == value.strip().lower() for value in names if value):
            return agent
    for agent in rows:
        names = [agent.name or "", agent.persona_name or ""]
        if any(needle in value.strip().lower() for value in names if value):
            return agent

    raise MCPToolError(f"Agent '{agent_name}' was not found in this organization.")


async def _find_agent_workflow(org_id: str, agent_id: str, db: AsyncSession) -> Workflow:
    workflows = (
        await db.execute(
            select(Workflow)
            .where(Workflow.org_id == org_id)
            .order_by(Workflow.updated_at.desc().nullslast(), Workflow.created_at.desc())
        )
    ).scalars().all()
    for workflow in workflows:
        if _workflow_contains_agent(workflow, agent_id):
            return workflow
    raise MCPToolError("No workflow is linked to this agent yet.")


def _normalize_agent(agent: Agent, trust_score: float | None = None) -> dict[str, Any]:
    return {
        "id": agent.id,
        "name": agent.name,
        "persona_name": agent.persona_name,
        "display_name": agent.persona_name or agent.name,
        "role": agent.role,
        "role_slug": agent.role_slug,
        "status": agent.current_status or "idle",
        "trust_score": round(float(trust_score if trust_score is not None else (agent.trust_score or 0.0)), 1),
        "autonomy_level": agent.autonomy_level,
        "current_task": agent.current_task_summary,
        "client_id": agent.client_id,
    }


async def get_agency_status_impl(org_id: str, db: AsyncSession) -> dict[str, Any]:
    org = await _require_org(org_id, db)
    agents = (
        await db.execute(
            select(Agent, AgentTrustScore.overall_score)
            .outerjoin(AgentTrustScore, AgentTrustScore.agent_id == Agent.id)
            .where(Agent.org_id == org_id, Agent.is_active.is_(True))
            .order_by(Agent.created_at.asc())
        )
    ).all()
    approvals = (
        await db.execute(
            select(AgentApprovalRequest, Agent.name, Agent.persona_name)
            .join(Agent, Agent.id == AgentApprovalRequest.requesting_agent_id)
            .where(
                AgentApprovalRequest.org_id == org_id,
                AgentApprovalRequest.status == "pending",
            )
            .order_by(AgentApprovalRequest.created_at.desc())
        )
    ).all()

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    tasks_today = await db.scalar(
        select(func.count(Execution.id)).where(
            Execution.org_id == org_id,
            Execution.started_at >= today_start,
        )
    ) or 0

    trust_scores = [
        {
            "agent_id": agent.id,
            "agent_name": agent.persona_name or agent.name,
            "overall_score": round(float(score or agent.trust_score or 0.0), 1),
            "autonomy_level": agent.autonomy_level,
        }
        for agent, score in agents
    ]

    agent_list = [_normalize_agent(agent, score) for agent, score in agents]
    return {
        "org": {"id": org.id, "name": org.name, "plan": org.plan},
        "agents": {
            "total": len(agent_list),
            "working": sum(1 for agent in agent_list if agent["status"] == "working"),
            "idle": sum(1 for agent in agent_list if agent["status"] != "working"),
            "list": agent_list,
        },
        "approvals": {
            "pending": len(approvals),
            "list": [
                {
                    "id": approval.id,
                    "title": approval.title,
                    "risk_level": approval.risk_level,
                    "agent_name": persona_name or agent_name or "Agent",
                    "ai_recommendation": approval.ai_recommendation,
                    "created_at": approval.created_at.isoformat() if approval.created_at else None,
                }
                for approval, agent_name, persona_name in approvals
            ],
        },
        "tasks_today": int(tasks_today),
        "trust_scores": trust_scores,
        "checked_at": datetime.utcnow().isoformat(),
    }


async def list_agents_impl(org_id: str, db: AsyncSession) -> dict[str, Any]:
    await _require_org(org_id, db)
    rows = (
        await db.execute(
            select(Agent, AgentTrustScore.overall_score)
            .outerjoin(AgentTrustScore, AgentTrustScore.agent_id == Agent.id)
            .where(Agent.org_id == org_id, Agent.is_active.is_(True))
            .order_by(Agent.created_at.asc())
        )
    ).all()
    agents = [_normalize_agent(agent, score) for agent, score in rows]
    return {"count": len(agents), "agents": agents}


async def run_agent_task_impl(org_id: str, agent_name: str, task: str, db: AsyncSession) -> dict[str, Any]:
    if not task or not task.strip():
        raise MCPToolError("task is required.")

    org = await _require_org(org_id, db)
    agent = await _find_agent(org_id, agent_name, db)
    workflow = await _find_agent_workflow(org_id, agent.id, db)

    execution = Execution(
        id=str(uuid4()),
        org_id=org_id,
        workflow_id=workflow.id,
        client_id=agent.client_id,
        trigger="manual",
        status=ExecutionStatus.pending,
        input_message=task.strip(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    dispatch: str
    try:
        dispatch = await enqueue_workflow_execution(
            execution.id,
            workflow.id,
            task.strip(),
            org.owner_user_id,
            org_id,
        )
    except RuntimeError:
        await db.refresh(execution)
        dispatch = "local_task"
        execution.status = ExecutionStatus.running
        await db.commit()
        asyncio_task = run_workflow_background(
            execution.id,
            workflow.id,
            task.strip(),
            org.owner_user_id,
            org_id,
        )
        import asyncio

        asyncio.create_task(asyncio_task)

    return {
        "execution_id": execution.id,
        "workflow_id": workflow.id,
        "agent": _normalize_agent(agent),
        "dispatch": dispatch,
        "status": execution.status.value if hasattr(execution.status, "value") else execution.status,
        "monitor_url": "/monitoring",
    }


async def get_pending_approvals_impl(org_id: str, db: AsyncSession) -> dict[str, Any]:
    await _require_org(org_id, db)
    rows = (
        await db.execute(
            select(AgentApprovalRequest, Agent.name, Agent.persona_name)
            .join(Agent, Agent.id == AgentApprovalRequest.requesting_agent_id)
            .where(
                AgentApprovalRequest.org_id == org_id,
                AgentApprovalRequest.status == "pending",
            )
            .order_by(AgentApprovalRequest.created_at.desc())
        )
    ).all()
    approvals = [
        {
            "id": approval.id,
            "agent_id": approval.requesting_agent_id,
            "agent_name": persona_name or agent_name or "Agent",
            "title": approval.title,
            "description": approval.description,
            "risk_level": approval.risk_level,
            "ai_recommendation": approval.ai_recommendation,
            "ai_analysis": approval.ai_analysis,
            "created_at": approval.created_at.isoformat() if approval.created_at else None,
        }
        for approval, agent_name, persona_name in rows
    ]
    return {"pending_count": len(approvals), "approvals": approvals}


async def approve_request_impl(org_id: str, approval_id: str, note: str, db: AsyncSession) -> dict[str, Any]:
    await _require_org(org_id, db)
    if not note or not note.strip():
        raise MCPToolError("Approval note is required.")

    approval = await db.scalar(
        select(AgentApprovalRequest).where(
            AgentApprovalRequest.id == approval_id,
            AgentApprovalRequest.org_id == org_id,
        )
    )
    if not approval:
        raise MCPToolError(f"Approval '{approval_id}' was not found.")
    if approval.status != "pending":
        raise MCPToolError("Approval is no longer pending.")

    approval.status = "approved"
    approval.decision_note = note.strip()
    approval.decided_at = datetime.utcnow()
    await db.commit()
    await db.refresh(approval)
    return {
        "id": approval.id,
        "status": approval.status,
        "note": approval.decision_note,
        "updated_at": approval.decided_at.isoformat() if approval.decided_at else None,
    }


async def reject_request_impl(org_id: str, approval_id: str, note: str, db: AsyncSession) -> dict[str, Any]:
    await _require_org(org_id, db)
    if not note or not note.strip():
        raise MCPToolError("Rejection note is required.")

    approval = await db.scalar(
        select(AgentApprovalRequest).where(
            AgentApprovalRequest.id == approval_id,
            AgentApprovalRequest.org_id == org_id,
        )
    )
    if not approval:
        raise MCPToolError(f"Approval '{approval_id}' was not found.")
    if approval.status != "pending":
        raise MCPToolError("Approval is no longer pending.")

    approval.status = "rejected"
    approval.decision_note = note.strip()
    approval.decided_at = datetime.utcnow()
    await db.commit()
    await db.refresh(approval)
    return {
        "id": approval.id,
        "status": approval.status,
        "note": approval.decision_note,
        "updated_at": approval.decided_at.isoformat() if approval.decided_at else None,
    }


async def get_client_activity_impl(
    org_id: str,
    client_name: str | None,
    days: int,
    db: AsyncSession,
) -> dict[str, Any]:
    await _require_org(org_id, db)
    since = datetime.utcnow() - timedelta(days=max(days, 1))

    query = select(Client).where(Client.org_id == org_id)
    if client_name and client_name.strip():
        pattern = f"%{client_name.strip().lower()}%"
        query = query.where(func.lower(Client.name).like(pattern))
    clients = (await db.execute(query.order_by(Client.created_at.asc()))).scalars().all()

    results: list[dict[str, Any]] = []
    for client in clients:
        executions = (
            await db.execute(
                select(Execution).where(
                    Execution.org_id == org_id,
                    Execution.client_id == client.id,
                    Execution.started_at >= since,
                )
            )
        ).scalars().all()
        if client_name and not executions:
            continue

        last_activity = max((execution.started_at for execution in executions), default=None)
        results.append(
            {
                "id": client.id,
                "name": client.name,
                "company_name": client.company_name,
                "status": client.status.value if hasattr(client.status, "value") else client.status,
                "executions": len(executions),
                "completed": sum(1 for execution in executions if execution.status == ExecutionStatus.completed),
                "failed": sum(1 for execution in executions if execution.status == ExecutionStatus.failed),
                "last_activity": last_activity.isoformat() if last_activity else None,
                "portal_url": _portal_url(client.portal_token) if client.portal_enabled else None,
            }
        )

    results.sort(key=lambda item: item["last_activity"] or "", reverse=True)
    return {"days": max(days, 1), "clients": results}


async def list_clients_impl(org_id: str, db: AsyncSession) -> dict[str, Any]:
    await _require_org(org_id, db)
    rows = (
        await db.execute(
            select(Client).where(
                Client.org_id == org_id,
                Client.status == ClientStatus.active,
            ).order_by(Client.created_at.asc())
        )
    ).scalars().all()
    clients = [
        {
            "id": client.id,
            "name": client.name,
            "company_name": client.company_name,
            "service_type": client.service_type,
            "portal_enabled": bool(client.portal_enabled),
            "portal_url": _portal_url(client.portal_token) if client.portal_enabled else None,
            "contact_email": client.contact_email,
            "color": client.color,
        }
        for client in rows
    ]
    return {"count": len(clients), "clients": clients}


async def get_analytics_summary_impl(org_id: str, period: str, db: AsyncSession) -> dict[str, Any]:
    await _require_org(org_id, db)
    window_map = {"today": 1, "week": 7, "month": 30}
    if period not in window_map:
        raise MCPToolError("period must be one of: today, week, month.")
    since = datetime.utcnow() - timedelta(days=window_map[period])

    executions = (
        await db.execute(
            select(Execution).where(
                Execution.org_id == org_id,
                Execution.started_at >= since,
            )
        )
    ).scalars().all()

    success_count = sum(1 for execution in executions if execution.status == ExecutionStatus.completed)
    failed_count = sum(1 for execution in executions if execution.status == ExecutionStatus.failed)
    success_rate = round((success_count / len(executions) * 100.0), 1) if executions else 0.0

    workflow_ids = {execution.workflow_id for execution in executions if execution.workflow_id}
    workflows = (
        await db.execute(
            select(Workflow).where(Workflow.id.in_(workflow_ids))
        )
    ).scalars().all() if workflow_ids else []
    workflow_by_id = {workflow.id: workflow for workflow in workflows}

    agent_counts: dict[str, int] = defaultdict(int)
    for execution in executions:
        workflow = workflow_by_id.get(execution.workflow_id)
        if not workflow:
            continue
        for agent_id in _workflow_agent_ids(workflow):
            agent_counts[agent_id] += 1

    agents = (
        await db.execute(
            select(Agent).where(Agent.id.in_(list(agent_counts.keys())))
        )
    ).scalars().all() if agent_counts else []
    agent_by_id = {agent.id: agent for agent in agents}
    top_agents = [
        {
            "agent_id": agent_id,
            "agent_name": (agent_by_id.get(agent_id).persona_name or agent_by_id.get(agent_id).name) if agent_by_id.get(agent_id) else "Unknown",
            "runs": count,
        }
        for agent_id, count in sorted(agent_counts.items(), key=lambda item: item[1], reverse=True)[:5]
    ]

    return {
        "period": period,
        "executions": len(executions),
        "success_rate": success_rate,
        "completed": success_count,
        "failed": failed_count,
        "top_agents": top_agents,
    }


async def message_agent_impl(org_id: str, agent_name: str, message: str, db: AsyncSession) -> dict[str, Any]:
    org = await _require_org(org_id, db)
    agent = await _find_agent(org_id, agent_name, db)
    if not message or not message.strip():
        raise MCPToolError("message is required.")

    ceo_message = await agent_messenger.send_from_ceo(
        to_agent_id=agent.id,
        message=message.strip(),
        org_id=org.id,
        context={"user_id": org.owner_user_id},
        message_type="question",
        db=db,
    )
    if not ceo_message:
        raise MCPToolError("Could not send the message to the agent.")

    return {
        "agent": _normalize_agent(agent),
        "thread_id": ceo_message.thread_id,
        "message_id": ceo_message.id,
        "response_preview": ceo_message.response,
        "messages_url": "/messages",
    }


mcp = FastMCP(
    "Aethon Agency OS",
    instructions=(
        "Use these tools to inspect, govern, and operate an Aethon agency. "
        "Always pass the org_id for the workspace you want to manage."
    ),
    streamable_http_path="/mcp",
)


def _tool_error_payload(exc: Exception) -> dict[str, str]:
    return {"error": str(exc)}


@mcp.tool()
async def get_agency_status(org_id: str) -> dict[str, Any]:
    """Return a full agency snapshot: agents, approvals, tasks today, and trust scores."""
    async with AsyncSessionLocal() as db:
        try:
            return await get_agency_status_impl(org_id, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def list_agents(org_id: str) -> dict[str, Any]:
    """List every active agent with status, trust, autonomy, and current task."""
    async with AsyncSessionLocal() as db:
        try:
            return await list_agents_impl(org_id, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def run_agent_task(org_id: str, agent_name: str, task: str) -> dict[str, Any]:
    """Find an agent's workflow, enqueue a real execution, and return its execution id."""
    async with AsyncSessionLocal() as db:
        try:
            return await run_agent_task_impl(org_id, agent_name, task, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def get_pending_approvals(org_id: str) -> dict[str, Any]:
    """Return all pending agent approval requests with risk and AI recommendation."""
    async with AsyncSessionLocal() as db:
        try:
            return await get_pending_approvals_impl(org_id, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def approve_request(org_id: str, approval_id: str, note: str = "") -> dict[str, Any]:
    """Approve a pending agent approval request. A note is required."""
    async with AsyncSessionLocal() as db:
        try:
            return await approve_request_impl(org_id, approval_id, note, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def reject_request(org_id: str, approval_id: str, note: str) -> dict[str, Any]:
    """Reject a pending agent approval request. A rejection note is required."""
    async with AsyncSessionLocal() as db:
        try:
            return await reject_request_impl(org_id, approval_id, note, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def get_client_activity(org_id: str, client_name: str | None = None, days: int = 7) -> dict[str, Any]:
    """Return recent execution activity for clients, optionally filtered by client name."""
    async with AsyncSessionLocal() as db:
        try:
            return await get_client_activity_impl(org_id, client_name, days, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def list_clients(org_id: str) -> dict[str, Any]:
    """List active clients and their portal URLs."""
    async with AsyncSessionLocal() as db:
        try:
            return await list_clients_impl(org_id, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def get_analytics_summary(org_id: str, period: str = "week") -> dict[str, Any]:
    """Return execution volume, success rate, and top agents for the selected period."""
    async with AsyncSessionLocal() as db:
        try:
            return await get_analytics_summary_impl(org_id, period, db)
        except Exception as exc:
            return _tool_error_payload(exc)


@mcp.tool()
async def message_agent(org_id: str, agent_name: str, message: str) -> dict[str, Any]:
    """Send a direct message to an agent. The reply also appears in the in-app messages view."""
    async with AsyncSessionLocal() as db:
        try:
            return await message_agent_impl(org_id, agent_name, message, db)
        except Exception as exc:
            return _tool_error_payload(exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Aethon MCP server.")
    parser.add_argument(
        "--transport",
        choices=("stdio", "http"),
        default="stdio",
        help="stdio for desktop clients, http for remote IDE integrations",
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8888)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    transport = "stdio" if args.transport == "stdio" else "streamable-http"
    logger.info("Starting Aethon MCP server via %s transport", transport)
    if transport == "stdio":
        mcp.run(transport="stdio")
        return
    uvicorn.run(mcp.streamable_http_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()

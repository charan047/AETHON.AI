from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import Query
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from services.websocket_manager import ws_manager
from database import get_db
from database.models import Agent, Workflow, Execution, OrgMember
from auth.security import decode_token

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    org_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError()
    except Exception:
        await websocket.close(code=4001)
        return
    membership = await db.scalar(
        select(OrgMember.org_id).where(
            OrgMember.user_id == str(payload.get("sub")),
            OrgMember.org_id == org_id,
        )
    )
    if not membership:
        await websocket.close(code=4003)
        return
    initial_logs = await ws_manager.get_recent_logs_for_org(org_id) if org_id else None
    await ws_manager.connect(websocket, org_id=org_id, initial_logs=initial_logs)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
                continue

            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                continue

            action = message.get("action")
            channel = str(message.get("channel", "") or "").strip()

            if action == "subscribe" and channel:
                if channel.startswith("execution:"):
                    execution_id = channel.split(":", 1)[1]
                    execution_org = await db.scalar(
                        select(Execution.org_id).where(Execution.id == execution_id)
                    )
                    if execution_org != org_id:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "event": "subscription_denied",
                                    "channel": channel,
                                }
                            )
                        )
                        continue
                await ws_manager.subscribe_to_channel(websocket, channel)
                await websocket.send_text(
                    json.dumps(
                        {
                            "event": "subscribed",
                            "channel": channel,
                        }
                    )
                )
            elif action == "unsubscribe" and channel:
                await ws_manager.unsubscribe_from_channel(websocket, channel)
                await websocket.send_text(
                    json.dumps(
                        {
                            "event": "unsubscribed",
                            "channel": channel,
                        }
                    )
                )
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)


@router.get("/stats")
async def get_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    agents_count = await db.scalar(select(func.count(Agent.id)).where(Agent.org_id == ctx.org.id))
    workflows_count = await db.scalar(select(func.count(Workflow.id)).where(Workflow.org_id == ctx.org.id))
    executions_count = await db.scalar(select(func.count(Execution.id)).where(Execution.org_id == ctx.org.id))
    active_executions = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == "running", Execution.org_id == ctx.org.id)
    )
    total_tokens = await db.scalar(select(func.sum(Execution.token_count)).where(Execution.org_id == ctx.org.id)) or 0
    total_cost = await db.scalar(select(func.sum(Execution.cost)).where(Execution.org_id == ctx.org.id)) or 0.0

    completed = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == "completed", Execution.org_id == ctx.org.id)
    ) or 0
    failed = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == "failed", Execution.org_id == ctx.org.id)
    ) or 0
    success_rate = round(completed / max(completed + failed, 1) * 100, 1)

    return {
        "agents": agents_count,
        "workflows": workflows_count,
        "executions": executions_count,
        "active_executions": active_executions,
        "total_tokens": total_tokens,
        "total_cost": round(total_cost, 4),
        "success_rate": success_rate,
        "ws_connections": sum(1 for org_id in ws_manager.connection_orgs.values() if org_id == ctx.org.id),
    }


@router.get("/recent-executions")
async def recent_executions(
    limit: int = 10,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(Execution, Workflow.name, Workflow.nodes)
        .outerjoin(Workflow, Workflow.id == Execution.workflow_id)
        .where(Execution.org_id == ctx.org.id)
        .order_by(Execution.started_at.desc())
        .limit(limit)
    )
    rows = result.all()
    workflow_agent_ids = {}
    agent_ids = set()
    for execution, workflow_name, workflow_nodes in rows:
        agent_id = None
        if isinstance(workflow_nodes, list):
            for node in workflow_nodes:
                data = node.get("data", {}) if isinstance(node, dict) else {}
                candidate = data.get("agent_id")
                if candidate:
                    agent_id = str(candidate)
                    break
        if agent_id:
            workflow_agent_ids[execution.id] = agent_id
            agent_ids.add(agent_id)

    agent_name_map = {}
    if agent_ids:
        agent_result = await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids)))
        agent_name_map = {agent_id: agent_name for agent_id, agent_name in agent_result.all()}

    out = []
    for e, workflow_name, _workflow_nodes in rows:
        duration_seconds = None
        if e.started_at and e.completed_at:
            duration_seconds = max(int((e.completed_at - e.started_at).total_seconds()), 0)
        out.append({
            "id": e.id,
            "workflow_id": e.workflow_id,
            "workflow_name": workflow_name or "Unknown",
            "agent_name": agent_name_map.get(workflow_agent_ids.get(e.id), "Workflow"),
            "status": e.status,
            "trigger": e.trigger,
            "started_at": e.started_at.isoformat(),
            "completed_at": e.completed_at.isoformat() if e.completed_at else None,
            "duration_seconds": duration_seconds,
            "token_count": e.token_count,
            "cost": e.cost,
        })
    return out


@router.get("/logs")
async def get_buffered_logs(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    return await ws_manager.get_recent_logs_for_org(ctx.org.id)

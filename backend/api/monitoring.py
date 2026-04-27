from auth.dependencies import get_current_user, require_editor, require_admin
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from services.websocket_manager import ws_manager
from database import get_db
from database.models import Agent, Workflow, Execution
from auth.security import decode_token

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError()
    except Exception:
        await websocket.close(code=4001)
        return
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo ping/pong
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    agents_count = await db.scalar(select(func.count(Agent.id)))
    workflows_count = await db.scalar(select(func.count(Workflow.id)))
    executions_count = await db.scalar(select(func.count(Execution.id)))
    active_executions = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == "running")
    )
    total_tokens = await db.scalar(select(func.sum(Execution.token_count))) or 0
    total_cost = await db.scalar(select(func.sum(Execution.cost))) or 0.0

    completed = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == "completed")
    ) or 0
    failed = await db.scalar(
        select(func.count(Execution.id)).where(Execution.status == "failed")
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
        "ws_connections": len(ws_manager.active_connections),
    }


@router.get("/recent-executions")
async def recent_executions(limit: int = 10, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Execution).order_by(Execution.started_at.desc()).limit(limit)
    )
    execs = result.scalars().all()
    out = []
    for e in execs:
        wf_result = await db.execute(select(Workflow).where(Workflow.id == e.workflow_id))
        wf = wf_result.scalar_one_or_none()
        out.append({
            "id": e.id,
            "workflow_id": e.workflow_id,
            "workflow_name": wf.name if wf else "Unknown",
            "status": e.status,
            "trigger": e.trigger,
            "started_at": e.started_at.isoformat(),
            "completed_at": e.completed_at.isoformat() if e.completed_at else None,
            "token_count": e.token_count,
            "cost": e.cost,
        })
    return out


@router.get("/logs")
async def get_buffered_logs():
    return list(ws_manager.log_buffer)

"""
Direct Messaging API — production-grade CEO ↔ Agent + Agent ↔ Agent messaging.
All endpoints are org-scoped. Multi-tenant safe.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database.db import get_db
from database.models import Agent, AgentMessage, Organization, User

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])

# ---------------------------------------------------------------------------
# Role colour helpers (matches frontend palette)
# ---------------------------------------------------------------------------
_ROLE_COLORS = [
    "#A78BFA", "#60A5FA", "#34D399", "#F59E0B",
    "#F87171", "#38BDF8", "#A3E635", "#FB923C",
]


def _role_color(role_slug: str | None, agent_id: str) -> str:
    seed = (role_slug or agent_id or "")
    idx = sum(ord(c) for c in seed) % len(_ROLE_COLORS)
    return _ROLE_COLORS[idx]


def _stable_thread_id(org_id: str, agent_id: str) -> str:
    """CEO↔agent threads use a stable deterministic ID so they never fork."""
    return f"dm-{org_id[:8]}-{agent_id[:8]}"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SendMessageRequest(BaseModel):
    to_agent_id: str
    content: str = Field(..., min_length=1, max_length=10_000)
    message_type: str = "general"
    priority: str = "normal"
    schedule_reply_in_minutes: Optional[int] = Field(None, ge=1, le=10_080)


class RetentionRequest(BaseModel):
    retention_days: Optional[int] = Field(None, ge=1, le=365)


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _serialize_message(msg: AgentMessage, agent: Agent | None = None) -> dict:
    sender_type = msg.sender_type or ("ceo" if msg.from_agent_id is None else "agent")
    if sender_type == "ceo":
        sender_name = "You"
    else:
        sender_name = (agent.persona_name or agent.name) if agent else "Agent"

    return {
        "id": msg.id,
        "content": msg.message,
        "sender_type": sender_type,
        "sender_name": sender_name,
        "message_type": msg.message_type,
        "priority": msg.priority,
        "is_resolved": msg.is_resolved,
        "read_at": msg.read_at.isoformat() if msg.read_at else None,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "scheduled_reply_at": msg.scheduled_reply_at.isoformat() if msg.scheduled_reply_at else None,
        "scheduled_reply_job_id": msg.scheduled_reply_job_id,
        "thread_id": msg.thread_id,
        "parent_message_id": msg.parent_message_id,
        "execution_id": msg.execution_id,
        "from_agent_id": msg.from_agent_id,
        "to_agent_id": msg.to_agent_id,
    }


# ---------------------------------------------------------------------------
# ENDPOINT 1 — GET /conversations
# ---------------------------------------------------------------------------

@router.get("/conversations")
async def get_conversations(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """
    Conversation list — one row per agent with last message preview and
    unread count. Single aggregation query, no N+1.
    """
    org_id = ctx.org.id

    agents_result = await db.execute(
        select(Agent).where(Agent.org_id == org_id, Agent.is_active == True)  # noqa: E712
    )
    agents = agents_result.scalars().all()
    if not agents:
        return {"conversations": [], "total_unread": 0}

    agent_ids = [a.id for a in agents]

    # Latest message per agent in their CEO↔agent thread
    subq = (
        select(
            func.coalesce(AgentMessage.from_agent_id, AgentMessage.to_agent_id).label("agent_id"),
            func.max(AgentMessage.created_at).label("latest_at"),
        )
        .where(
            AgentMessage.org_id == org_id,
            or_(
                and_(
                    AgentMessage.from_agent_id.in_(agent_ids),
                    AgentMessage.to_agent_id.is_(None),
                ),
                and_(
                    AgentMessage.to_agent_id.in_(agent_ids),
                    AgentMessage.from_agent_id.is_(None),
                ),
            ),
        )
        .group_by(func.coalesce(AgentMessage.from_agent_id, AgentMessage.to_agent_id))
        .subquery()
    )

    latest_msgs_result = await db.execute(
        select(AgentMessage).join(
            subq,
            and_(
                func.coalesce(AgentMessage.from_agent_id, AgentMessage.to_agent_id) == subq.c.agent_id,
                AgentMessage.created_at == subq.c.latest_at,
                AgentMessage.org_id == org_id,
            ),
        )
    )
    latest_by_agent: dict[str, AgentMessage] = {}
    for msg in latest_msgs_result.scalars().all():
        aid = msg.from_agent_id or msg.to_agent_id
        if aid:
            latest_by_agent[aid] = msg

    # Unread count per agent (messages FROM agent, not yet read by CEO)
    unread_result = await db.execute(
        select(
            AgentMessage.from_agent_id,
            func.count(AgentMessage.id).label("cnt"),
        )
        .where(
            AgentMessage.org_id == org_id,
            AgentMessage.from_agent_id.in_(agent_ids),
            AgentMessage.to_agent_id.is_(None),
            AgentMessage.read_at.is_(None),
            AgentMessage.is_resolved == False,  # noqa: E712
        )
        .group_by(AgentMessage.from_agent_id)
    )
    unread_by_agent: dict[str, int] = {row[0]: row[1] for row in unread_result}

    conversations = []
    for agent in agents:
        last_msg = latest_by_agent.get(agent.id)
        conversations.append({
            "agent_id": agent.id,
            "agent_name": agent.name,
            "persona_name": agent.persona_name,
            "role_slug": agent.role_slug,
            "role_color": _role_color(agent.role_slug, agent.id),
            "last_message": last_msg.message[:160] if last_msg else None,
            "last_message_at": last_msg.created_at.isoformat() if last_msg and last_msg.created_at else None,
            "last_sender_type": last_msg.sender_type if last_msg else None,
            "unread_count": unread_by_agent.get(agent.id, 0),
            "is_online": agent.current_status == "working",
            "current_status": agent.current_status,
        })

    with_msgs = sorted(
        [c for c in conversations if c["last_message_at"]],
        key=lambda c: c["last_message_at"],
        reverse=True,
    )
    without_msgs = sorted(
        [c for c in conversations if not c["last_message_at"]],
        key=lambda c: c["agent_name"],
    )
    conversations = with_msgs + without_msgs

    total_unread = sum(c["unread_count"] for c in conversations)
    return {"conversations": conversations, "total_unread": total_unread}


# ---------------------------------------------------------------------------
# ENDPOINT 2 — GET /thread/{agent_id}
# ---------------------------------------------------------------------------

@router.get("/thread/{agent_id}")
async def get_thread(
    agent_id: str,
    before: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """Full CEO↔agent thread. Auto-marks agent messages as read."""
    org_id = ctx.org.id

    agent = await db.scalar(
        select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id)
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    q = select(AgentMessage).where(
        AgentMessage.org_id == org_id,
        or_(
            and_(AgentMessage.from_agent_id == agent_id, AgentMessage.to_agent_id.is_(None)),
            and_(AgentMessage.to_agent_id == agent_id, AgentMessage.from_agent_id.is_(None)),
        ),
    )
    if before:
        try:
            q = q.where(AgentMessage.created_at < datetime.fromisoformat(before))
        except ValueError:
            pass

    q = q.order_by(AgentMessage.created_at.desc()).limit(limit + 1)
    rows = (await db.execute(q)).scalars().all()

    has_more = len(rows) > limit
    messages = list(reversed(rows[:limit]))
    oldest_at = messages[0].created_at.isoformat() if messages and messages[0].created_at else None

    # Auto-mark as read
    unread_ids = [m.id for m in messages if m.from_agent_id == agent_id and m.read_at is None]
    if unread_ids:
        await db.execute(
            update(AgentMessage).where(AgentMessage.id.in_(unread_ids)).values(read_at=datetime.utcnow())
        )
        await db.commit()

    return {
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "persona_name": agent.persona_name,
            "role_slug": agent.role_slug,
            "role_color": _role_color(agent.role_slug, agent.id),
            "current_status": agent.current_status,
            "current_task_summary": agent.current_task_summary,
            "trust_score": agent.trust_score,
        },
        "messages": [
            _serialize_message(m, agent if m.from_agent_id == agent_id else None)
            for m in messages
        ],
        "has_more": has_more,
        "oldest_at": oldest_at,
    }


# ---------------------------------------------------------------------------
# ENDPOINT 3 — POST /send
# ---------------------------------------------------------------------------

@router.post("/send")
async def send_message(
    body: SendMessageRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """CEO sends a direct message to an agent."""
    org_id = ctx.org.id

    agent = await db.scalar(
        select(Agent).where(
            Agent.id == body.to_agent_id,
            Agent.org_id == org_id,
            Agent.is_active == True,  # noqa: E712
        )
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    thread_id = _stable_thread_id(org_id, body.to_agent_id)

    new_message = AgentMessage(
        id=str(uuid4()),
        org_id=org_id,
        from_agent_id=None,
        to_agent_id=body.to_agent_id,
        sender_type="ceo",
        message=body.content,
        message_type=body.message_type,
        thread_id=thread_id,
        priority=body.priority,
        requires_human=False,
        delivered_at=datetime.utcnow(),
    )
    db.add(new_message)
    await db.flush()

    # Optional scheduled follow-up reply
    if body.schedule_reply_in_minutes:
        fire_at = datetime.utcnow() + timedelta(minutes=body.schedule_reply_in_minutes)
        job_id = f"reply_{new_message.id}"
        try:
            from main import app as _app
            scheduler = getattr(_app.state, "scheduler", None)
            if scheduler and scheduler.scheduler.running:
                from apscheduler.triggers.date import DateTrigger
                from services.agent_reply_service import process_ceo_message as _process
                scheduler.scheduler.add_job(
                    _process,
                    trigger=DateTrigger(run_date=fire_at),
                    kwargs={
                        "message_id": new_message.id,
                        "agent_id": body.to_agent_id,
                        "org_id": org_id,
                        "scheduled": True,
                    },
                    id=job_id,
                    replace_existing=True,
                    misfire_grace_time=300,
                )
                new_message.scheduled_reply_at = fire_at
                new_message.scheduled_reply_job_id = job_id
        except Exception as exc:
            logger.warning("Could not schedule reply job: %s", exc)

    await db.commit()
    await db.refresh(new_message)

    # Broadcast WS event
    try:
        from services.websocket_manager import ws_manager
        await ws_manager.broadcast_to_channel(
            f"org:{org_id}",
            {
                "event": "new_direct_message",
                "thread_agent_id": body.to_agent_id,
                "sender_type": "ceo",
            },
        )
    except Exception as exc:
        logger.warning("WS broadcast failed: %s", exc)

    # Trigger immediate agent reply in background
    from services.agent_reply_service import process_ceo_message
    background_tasks.add_task(
        process_ceo_message,
        message_id=new_message.id,
        agent_id=body.to_agent_id,
        org_id=org_id,
        scheduled=False,
    )

    return _serialize_message(new_message)


# ---------------------------------------------------------------------------
# ENDPOINT 4 — POST /{message_id}/read
# ---------------------------------------------------------------------------

@router.post("/{message_id}/read")
async def mark_read(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    msg = await db.scalar(
        select(AgentMessage).where(AgentMessage.id == message_id, AgentMessage.org_id == ctx.org.id)
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if not msg.read_at:
        await db.execute(
            update(AgentMessage).where(AgentMessage.id == message_id).values(read_at=datetime.utcnow())
        )
        await db.commit()
    return {"read": True, "read_at": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# ENDPOINT 5 — POST /{message_id}/resolve
# ---------------------------------------------------------------------------

@router.post("/{message_id}/resolve")
async def resolve_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    msg = await db.scalar(
        select(AgentMessage).where(AgentMessage.id == message_id, AgentMessage.org_id == ctx.org.id)
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.execute(
        update(AgentMessage)
        .where(AgentMessage.id == message_id)
        .values(is_resolved=True, resolved_at=datetime.utcnow())
    )
    await db.commit()
    return {"resolved": True}


# ---------------------------------------------------------------------------
# ENDPOINT 6 — DELETE /{message_id}/scheduled-reply
# ---------------------------------------------------------------------------

@router.delete("/{message_id}/scheduled-reply")
async def cancel_scheduled_reply(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    msg = await db.scalar(
        select(AgentMessage).where(AgentMessage.id == message_id, AgentMessage.org_id == ctx.org.id)
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.scheduled_reply_job_id:
        try:
            from main import app as _app
            scheduler = getattr(_app.state, "scheduler", None)
            if scheduler and scheduler.scheduler.get_job(msg.scheduled_reply_job_id):
                scheduler.scheduler.remove_job(msg.scheduled_reply_job_id)
        except Exception as exc:
            logger.warning("Could not remove APScheduler job: %s", exc)

    await db.execute(
        update(AgentMessage)
        .where(AgentMessage.id == message_id)
        .values(scheduled_reply_job_id=None, scheduled_reply_at=None)
    )
    await db.commit()
    return {"cancelled": True}


# ---------------------------------------------------------------------------
# ENDPOINT 7 — GET /unread-count
# ---------------------------------------------------------------------------

@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    count = await db.scalar(
        select(func.count(AgentMessage.id)).where(
            AgentMessage.org_id == ctx.org.id,
            AgentMessage.sender_type == "agent",
            AgentMessage.read_at.is_(None),
            AgentMessage.is_resolved == False,  # noqa: E712
        )
    ) or 0
    return {"count": count}


# ---------------------------------------------------------------------------
# ENDPOINT 8 — PUT /retention
# ---------------------------------------------------------------------------

@router.put("/retention")
async def set_retention(
    body: RetentionRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await db.execute(
        update(Organization)
        .where(Organization.id == ctx.org.id)
        .values(agent_message_retention_days=body.retention_days)
    )
    await db.commit()
    org = await db.scalar(select(Organization).where(Organization.id == ctx.org.id))
    return {
        "retention_days": org.agent_message_retention_days if org else body.retention_days,
        "updated": True,
    }


# ---------------------------------------------------------------------------
# ENDPOINT 9 — GET /team-conversations
# ---------------------------------------------------------------------------

@router.get("/team-conversations")
async def get_team_conversations(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    """Recent agent-to-agent messages for CEO transparency (read-only)."""
    org_id = ctx.org.id
    since = datetime.utcnow() - timedelta(hours=24)

    result = await db.execute(
        select(AgentMessage)
        .where(
            AgentMessage.org_id == org_id,
            AgentMessage.from_agent_id.isnot(None),
            AgentMessage.to_agent_id.isnot(None),
            AgentMessage.created_at >= since,
        )
        .order_by(AgentMessage.created_at.desc())
        .limit(limit)
    )
    msgs = result.scalars().all()
    if not msgs:
        return {"conversations": []}

    all_ids = {m.from_agent_id for m in msgs} | {m.to_agent_id for m in msgs}
    agents_result = await db.execute(
        select(Agent).where(Agent.id.in_(all_ids), Agent.org_id == org_id)
    )
    agents_map = {a.id: a for a in agents_result.scalars().all()}

    return {
        "conversations": [
            {
                "from_agent": {
                    "id": m.from_agent_id,
                    "name": agents_map[m.from_agent_id].name if m.from_agent_id in agents_map else "Unknown",
                    "persona_name": agents_map[m.from_agent_id].persona_name if m.from_agent_id in agents_map else None,
                },
                "to_agent": {
                    "id": m.to_agent_id,
                    "name": agents_map[m.to_agent_id].name if m.to_agent_id in agents_map else "Unknown",
                    "persona_name": agents_map[m.to_agent_id].persona_name if m.to_agent_id in agents_map else None,
                },
                "message_type": m.message_type,
                "content_preview": m.message[:200],
                "created_at": m.created_at.isoformat() if m.created_at else None,
                "is_resolved": m.is_resolved,
            }
            for m in msgs
        ]
    }


# ---------------------------------------------------------------------------
# Legacy CEO-inbox endpoints (backward-compat with Phase 9 Task 4)
# ---------------------------------------------------------------------------

@router.get("/ceo-inbox")
async def get_ceo_inbox(
    unread_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.agent_messenger import agent_messenger
    messages = await agent_messenger.get_ceo_inbox(ctx.org.id, unread_only=unread_only, db=db)

    agent_ids = {str(m.from_agent_id) for m in messages if m.from_agent_id}
    agent_ids |= {str(m.to_agent_id) for m in messages if m.to_agent_id}
    agents_map: dict = {}
    if agent_ids:
        r = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        agents_map = {str(a.id): a for a in r.scalars().all()}

    unread_val = await db.scalar(
        select(func.count(AgentMessage.id)).where(
            AgentMessage.org_id == ctx.org.id,
            AgentMessage.requires_human == True,  # noqa: E712
            AgentMessage.is_resolved == False,  # noqa: E712
            AgentMessage.read_at.is_(None),
        )
    ) or 0

    def _enrich(msg: AgentMessage) -> dict:
        fa = agents_map.get(str(msg.from_agent_id)) if msg.from_agent_id else None
        ta = agents_map.get(str(msg.to_agent_id)) if msg.to_agent_id else None
        return {
            "id": msg.id, "org_id": msg.org_id,
            "from_agent_id": msg.from_agent_id, "to_agent_id": msg.to_agent_id,
            "from_agent_name": fa.name if fa else "CEO",
            "from_agent_persona": fa.persona_name if fa else None,
            "to_agent_name": ta.name if ta else "CEO",
            "to_agent_persona": ta.persona_name if ta else None,
            "execution_id": msg.execution_id, "message": msg.message,
            "message_type": msg.message_type, "thread_id": msg.thread_id,
            "parent_message_id": msg.parent_message_id, "is_resolved": msg.is_resolved,
            "resolved_at": msg.resolved_at, "requires_human": msg.requires_human,
            "priority": msg.priority, "read_at": msg.read_at,
            "response": msg.response, "delivered_at": msg.delivered_at,
            "responded_at": msg.responded_at, "created_at": msg.created_at,
        }

    return {
        "unread_count": unread_val,
        "retention_days": ctx.org.agent_message_retention_days,
        "messages": [_enrich(m) for m in messages],
    }


@router.post("/ceo-respond")
async def ceo_respond(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.agent_messenger import agent_messenger
    thread_id = payload.get("thread_id")
    content = payload.get("content", "")
    resolve = payload.get("resolve", False)
    if not thread_id or not content:
        raise HTTPException(status_code=400, detail="thread_id and content required")
    thread_messages = await agent_messenger.get_thread(thread_id, ctx.org.id, db)
    if not thread_messages:
        raise HTTPException(status_code=404, detail="Thread not found")
    target_agent_id = next(
        (str(m.from_agent_id) for m in thread_messages if m.from_agent_id), None
    ) or next((str(m.to_agent_id) for m in thread_messages if m.to_agent_id), None)
    if not target_agent_id:
        raise HTTPException(status_code=400, detail="Could not determine target agent")
    reply = await agent_messenger.send_from_ceo(
        to_agent_id=target_agent_id, message=content, org_id=ctx.org.id,
        context={"user_id": current_user.id}, thread_id=thread_id, message_type="answer", db=db,
    )
    if not reply:
        raise HTTPException(status_code=500, detail="Could not send response")
    if thread_messages:
        await agent_messenger.mark_read(thread_messages[-1].id, db)
    if resolve:
        await agent_messenger.resolve_thread(thread_id, db)
    return {"sent": True, "resolved": resolve, "message_id": reply.id}


@router.post("/ceo-send")
async def ceo_send_legacy(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.agent_messenger import VALID_MESSAGE_TYPES, agent_messenger
    to_agent_id = payload.get("to_agent_id")
    content = payload.get("content", "")
    message_type = payload.get("message_type", "general")
    if not to_agent_id or not content:
        raise HTTPException(status_code=400, detail="to_agent_id and content required")
    target = await db.scalar(
        select(Agent).where(Agent.id == to_agent_id, Agent.org_id == ctx.org.id, Agent.is_active == True)  # noqa: E712
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target agent not found")
    if message_type not in VALID_MESSAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid message type")
    try:
        message = await agent_messenger.send_from_ceo(
            to_agent_id=to_agent_id, message=content, org_id=ctx.org.id,
            context={"user_id": current_user.id}, message_type=message_type, db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not message:
        raise HTTPException(status_code=500, detail="Could not send message")
    return {"sent": True, "thread_id": message.thread_id, "message_id": message.id}

import asyncio
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import Agent, Client, ClientStatus, Execution, ExecutionStatus, Mission, MissionStatus, Organization, User, Workflow

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
portal_router = APIRouter()


class ClientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    company_name: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    service_type: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7)


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    company_name: Optional[str] = None
    contact_email: Optional[str] = None
    description: Optional[str] = None
    service_type: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None


def _status_value(status: ClientStatus | str | None) -> str | None:
    if status is None:
        return None
    return status.value if hasattr(status, "value") else str(status)


def _normalize_status(value: str | None) -> ClientStatus | None:
    if value is None:
        return None
    try:
        return ClientStatus(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid client status") from exc


def _portal_url(token: str) -> str:
    return f"/portal/{token}"


def _workflow_primary_agent_name(workflow: Workflow | None) -> str | None:
    for node in (workflow.nodes if workflow else []) or []:
        data = (node or {}).get("data", {}) or {}
        label = data.get("label")
        if isinstance(label, str) and label.strip():
            return label.strip()
    return workflow.name if workflow else None


def _format_agent_role(agent: Agent | None) -> str | None:
    if not agent:
        return None
    if agent.role:
        return agent.role
    if agent.role_slug:
        return agent.role_slug.replace("_", " ").title()
    return "Agent"


async def _client_or_404(client_id: str, db: AsyncSession, org_id: str) -> Client:
    client = await db.scalar(
        select(Client).where(
            Client.id == client_id,
            Client.org_id == org_id,
        )
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _agent_counts(session_factory: async_sessionmaker[AsyncSession], org_id: str) -> dict[str, int]:
    async with session_factory() as db:
        rows = (
            await db.execute(
                select(Agent.client_id, func.count(Agent.id))
                .where(Agent.org_id == org_id, Agent.client_id.is_not(None))
                .group_by(Agent.client_id)
            )
        ).all()
    return {client_id: int(count or 0) for client_id, count in rows if client_id}


async def _execution_counts_30d(session_factory: async_sessionmaker[AsyncSession], org_id: str) -> dict[str, int]:
    since = datetime.utcnow() - timedelta(days=30)
    async with session_factory() as db:
        rows = (
            await db.execute(
                select(Execution.client_id, func.count(Execution.id))
                .where(
                    Execution.org_id == org_id,
                    Execution.client_id.is_not(None),
                    Execution.started_at >= since,
                )
                .group_by(Execution.client_id)
            )
        ).all()
    return {client_id: int(count or 0) for client_id, count in rows if client_id}


async def _last_activity(session_factory: async_sessionmaker[AsyncSession], org_id: str) -> dict[str, datetime]:
    async with session_factory() as db:
        rows = (
            await db.execute(
                select(Execution.client_id, func.max(Execution.started_at))
                .where(Execution.org_id == org_id, Execution.client_id.is_not(None))
                .group_by(Execution.client_id)
            )
        ).all()
    return {client_id: started_at for client_id, started_at in rows if client_id and started_at}


def _client_list_payload(
    client: Client,
    *,
    agent_count: int = 0,
    execution_count_30d: int = 0,
    last_activity: datetime | None = None,
) -> dict:
    return {
        "id": client.id,
        "name": client.name,
        "company_name": client.company_name,
        "contact_email": client.contact_email,
        "service_type": client.service_type,
        "status": _status_value(client.status),
        "color": client.color,
        "portal_enabled": client.portal_enabled,
        "created_at": client.created_at,
        "agent_count": agent_count,
        "execution_count_30d": execution_count_30d,
        "last_activity": last_activity,
    }


def _client_detail_payload(
    client: Client,
    *,
    agent_count: int = 0,
    execution_count_30d: int = 0,
    last_activity: datetime | None = None,
) -> dict:
    return {
        **_client_list_payload(
            client,
            agent_count=agent_count,
            execution_count_30d=execution_count_30d,
            last_activity=last_activity,
        ),
        "org_id": client.org_id,
        "description": client.description,
        "notes": client.notes,
        "portal_token": client.portal_token,
        "updated_at": client.updated_at,
    }


@router.get("")
async def list_clients(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    clients = (
        await db.execute(
            select(Client)
            .where(Client.org_id == ctx.org.id)
            .order_by(Client.created_at.desc())
        )
    ).scalars().all()

    session_factory = async_sessionmaker(bind=db.bind, expire_on_commit=False)

    agent_counts, execution_counts, last_activity = await asyncio.gather(
        _agent_counts(session_factory, ctx.org.id),
        _execution_counts_30d(session_factory, ctx.org.id),
        _last_activity(session_factory, ctx.org.id),
    )

    return {
        "clients": [
            _client_list_payload(
                client,
                agent_count=agent_counts.get(client.id, 0),
                execution_count_30d=execution_counts.get(client.id, 0),
                last_activity=last_activity.get(client.id),
            )
            for client in clients
        ],
        "total": len(clients),
    }


@router.post("", status_code=201)
async def create_client(
    data: ClientCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = Client(
        org_id=ctx.org.id,
        name=data.name,
        company_name=data.company_name,
        contact_email=data.contact_email,
        description=data.description,
        service_type=data.service_type,
        notes=data.notes,
        color=data.color or "#6366F1",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return _client_detail_payload(client)


@router.get("/{client_id}")
async def get_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await _client_or_404(client_id, db, ctx.org.id)
    session_factory = async_sessionmaker(bind=db.bind, expire_on_commit=False)
    agent_count, execution_counts, last_activity = await asyncio.gather(
        _agent_counts(session_factory, ctx.org.id),
        _execution_counts_30d(session_factory, ctx.org.id),
        _last_activity(session_factory, ctx.org.id),
    )
    return _client_detail_payload(
        client,
        agent_count=agent_count.get(client.id, 0),
        execution_count_30d=execution_counts.get(client.id, 0),
        last_activity=last_activity.get(client.id),
    )


@router.put("/{client_id}")
async def update_client(
    client_id: str,
    data: ClientUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await _client_or_404(client_id, db, ctx.org.id)
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates:
        updates["status"] = _normalize_status(updates["status"])
    for field, value in updates.items():
        setattr(client, field, value)
    client.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return _client_detail_payload(client)


@router.delete("/{client_id}")
async def delete_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await _client_or_404(client_id, db, ctx.org.id)
    client.status = ClientStatus.completed
    client.updated_at = datetime.utcnow()
    await db.execute(
        update(Agent)
        .where(Agent.org_id == ctx.org.id, Agent.client_id == client_id)
        .values(client_id=None, updated_at=datetime.utcnow())
    )
    await db.commit()
    await db.refresh(client)
    return _client_detail_payload(client)


@router.post("/{client_id}/portal/enable")
async def enable_client_portal(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await _client_or_404(client_id, db, ctx.org.id)
    if not client.portal_token:
        client.portal_token = secrets.token_urlsafe(32)
    client.portal_enabled = True
    client.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return {"portal_token": client.portal_token, "portal_url": _portal_url(client.portal_token)}


@router.post("/{client_id}/portal/disable")
async def disable_client_portal(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await _client_or_404(client_id, db, ctx.org.id)
    client.portal_enabled = False
    client.updated_at = datetime.utcnow()
    await db.commit()
    return {"portal_enabled": False}


@router.get("/{client_id}/portal/regenerate-token")
async def regenerate_client_portal_token(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await _client_or_404(client_id, db, ctx.org.id)
    client.portal_token = secrets.token_urlsafe(32)
    client.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(client)
    return {"portal_token": client.portal_token, "portal_url": _portal_url(client.portal_token)}


@router.get("/{client_id}/activity")
async def get_client_activity(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await _client_or_404(client_id, db, ctx.org.id)
    rows = (
        await db.execute(
            select(Execution, Workflow)
            .join(Workflow, Workflow.id == Execution.workflow_id)
            .where(
                Execution.org_id == ctx.org.id,
                Execution.client_id == client_id,
            )
            .order_by(Execution.started_at.desc())
            .limit(20)
        )
    ).all()

    return {
        "activity": [
            {
                "execution_id": execution.id,
                "agent_name": _workflow_primary_agent_name(workflow),
                "status": execution.status.value if hasattr(execution.status, "value") else str(execution.status),
                "input_message_preview": (execution.input_message or "")[:200],
                "started_at": execution.started_at,
            }
            for execution, workflow in rows
        ]
    }


@portal_router.get("/{portal_token}")
async def get_client_portal(
    portal_token: str,
    db: AsyncSession = Depends(get_db),
):
    client = await db.scalar(
        select(Client).where(
            Client.portal_token == portal_token,
            Client.portal_enabled.is_(True),
        )
    )
    if not client:
        raise HTTPException(status_code=404, detail="Portal not found")

    org = await db.scalar(select(Organization).where(Organization.id == client.org_id))
    if not org:
        raise HTTPException(status_code=404, detail="Portal not found")

    recent_rows = (
        await db.execute(
            select(Execution, Workflow)
            .join(Workflow, Workflow.id == Execution.workflow_id)
            .where(
                Execution.org_id == client.org_id,
                Execution.client_id == client.id,
            )
            .order_by(Execution.started_at.desc())
            .limit(10)
        )
    ).all()
    recent_mission_rows = (
        await db.execute(
            select(Mission)
            .where(
                Mission.org_id == client.org_id,
                Mission.client_id == client.id,
                Mission.status == MissionStatus.completed,
            )
            .order_by(Mission.completed_at.desc().nullslast(), Mission.created_at.desc())
            .limit(5)
        )
    ).scalars().all()

    assigned_agents = (
        await db.execute(
            select(Agent)
            .where(
                Agent.org_id == client.org_id,
                Agent.client_id == client.id,
                Agent.is_active.is_(True),
            )
            .order_by(Agent.persona_name.asc().nulls_last(), Agent.name.asc())
        )
    ).scalars().all()

    week_start = datetime.utcnow() - timedelta(days=7)
    executions_this_week = await db.scalar(
        select(func.count(Execution.id)).where(
            Execution.org_id == client.org_id,
            Execution.client_id == client.id,
            Execution.started_at >= week_start,
        )
    )
    completed_this_week = await db.scalar(
        select(func.count(Execution.id)).where(
            Execution.org_id == client.org_id,
            Execution.client_id == client.id,
            Execution.started_at >= week_start,
            Execution.status == ExecutionStatus.completed,
        )
    )
    agents_active = sum(1 for agent in assigned_agents if (agent.current_status or "") == "working")

    last_updated = max(
        [
            *(execution.completed_at or execution.started_at for execution, _workflow in recent_rows if execution.started_at),
            client.updated_at,
            client.created_at,
        ],
        default=None,
    )

    workflow_agent_ids: list[str] = []
    for _execution, workflow in recent_rows:
        for node in (workflow.nodes or []) or []:
            data = (node or {}).get("data", {}) or {}
            agent_id = data.get("agent_id")
            if isinstance(agent_id, str) and agent_id and agent_id not in workflow_agent_ids:
                workflow_agent_ids.append(agent_id)

    workflow_agents = {}
    if workflow_agent_ids:
        workflow_agents = {
            agent.id: agent
            for agent in (
                await db.execute(
                    select(Agent).where(Agent.id.in_(workflow_agent_ids))
                )
            ).scalars().all()
        }

    recent_activity = []
    for execution, workflow in recent_rows:
        agent_name = _workflow_primary_agent_name(workflow)
        agent_role = None
        for node in (workflow.nodes or []) or []:
            data = (node or {}).get("data", {}) or {}
            node_agent_id = data.get("agent_id")
            if isinstance(node_agent_id, str) and node_agent_id in workflow_agents:
                agent = workflow_agents[node_agent_id]
                agent_name = agent.persona_name or agent.name or agent_name
                agent_role = _format_agent_role(agent)
                break

        recent_activity.append(
            {
                "id": execution.id,
                "status": execution.status.value if hasattr(execution.status, "value") else str(execution.status),
                "agent_name": agent_name,
                "agent_role": agent_role,
                "input_preview": (execution.input_message or "")[:200],
                "started_at": execution.started_at,
                "completed_at": execution.completed_at,
                "output_preview": (execution.output_message or execution.error or "")[:200],
            }
        )

    return {
        "client_name": client.company_name or client.name,
        "service_type": client.service_type,
        "agency_name": org.name,
        "portal_enabled": True,
        "color": client.color or "#6366F1",
        "last_updated_at": last_updated,
        "recent_activity": recent_activity,
        "recent_missions": [
            {
                "title": mission.title or mission.goal[:80],
                "completed_at": mission.completed_at,
                "report_preview": mission.report[:300] if mission.report else None,
                "full_report_available": bool(mission.report),
                "report": mission.report,
            }
            for mission in recent_mission_rows
        ],
        "agents": [
            {
                "name": agent.persona_name or agent.name,
                "persona_name": agent.persona_name,
                "role": _format_agent_role(agent),
                "current_status": agent.current_status or "idle",
                "tasks_completed": agent.total_tasks_completed or 0,
            }
            for agent in assigned_agents
        ],
        "stats": {
            "executions_this_week": int(executions_this_week or 0),
            "completed_this_week": int(completed_this_week or 0),
            "agents_active": agents_active,
        },
    }

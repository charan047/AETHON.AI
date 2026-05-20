from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.executions import enqueue_workflow_execution
from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from auth.security import verify_password
from config import settings
from database import get_db
from database.db import AsyncSessionLocal
from database.models import (
    A2ATask,
    A2ATaskDirection,
    A2ATaskStatus,
    Agent,
    AgentContract,
    AgentTrustScore,
    ApiKey,
    AuditAction,
    Execution,
    ExecutionStatus,
    ExternalAgent,
    MissionStatus,
    User,
    Workflow,
)
from services.a2a_client import a2a_client, external_agent_tool_name
from services.integration_crypto import decrypt_value


logger = logging.getLogger(__name__)

router = APIRouter()
internal_router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class ExternalAgentDiscoverRequest(BaseModel):
    agent_card_url: str = Field(..., min_length=1)


class ExternalAgentApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


def _status_value(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value)


_FAILURE_ONLY_PREFIXES = (
    "tool error:",
    "agent communication failed:",
    "in-app notification failed:",
    "email notification failed:",
    "slack notification failed:",
)


def _is_failure_only_output(output_text: str | None) -> bool:
    if not output_text:
        return False
    normalized_lines = [line.strip().lower() for line in output_text.splitlines() if line.strip()]
    if not normalized_lines:
        return False
    return all(
        line.startswith(_FAILURE_ONLY_PREFIXES)
        for line in normalized_lines
    )


def _ensure_a2a_enabled() -> None:
    if not settings.a2a_enabled:
        raise HTTPException(status_code=404, detail="A2A is not enabled")


def _a2a_auth_block() -> dict[str, Any]:
    if settings.a2a_require_api_key:
        return {
            "schemes": ["ApiKey"],
            "credentials": None,
        }
    return {
        "schemes": ["Anonymous"],
        "credentials": None,
    }


async def _resolve_org_scope(requested_org_id: str, db: AsyncSession) -> str:
    if settings.a2a_org_id and settings.a2a_org_id != requested_org_id:
        raise HTTPException(status_code=404, detail="A2A org not exposed")
    return requested_org_id


async def _get_agent(agent_id: str, org_id: str | None, db: AsyncSession) -> Agent | None:
    query = select(Agent).where(Agent.id == agent_id, Agent.is_active == True)  # noqa: E712
    if org_id:
        query = query.where(Agent.org_id == org_id)
    return await db.scalar(query)


async def _get_agent_card_payload(agent: Agent, db: AsyncSession) -> dict[str, Any]:
    contract = await db.scalar(select(AgentContract).where(AgentContract.agent_id == agent.id))
    trust = await db.scalar(select(AgentTrustScore).where(AgentTrustScore.agent_id == agent.id))
    return {
        "name": agent.persona_name or agent.name,
        "description": (agent.system_prompt or "")[:400],
        "url": f"{settings.a2a_base_url}/a2a/agents/{agent.id}",
        "version": "1.0",
        "provider": {
            "organization": "Aethon Agency",
            "url": settings.a2a_base_url,
        },
        "skills": [
            {
                "id": "execute_task",
                "name": "Execute Task",
                "description": f"Submit a task to {agent.persona_name or agent.name}",
                "inputModes": ["text/plain"],
                "outputModes": ["text/plain"],
            }
        ],
        "x-aethon": {
            "trust_score": round((trust.overall_score if trust else agent.trust_score or 50.0), 1),
            "autonomy_level": agent.autonomy_level or "supervised",
            "role": agent.role_slug,
            "tasks_completed": agent.total_tasks_completed or 0,
            "allowed_tools": contract.allowed_tools if contract else [],
        },
        "capabilities": {
            "streaming": True,
            "push_notifications": False,
            "state_transition_history": True,
        },
        "authentication": _a2a_auth_block(),
    }


async def _resolve_a2a_api_key(
    raw_key: str | None,
    *,
    org_id: str,
    db: AsyncSession,
) -> ApiKey | None:
    if not raw_key:
        return None
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.org_id == org_id,
            ApiKey.is_active == True,  # noqa: E712
            or_(ApiKey.expires_at.is_(None), ApiKey.expires_at > now),
        )
    )
    for key in result.scalars().all():
        if verify_password(raw_key, key.key_hash):
            key.last_used_at = now
            await db.commit()
            return key
    return None


def _extract_text_from_message(payload: dict[str, Any]) -> str:
    message = payload.get("message", {}) or {}
    text_parts: list[str] = []
    for part in message.get("parts", []) or []:
        if part.get("type") == "text" and part.get("text"):
            text_parts.append(str(part["text"]))
    return "\n".join(text_parts).strip()


def _workflow_has_agent(workflow: Workflow, agent_id: str) -> bool:
    for node in (workflow.nodes or []) or []:
        data = (node or {}).get("data", {}) or {}
        if data.get("agent_id") == agent_id:
            return True
        if agent_id in (data.get("agent_ids") or []):
            return True
    return False


async def _find_agent_workflow(agent: Agent, db: AsyncSession) -> Workflow | None:
    workflows = (
        await db.execute(
            select(Workflow)
            .where(Workflow.org_id == agent.org_id)
            .order_by(Workflow.created_at.desc())
        )
    ).scalars().all()
    for workflow in workflows:
        if _workflow_has_agent(workflow, agent.id):
            return workflow
    return None


async def _create_execution(agent: Agent, workflow: Workflow, input_text: str, db: AsyncSession) -> Execution:
    execution = Execution(
        id=str(uuid4()),
        org_id=agent.org_id,
        workflow_id=workflow.id,
        client_id=agent.client_id,
        trigger="a2a",
        status=ExecutionStatus.running,
        input_message=input_text,
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)
    return execution


async def _reconcile_a2a_task(task: A2ATask, db: AsyncSession) -> A2ATask:
    if not task.execution_id or _status_value(task.status) in {
        A2ATaskStatus.completed.value,
        A2ATaskStatus.failed.value,
        A2ATaskStatus.input_required.value,
    }:
        return task

    execution = await db.scalar(select(Execution).where(Execution.id == task.execution_id, Execution.org_id == task.org_id))
    if not execution:
        return task

    terminal = {
        ExecutionStatus.completed.value: A2ATaskStatus.completed,
        ExecutionStatus.failed.value: A2ATaskStatus.failed,
        ExecutionStatus.cancelled.value: A2ATaskStatus.failed,
        ExecutionStatus.timed_out.value: A2ATaskStatus.failed,
        ExecutionStatus.rejected.value: A2ATaskStatus.failed,
        ExecutionStatus.waiting_approval.value: A2ATaskStatus.input_required,
    }
    mapped = terminal.get(_status_value(execution.status))
    if not mapped:
        if _status_value(task.status) == A2ATaskStatus.submitted.value:
            task.status = A2ATaskStatus.working
            await db.commit()
        return task

    output_text = execution.output_message or execution.error or task.output_text
    if mapped == A2ATaskStatus.completed and _is_failure_only_output(output_text):
        mapped = A2ATaskStatus.failed

    task.status = mapped
    task.output_text = output_text
    if mapped in {A2ATaskStatus.completed, A2ATaskStatus.failed}:
        task.completed_at = execution.completed_at or datetime.utcnow()
    await db.commit()
    await db.refresh(task)
    return task


def _task_status_payload(task: A2ATask) -> dict[str, Any]:
    return {
        "state": _status_value(task.status),
        "timestamp": (task.completed_at or task.created_at or datetime.utcnow()).isoformat(),
    }


def _task_response_payload(task: A2ATask, *, agent_name: str | None = None) -> dict[str, Any]:
    payload = {
        "id": task.id,
        "status": _task_status_payload(task),
        "metadata": {
            "agent": agent_name,
            "aethon_execution_id": task.execution_id,
            "caller_identity": task.caller_identity,
        },
    }
    if task.output_text:
        payload["artifact"] = {
            "type": "text",
            "text": task.output_text,
        }
    return payload


def _external_agent_payload(external: ExternalAgent) -> dict[str, Any]:
    return {
        "id": external.id,
        "agent_card_url": external.agent_card_url,
        "name": external.name,
        "description": external.description,
        "provider_name": external.provider_name,
        "provider_url": external.provider_url,
        "task_endpoint": external.task_endpoint,
        "skills": external.skills or [],
        "trust_status": external.trust_status,
        "agent_did": external.agent_did,
        "tool_name": external_agent_tool_name(external.name),
        "total_calls": int(external.total_calls or 0),
        "successful_calls": int(external.successful_calls or 0),
        "total_cost_usd": float(external.total_cost_usd or 0.0),
        "added_at": external.added_at,
        "last_used_at": external.last_used_at,
        "has_api_key": bool(decrypt_value(external.api_key_encrypted or "")),
    }


async def _watch_a2a_task(task_id: str) -> None:
    timeout_seconds = 3600
    started = asyncio.get_event_loop().time()
    while asyncio.get_event_loop().time() - started < timeout_seconds:
        async with AsyncSessionLocal() as db:
            task = await db.scalar(select(A2ATask).where(A2ATask.id == task_id))
            if not task:
                return
            task = await _reconcile_a2a_task(task, db)
            if _status_value(task.status) in {
                A2ATaskStatus.completed.value,
                A2ATaskStatus.failed.value,
                A2ATaskStatus.input_required.value,
            }:
                return
        await asyncio.sleep(5)


@router.get("/.well-known/agent-card.json")
async def org_agent_card(
    org_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    _ensure_a2a_enabled()
    org_id = await _resolve_org_scope(org_id, db)
    agents = (
        await db.execute(
            select(Agent)
            .where(Agent.org_id == org_id, Agent.is_active == True)  # noqa: E712
            .order_by(Agent.created_at.asc())
        )
    ).scalars().all()
    return {
        "name": f"Aethon Agency — {org_id[:8]}",
        "description": "AI agency powered by Aethon Agency OS",
        "url": settings.a2a_base_url,
        "version": "1.0",
        "capabilities": {
            "streaming": True,
            "push_notifications": False,
            "state_transition_history": True,
        },
        "skills": [
            {
                "id": str(agent.id),
                "name": agent.persona_name or agent.name,
                "description": (agent.system_prompt or "")[:200],
                "tags": [
                    agent.role_slug or "agent",
                    agent.autonomy_level or "supervised",
                ],
                "examples": [
                    f"Research {agent.role_slug or 'topic'} information",
                    "Analyze data and produce a report",
                ],
            }
            for agent in agents
        ],
        "authentication": _a2a_auth_block(),
    }


@router.get("/a2a/agents/{agent_id}/agent-card.json")
async def agent_card(
    agent_id: str,
    org_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    _ensure_a2a_enabled()
    org_id = await _resolve_org_scope(org_id, db)
    agent = await _get_agent(agent_id, org_id, db)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return await _get_agent_card_payload(agent, db)


@router.post("/a2a/agents/{agent_id}/tasks")
async def submit_a2a_task(
    agent_id: str,
    request: Request,
    x_a2a_key: str | None = Header(None, alias="X-A2A-Key"),
    db: AsyncSession = Depends(get_db),
):
    _ensure_a2a_enabled()
    body = await request.json()
    text_input = _extract_text_from_message(body)
    if not text_input:
        raise HTTPException(status_code=422, detail="A2A task must include text message content")

    agent = await _get_agent(agent_id, settings.a2a_org_id or None, db)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    api_key = x_a2a_key or request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    if settings.a2a_require_api_key and not api_key:
        raise HTTPException(status_code=401, detail="A2A API key required")

    resolved_key = await _resolve_a2a_api_key(api_key, org_id=agent.org_id, db=db) if api_key else None
    if settings.a2a_require_api_key and not resolved_key:
        raise HTTPException(status_code=401, detail="Invalid A2A API key")

    workflow = await _find_agent_workflow(agent, db)
    task = A2ATask(
        id=str(body.get("id") or uuid4()),
        agent_id=agent.id,
        org_id=agent.org_id,
        input_text=text_input,
        caller_identity=resolved_key.key_prefix if resolved_key else (request.client.host if request.client else "anonymous"),
        status=A2ATaskStatus.submitted,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    if workflow:
        execution = await _create_execution(agent, workflow, text_input, db)
        task.execution_id = execution.id
        task.status = A2ATaskStatus.working
        await db.commit()
        await db.refresh(task)
        await enqueue_workflow_execution(
            execution.id,
            workflow.id,
            text_input,
            None,
            str(agent.org_id),
        )
        asyncio.create_task(_watch_a2a_task(task.id))

    return _task_response_payload(task, agent_name=agent.persona_name or agent.name)


@router.get("/a2a/agents/{agent_id}/tasks/{task_id}")
async def get_a2a_task(
    agent_id: str,
    task_id: str,
    request: Request,
    x_a2a_key: str | None = Header(None, alias="X-A2A-Key"),
    db: AsyncSession = Depends(get_db),
):
    _ensure_a2a_enabled()
    task = await db.scalar(select(A2ATask).where(A2ATask.id == task_id, A2ATask.agent_id == agent_id))
    if not task:
        raise HTTPException(status_code=404, detail="A2A task not found")
    agent = await _get_agent(agent_id, task.org_id, db)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    api_key = x_a2a_key or (request.headers.get("Authorization", "").replace("Bearer ", "").strip() if request else "")
    if settings.a2a_require_api_key and not await _resolve_a2a_api_key(api_key or None, org_id=task.org_id, db=db):
        raise HTTPException(status_code=401, detail="Invalid A2A API key")
    task = await _reconcile_a2a_task(task, db)
    return _task_response_payload(task, agent_name=agent.persona_name or agent.name)


@router.get("/a2a/agents/{agent_id}/tasks/{task_id}/stream")
async def stream_a2a_task(
    agent_id: str,
    task_id: str,
    request: Request,
    x_a2a_key: str | None = Header(None, alias="X-A2A-Key"),
    db: AsyncSession = Depends(get_db),
):
    _ensure_a2a_enabled()
    task = await db.scalar(select(A2ATask).where(A2ATask.id == task_id, A2ATask.agent_id == agent_id))
    if not task:
        raise HTTPException(status_code=404, detail="A2A task not found")
    if settings.a2a_require_api_key:
        api_key = x_a2a_key or (request.headers.get("Authorization", "").replace("Bearer ", "").strip() if request else "")
        if not await _resolve_a2a_api_key(api_key or None, org_id=task.org_id, db=db):
            raise HTTPException(status_code=401, detail="Invalid A2A API key")

    async def event_stream():
        event_id = 0
        session_factory = async_sessionmaker(bind=db.bind, expire_on_commit=False, class_=AsyncSession)
        while True:
            async with session_factory() as stream_db:
                current = await stream_db.scalar(select(A2ATask).where(A2ATask.id == task_id, A2ATask.agent_id == agent_id))
                if not current:
                    break
                current = await _reconcile_a2a_task(current, stream_db)
                payload = {
                    "id": event_id,
                    "result": _task_response_payload(current),
                }
                yield f"id: {event_id}\ndata: {json.dumps(payload)}\n\n"
                if _status_value(current.status) in {
                    A2ATaskStatus.completed.value,
                    A2ATaskStatus.failed.value,
                    A2ATaskStatus.input_required.value,
                }:
                    break
            event_id += 1
            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@internal_router.get("/tasks")
async def list_a2a_tasks(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    tasks = (
        await db.execute(
            select(A2ATask, Agent, ExternalAgent)
            .join(Agent, Agent.id == A2ATask.agent_id)
            .outerjoin(ExternalAgent, ExternalAgent.id == A2ATask.external_agent_id)
            .where(A2ATask.org_id == ctx.org.id, Agent.org_id == ctx.org.id)
            .order_by(A2ATask.created_at.desc())
        )
    ).all()
    if not settings.a2a_enabled and not tasks:
        return {"enabled": False, "active_count": 0, "tasks": []}

    payload: list[dict[str, Any]] = []
    active_count = 0
    for task, agent, external_agent in tasks:
        task = await _reconcile_a2a_task(task, db)
        if _status_value(task.status) in {A2ATaskStatus.submitted.value, A2ATaskStatus.working.value, A2ATaskStatus.input_required.value}:
            active_count += 1
        duration_seconds = None
        if task.completed_at and task.created_at:
            duration_seconds = max(0.0, (task.completed_at - task.created_at).total_seconds())
        payload.append(
            {
                "id": task.id,
                "agent_id": task.agent_id,
                "agent_name": agent.persona_name or agent.name,
                "direction": _status_value(task.direction),
                "external_agent_id": task.external_agent_id,
                "external_agent_name": external_agent.name if external_agent else None,
                "status": _status_value(task.status),
                "caller_identity": task.caller_identity,
                "input_text": task.input_text,
                "output_text": task.output_text,
                "execution_id": task.execution_id,
                "payment_amount": task.payment_amount,
                "payment_currency": task.payment_currency,
                "created_at": task.created_at,
                "completed_at": task.completed_at,
                "duration_seconds": duration_seconds,
            }
        )

    return {
        "enabled": True,
        "active_count": active_count,
        "tasks": payload,
    }


@internal_router.get("/external-agents")
async def list_external_agents(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    agents = (
        await db.execute(
            select(ExternalAgent)
            .where(ExternalAgent.org_id == ctx.org.id)
            .order_by(ExternalAgent.added_at.desc())
        )
    ).scalars().all()
    return {
        "items": [_external_agent_payload(agent) for agent in agents],
    }


@internal_router.post("/external-agents/discover")
async def discover_external_agent(
    payload: ExternalAgentDiscoverRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        external = await a2a_client.discover(payload.agent_card_url.strip(), ctx.org.id, db)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch agent card: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _external_agent_payload(external)


async def _get_org_external_agent(external_agent_id: str, org_id: str, db: AsyncSession) -> ExternalAgent:
    external = await db.scalar(
        select(ExternalAgent).where(
            ExternalAgent.id == external_agent_id,
            ExternalAgent.org_id == org_id,
        )
    )
    if not external:
        raise HTTPException(status_code=404, detail="External agent not found")
    return external


@internal_router.post("/external-agents/{external_agent_id}/trust")
async def trust_external_agent(
    external_agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    external = await _get_org_external_agent(external_agent_id, ctx.org.id, db)
    external.trust_status = "trusted"
    await db.commit()
    await db.refresh(external)
    return _external_agent_payload(external)


@internal_router.post("/external-agents/{external_agent_id}/block")
async def block_external_agent(
    external_agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    external = await _get_org_external_agent(external_agent_id, ctx.org.id, db)
    external.trust_status = "blocked"
    await db.commit()
    await db.refresh(external)
    return _external_agent_payload(external)


@internal_router.post("/external-agents/{external_agent_id}/untrust")
async def untrust_external_agent(
    external_agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    external = await _get_org_external_agent(external_agent_id, ctx.org.id, db)
    external.trust_status = "pending"
    await db.commit()
    await db.refresh(external)
    return _external_agent_payload(external)


@internal_router.post("/external-agents/{external_agent_id}/api-key")
async def set_external_agent_api_key(
    external_agent_id: str,
    payload: ExternalAgentApiKeyRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        external = await a2a_client.set_api_key(
            external_agent_id,
            ctx.org.id,
            payload.api_key,
            db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _external_agent_payload(external)

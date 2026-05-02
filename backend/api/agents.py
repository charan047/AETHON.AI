from auth.dependencies import get_current_user, require_editor, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from uuid import uuid4

from database import get_db
from database.models import Agent, AgentMemoryConfig, AuditAction, CustomTool
from config import AVAILABLE_MODELS, AVAILABLE_TOOLS, settings
from services import audit_log_service
from services.long_running_agent import LongRunningAgentService
from utils.sanitize import sanitize_text

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
long_running_agent_service = LongRunningAgentService()


class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    role: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    system_prompt: str = Field(..., min_length=1, max_length=50000)
    model: str = settings.default_model
    tools: List[str] = []
    memory_enabled: bool = True
    memory_window: int = 10
    max_tokens: int = 2000
    temperature: float = 0.7
    max_iterations: int = 10
    timeout: int = 120
    max_retries: int = Field(default=3, ge=0, le=10)
    retry_delay_seconds: int = Field(default=5, ge=1, le=60)
    retry_backoff_multiplier: float = Field(default=2.0, ge=1.0, le=5.0)
    retry_on_timeout: bool = True
    telegram_enabled: bool = False


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    role: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=5000)
    system_prompt: Optional[str] = Field(default=None, max_length=50000)
    model: Optional[str] = None
    tools: Optional[List[str]] = None
    memory_enabled: Optional[bool] = None
    memory_window: Optional[int] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    max_iterations: Optional[int] = None
    timeout: Optional[int] = None
    max_retries: Optional[int] = Field(default=None, ge=0, le=10)
    retry_delay_seconds: Optional[int] = Field(default=None, ge=1, le=60)
    retry_backoff_multiplier: Optional[float] = Field(default=None, ge=1.0, le=5.0)
    retry_on_timeout: Optional[bool] = None
    telegram_enabled: Optional[bool] = None
    is_active: Optional[bool] = None


class AgentResponse(BaseModel):
    id: str
    org_id: str
    name: str
    role: str
    description: str
    system_prompt: str
    model: str
    model_config_id: Optional[str] = None
    tools: List[str]
    memory_enabled: bool
    memory_window: int
    max_tokens: int
    temperature: float
    max_iterations: int
    timeout: int
    max_retries: int
    retry_delay_seconds: int
    retry_backoff_multiplier: float
    retry_on_timeout: bool
    telegram_enabled: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AgentMemoryConfigUpdate(BaseModel):
    memory_enabled: Optional[bool] = None
    max_memories_per_query: Optional[int] = None
    memory_window_days: Optional[int] = None


class AgentMemoryConfigResponse(BaseModel):
    id: str
    agent_id: str
    memory_enabled: bool
    max_memories_per_query: int
    memory_window_days: int
    auto_summarize: bool
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class LongTaskStartRequest(BaseModel):
    task: str = Field(..., min_length=1)
    max_duration_hours: int = Field(default=4, ge=1, le=24)


async def get_or_create_memory_config(agent_id: str, db: AsyncSession, org_id: str) -> AgentMemoryConfig:
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id))
    if not agent_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found")

    config_result = await db.execute(
        select(AgentMemoryConfig).where(AgentMemoryConfig.agent_id == agent_id)
    )
    memory_config = config_result.scalar_one_or_none()
    if memory_config:
        return memory_config

    memory_config = AgentMemoryConfig(agent_id=agent_id)
    db.add(memory_config)
    await db.commit()
    await db.refresh(memory_config)
    return memory_config


@router.get("", response_model=List[AgentResponse])
async def list_agents(db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(Agent).where(Agent.org_id == ctx.org.id).order_by(Agent.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(
    data: AgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("agents", ctx.org, db)
    if data.memory_enabled:
        await check_plan_limit("memory_enabled", ctx.org, db)
    payload = data.model_dump()
    payload["system_prompt"] = sanitize_text(payload["system_prompt"], max_length=50000)
    payload["tools"] = list(dict.fromkeys([*(payload.get("tools") or []), "agent_communication"]))
    agent = Agent(
        id=str(uuid4()),
        org_id=ctx.org.id,
        **payload,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.post("/{agent_id}/long-tasks", status_code=202)
async def start_long_running_agent_task(
    agent_id: str,
    data: LongTaskStartRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    task_id = await long_running_agent_service.start_long_task(
        agent_id=agent_id,
        task=data.task,
        user_id=current_user.id,
        org_id=ctx.org.id,
        max_duration_hours=data.max_duration_hours,
    )
    return {"task_id": task_id, "status": "queued"}


async def _get_org_scoped_long_task(task_id: str, ctx: OrgContext) -> dict:
    payload = await long_running_agent_service.get_task_status(task_id)
    if payload.get("org_id") != ctx.org.id:
        raise HTTPException(status_code=404, detail="Long-running task not found")
    return payload


@router.get("/long-tasks/{task_id}")
async def get_long_running_agent_task_status(
    task_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    return await _get_org_scoped_long_task(task_id, ctx)


@router.post("/long-tasks/{task_id}/pause")
async def pause_long_running_agent_task(
    task_id: str,
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_org_scoped_long_task(task_id, ctx)
    return {"paused": await long_running_agent_service.pause_task(task_id)}


@router.post("/long-tasks/{task_id}/cancel")
async def cancel_long_running_agent_task(
    task_id: str,
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_org_scoped_long_task(task_id, ctx)
    return {"cancelled": await long_running_agent_service.cancel_task(task_id)}


@router.get("/{agent_id}/memory-config", response_model=AgentMemoryConfigResponse)
async def get_agent_memory_config(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    return await get_or_create_memory_config(agent_id, db, ctx.org.id)


@router.put("/{agent_id}/memory-config", response_model=AgentMemoryConfigResponse)
async def update_agent_memory_config(
    agent_id: str,
    data: AgentMemoryConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    memory_config = await get_or_create_memory_config(agent_id, db, ctx.org.id)
    if data.memory_enabled is True:
        await check_plan_limit("memory_enabled", ctx.org, db)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(memory_config, field, value)
    memory_config.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(memory_config)
    return memory_config


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: str,
    data: AgentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if data.memory_enabled is True:
        await check_plan_limit("memory_enabled", ctx.org, db)
    updates = data.model_dump(exclude_none=True)
    if "system_prompt" in updates:
        updates["system_prompt"] = sanitize_text(updates["system_prompt"], max_length=50000)
    if "tools" in updates:
        updates["tools"] = list(dict.fromkeys([*(updates.get("tools") or []), "agent_communication"]))
    for field, value in updates.items():
        setattr(agent, field, value)
    agent.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    deleted_name = agent.name
    await db.delete(agent)
    await db.commit()
    await audit_log_service.log(
        AuditAction.agent_deleted,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="agent",
        resource_id=agent_id,
        request=request,
        details={"name": deleted_name},
        db=db,
    )


@router.get("/meta/models")
async def get_models():
    return AVAILABLE_MODELS


@router.get("/meta/tools")
async def get_tools_list(db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    tools = list(AVAILABLE_TOOLS)
    ct_result = await db.execute(
        select(CustomTool).where(CustomTool.org_id == ctx.org.id, CustomTool.is_active == True).order_by(CustomTool.name)
    )
    for ct in ct_result.scalars().all():
        tools.append({"id": ct.id, "name": ct.name, "description": ct.description, "custom": True})
    return tools

from auth.dependencies import get_current_user, require_editor, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from uuid import uuid4

from database import get_db
from database.models import Agent, AgentMemoryConfig, CustomTool
from config import AVAILABLE_MODELS, AVAILABLE_TOOLS, settings

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class AgentCreate(BaseModel):
    name: str
    role: str
    description: str = ""
    system_prompt: str
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
    name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
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
    name: str
    role: str
    description: str
    system_prompt: str
    model: str
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
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("agents", ctx.org, db)
    if data.memory_enabled:
        await check_plan_limit("memory_enabled", ctx.org, db)
    agent = Agent(
        id=str(uuid4()),
        org_id=ctx.org.id,
        **data.model_dump(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


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
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if data.memory_enabled is True:
        await check_plan_limit("memory_enabled", ctx.org, db)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    agent.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    await db.delete(agent)
    await db.commit()


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

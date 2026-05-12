from auth.dependencies import get_current_user, require_editor, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
from uuid import uuid4
import logging
import re

from database import get_db
from database.models import Agent, AgentMemoryConfig, AgentContract, AgentRole, AgentTrustScore, AuditAction, Client, CustomTool, Organization
from config import AVAILABLE_MODELS, AVAILABLE_TOOLS, settings
from services import audit_log_service
from services.agent_naming_service import agent_naming_service
from services.long_running_agent import LongRunningAgentService
from utils.sanitize import sanitize_text

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
long_running_agent_service = LongRunningAgentService()
VALID_AUTONOMY_LEVELS = {"restricted", "supervised", "semi_autonomous", "autonomous"}
logger = logging.getLogger(__name__)


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
    role_slug: Optional[str] = None
    seniority_level: int = 1
    autonomy_level: str = "supervised"
    trust_score: float = 50.0
    client_id: Optional[str] = None
    persona_name: Optional[str] = Field(
        default=None,
        max_length=100,
        description="The agent's given name e.g. 'Maya', 'Alex'. If not provided, one will be suggested.",
    )

    @field_validator("autonomy_level")
    @classmethod
    def validate_autonomy(cls, v: str) -> str:
        if v not in VALID_AUTONOMY_LEVELS:
            raise ValueError(f"autonomy_level must be one of {VALID_AUTONOMY_LEVELS}")
        return v

    @field_validator("persona_name")
    @classmethod
    def validate_persona_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            return None
        if not re.match(r"^[A-Za-z][A-Za-z\s\-']{0,98}$", value):
            raise ValueError(
                "persona_name must start with a letter and contain only letters, spaces, hyphens, or apostrophes"
            )
        return value.title()


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
    role_slug: Optional[str] = None
    seniority_level: Optional[int] = None
    autonomy_level: Optional[str] = None
    client_id: Optional[str] = None
    persona_name: Optional[str] = Field(default=None, max_length=100)

    @field_validator("autonomy_level")
    @classmethod
    def validate_autonomy(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_AUTONOMY_LEVELS:
            raise ValueError(f"autonomy_level must be one of {VALID_AUTONOMY_LEVELS}")
        return v

    @field_validator("persona_name")
    @classmethod
    def validate_persona_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            return None
        if not re.match(r"^[A-Za-z][A-Za-z\s\-']{0,98}$", value):
            raise ValueError(
                "persona_name must start with a letter and contain only letters, spaces, hyphens, or apostrophes"
            )
        return value.title()


class AgentResponse(BaseModel):
    id: str
    org_id: str
    client_id: Optional[str] = None
    name: str
    persona_name: Optional[str] = None
    role: str
    role_slug: Optional[str] = None
    seniority_level: int
    autonomy_level: str
    trust_score: float
    current_status: str
    current_task_summary: Optional[str] = None
    department_id: Optional[str] = None
    reports_to_agent_id: Optional[str] = None
    total_tasks_completed: int
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


class AssignClientRequest(BaseModel):
    client_id: Optional[str] = None


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


async def _get_org_name(org_id: str, db: AsyncSession) -> str:
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    if org and org.name:
        return org.name
    return "our company"


async def _validate_client_assignment(client_id: str | None, db: AsyncSession, org_id: str) -> str | None:
    if client_id is None:
        return None
    client = await db.scalar(
        select(Client).where(
            Client.id == client_id,
            Client.org_id == org_id,
        )
    )
    if not client:
        raise HTTPException(status_code=400, detail="Client not found in your agency.")
    return client_id


async def _initialize_agent_identity(
    agent_id: str,
    role_slug: str | None,
    db: AsyncSession,
) -> None:
    """
    Create AgentContract and AgentTrustScore for a new agent.
    Called automatically during create and marketplace install.
    Non-fatal: if this fails, logs warning but agent still works.
    """
    try:
        existing_contract = await db.scalar(
            select(AgentContract).where(AgentContract.agent_id == agent_id)
        )
        existing_trust = await db.scalar(
            select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id)
        )
        if existing_contract and existing_trust:
            return

        allowed_tools: list = []
        autonomy_level = "supervised"
        max_cost_cents = 100

        if role_slug:
            role = await db.scalar(
                select(AgentRole).where(AgentRole.slug == role_slug)
            )
            if role:
                allowed_tools = role.default_tools or []
                autonomy_level = role.default_autonomy_level or "supervised"

        if not existing_contract:
            contract = AgentContract(
                id=str(uuid4()),
                agent_id=agent_id,
                responsibilities=[],
                allowed_tools=allowed_tools,
                forbidden_tools=[],
                forbidden_actions=[],
                requires_approval_for=[],
                escalates_to_role="ceo",
                escalation_triggers=["low_confidence", "blocked"],
                max_tokens_per_task=50000,
                max_cost_per_task_cents=max_cost_cents,
                autonomy_level=autonomy_level,
            )
            db.add(contract)

        if not existing_trust:
            trust = AgentTrustScore(
                id=str(uuid4()),
                agent_id=agent_id,
                overall_score=50.0,
                task_success_rate=0.0,
                review_pass_rate=0.0,
                risky_action_rate=100.0,
                cost_efficiency=100.0,
                on_time_rate=100.0,
            )
            db.add(trust)

        await db.commit()
        logger.info("Initialized identity for agent %s", agent_id)

    except Exception as exc:
        logger.warning(
            "Could not initialize agent identity for %s (non-fatal): %s",
            agent_id, exc,
        )


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
    payload = data.model_dump()
    payload["client_id"] = await _validate_client_assignment(payload.get("client_id"), db, ctx.org.id)
    if payload.get("memory_enabled"):
        try:
            await check_plan_limit("memory_enabled", ctx.org, db)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            if (
                exc.status_code == 403
                and detail.get("code") == "plan_limit_reached"
                and detail.get("resource") == "memory_enabled"
            ):
                payload["memory_enabled"] = False
                logger.info(
                    "Downgraded memory_enabled to False for agent create in org %s on plan %s",
                    ctx.org.id,
                    ctx.org.plan,
                )
            else:
                raise
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
    await _initialize_agent_identity(
        agent_id=str(agent.id),
        role_slug=agent.role_slug,
        db=db,
    )
    if agent.persona_name:
        await agent_naming_service.seed_identity_memory(
            agent_id=str(agent.id),
            org_id=str(agent.org_id),
            persona_name=agent.persona_name,
            role_display=agent.role or agent.role_slug or "Aethon teammate",
            company_name=await _get_org_name(ctx.org.id, db),
            department_type="operations",
            db=db,
        )
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


@router.get("/name-suggestions")
async def get_name_suggestions(
    department_type: str = "operations",
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    taken = await agent_naming_service.get_taken_names(str(ctx.org.id), db)
    suggestions = agent_naming_service.suggest_names(
        department_type=department_type,
        count=4,
        exclude=taken,
    )
    return {
        "suggestions": suggestions,
        "already_taken": taken,
    }


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
    if "client_id" in data.model_fields_set:
        updates["client_id"] = await _validate_client_assignment(data.client_id, db, ctx.org.id)
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


@router.post("/{agent_id}/assign-client", response_model=AgentResponse)
async def assign_client(
    agent_id: str,
    data: AssignClientRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.client_id = await _validate_client_assignment(data.client_id, db, ctx.org.id)
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

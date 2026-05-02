from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from database.db import get_db
from database.models import Agent, AuditAction, ModelConfig, User
from database.seed_models import BUILT_IN_MODELS, seed_org_default_model
from services import audit_log_service
from services.integration_crypto import decrypt_value, encrypt_value
from services.model_service import model_service


public_router = APIRouter(prefix="/models", tags=["models"])
router = APIRouter(
    prefix="/models",
    tags=["models"],
    dependencies=[Depends(get_current_user), Depends(get_org_context)],
)
agent_model_router = APIRouter(
    prefix="/agents",
    tags=["models"],
    dependencies=[Depends(get_current_user), Depends(get_org_context)],
)


class ModelConfigCreateRequest(BaseModel):
    provider: str = Field(..., min_length=1, max_length=50)
    model_id: str = Field(..., min_length=1, max_length=200)
    display_name: str = Field(..., min_length=1, max_length=200)
    api_key: str | None = None
    base_url: str | None = None
    notes: str | None = None
    set_as_default: bool = False
    context_window: int | None = None
    supports_tools: bool = True
    supports_vision: bool = False
    cost_per_million_input_tokens: float | None = None
    cost_per_million_output_tokens: float | None = None


class ModelConfigUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    is_active: bool | None = None


class ModelKeyRotateRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


class ModelConfigTestRequest(BaseModel):
    provider: str = Field(..., min_length=1, max_length=50)
    model_id: str = Field(..., min_length=1, max_length=200)
    api_key: str | None = None
    base_url: str | None = None


class AgentModelAssignmentRequest(BaseModel):
    model_config_id: str | None = None


def _mask_api_key(api_key: str) -> str | None:
    if not api_key:
        return None
    if len(api_key) <= 10:
        return f"{api_key[:2]}...{api_key[-2:]}"
    return f"{api_key[:6]}...{api_key[-4:]}"


def _template_payload(template: dict[str, Any]) -> dict[str, Any]:
    provider = template.get("provider", "")
    return {
        **template,
        "requires_api_key": provider in {"openai", "anthropic", "custom"},
        "requires_base_url": provider in {"ollama", "custom"},
        "requires_ollama": bool(template.get("requires_ollama", False)),
    }


def _config_payload(
    config: ModelConfig,
    *,
    agent_count: int = 0,
    include_masked_key: bool = True,
) -> dict[str, Any]:
    decrypted_key = decrypt_value(config.api_key_encrypted or "") if include_masked_key else ""
    return {
        "id": config.id,
        "org_id": config.org_id,
        "provider": config.provider,
        "model_id": config.model_id,
        "display_name": config.display_name,
        "base_url": config.base_url,
        "context_window": config.context_window,
        "supports_tools": config.supports_tools,
        "supports_vision": config.supports_vision,
        "cost_per_million_input_tokens": config.cost_per_million_input_tokens,
        "cost_per_million_output_tokens": config.cost_per_million_output_tokens,
        "is_active": config.is_active,
        "is_default": config.is_default,
        "test_status": config.test_status,
        "test_error": config.test_error,
        "last_tested_at": config.last_tested_at,
        "notes": config.notes,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
        "agent_count": agent_count,
        "masked_api_key": _mask_api_key(decrypted_key) if include_masked_key else None,
    }


async def _get_org_scoped_config(config_id: str, org_id: str, db: AsyncSession) -> ModelConfig:
    result = await db.execute(
        select(ModelConfig).where(ModelConfig.id == config_id, ModelConfig.org_id == org_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Model config not found")
    return config


async def _agent_count_for_config(config_id: str, org_id: str, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(Agent.id)).where(
            Agent.org_id == org_id,
            Agent.model_config_id == config_id,
        )
    )
    return int(result.scalar() or 0)


@public_router.get("/templates")
async def list_model_templates():
    return [_template_payload(template) for template in BUILT_IN_MODELS]


@router.get("")
async def list_model_configs(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    existing_count = await db.scalar(
        select(func.count(ModelConfig.id)).where(ModelConfig.org_id == ctx.org.id)
    )
    if not existing_count:
        await seed_org_default_model(ctx.org.id, db)

    agent_count_sq = (
        select(
            Agent.model_config_id.label("model_config_id"),
            func.count(Agent.id).label("agent_count"),
        )
        .where(Agent.org_id == ctx.org.id)
        .where(Agent.model_config_id.is_not(None))
        .group_by(Agent.model_config_id)
        .subquery()
    )
    result = await db.execute(
        select(
            ModelConfig,
            func.coalesce(agent_count_sq.c.agent_count, 0).label("agent_count"),
        )
        .outerjoin(agent_count_sq, agent_count_sq.c.model_config_id == ModelConfig.id)
        .where(ModelConfig.org_id == ctx.org.id)
        .order_by(ModelConfig.is_default.desc(), ModelConfig.is_active.desc(), ModelConfig.created_at.asc())
    )
    return [
        _config_payload(config, agent_count=int(agent_count or 0))
        for config, agent_count in result.all()
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_model_config(
    data: ModelConfigCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    config = ModelConfig(
        org_id=ctx.org.id,
        provider=data.provider,
        model_id=data.model_id.removeprefix("ollama/"),
        display_name=data.display_name,
        api_key_encrypted=encrypt_value(data.api_key or "") if data.api_key else None,
        base_url=data.base_url,
        context_window=data.context_window,
        supports_tools=data.supports_tools,
        supports_vision=data.supports_vision,
        cost_per_million_input_tokens=data.cost_per_million_input_tokens,
        cost_per_million_output_tokens=data.cost_per_million_output_tokens,
        is_active=True,
        is_default=False,
        test_status="untested",
        notes=data.notes,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(config)
    await db.flush()

    if data.set_as_default:
        await db.execute(
            ModelConfig.__table__.update()
            .where(ModelConfig.org_id == ctx.org.id)
            .values(is_default=False)
        )
        config.is_default = True

    await db.commit()
    await db.refresh(config)

    await audit_log_service.log(
        AuditAction.model_added,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="model_config",
        resource_id=config.id,
        details={"provider": config.provider, "model_id": config.model_id, "display_name": config.display_name},
        db=db,
    )
    return _config_payload(config, agent_count=0)


@router.post("/test")
async def test_model_config(data: ModelConfigTestRequest):
    return await model_service.test_connection(
        provider=data.provider,
        model_id=data.model_id.removeprefix("ollama/"),
        api_key=data.api_key or "",
        base_url=data.base_url,
    )


@router.get("/{config_id}")
async def get_model_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    config = await _get_org_scoped_config(config_id, ctx.org.id, db)
    agent_count = await _agent_count_for_config(config.id, ctx.org.id, db)
    return _config_payload(config, agent_count=agent_count)


@router.put("/{config_id}")
async def update_model_config(
    config_id: str,
    data: ModelConfigUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    config = await _get_org_scoped_config(config_id, ctx.org.id, db)
    updates = data.model_dump(exclude_none=True)
    if config.is_default and updates.get("is_active") is False:
        raise HTTPException(status_code=409, detail="Cannot deactivate the default model. Set another as default first.")
    for field, value in updates.items():
        setattr(config, field, value)
    config.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(config)
    agent_count = await _agent_count_for_config(config.id, ctx.org.id, db)
    return _config_payload(config, agent_count=agent_count)


@router.patch("/{config_id}/rotate-key")
async def rotate_model_key(
    config_id: str,
    data: ModelKeyRotateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    config = await _get_org_scoped_config(config_id, ctx.org.id, db)
    config.api_key_encrypted = encrypt_value(data.api_key)
    config.test_status = "untested"
    config.test_error = None
    config.last_tested_at = None
    config.updated_at = datetime.utcnow()
    await db.commit()
    return {"success": True}


@router.post("/{config_id}/set-default")
async def set_default_model_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    config = await _get_org_scoped_config(config_id, ctx.org.id, db)
    if not config.is_active:
        raise HTTPException(status_code=400, detail="Cannot set an inactive model as default")
    await model_service.set_default(config_id, ctx.org.id, db)
    await audit_log_service.log(
        AuditAction.model_set_default,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="model_config",
        resource_id=config.id,
        details={"provider": config.provider, "model_id": config.model_id, "display_name": config.display_name},
        db=db,
    )
    return {"success": True}


@router.post("/{config_id}/test")
async def test_saved_model_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    config = await _get_org_scoped_config(config_id, ctx.org.id, db)
    api_key = decrypt_value(config.api_key_encrypted or "")
    result = await model_service.test_connection(
        provider=config.provider,
        model_id=config.model_id,
        api_key=api_key,
        base_url=config.base_url,
    )
    config.test_status = "ok" if result["success"] else "failed"
    config.test_error = result["error"]
    config.last_tested_at = datetime.utcnow()
    config.updated_at = datetime.utcnow()
    await db.commit()
    return result


@router.delete("/{config_id}")
async def delete_model_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    config = await _get_org_scoped_config(config_id, ctx.org.id, db)
    if config.is_default:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete the default model. Set another as default first.",
        )
    agent_count = await _agent_count_for_config(config.id, ctx.org.id, db)
    if agent_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"{agent_count} agents use this model. Reassign them first.",
        )
    config.is_active = False
    config.updated_at = datetime.utcnow()
    await db.commit()
    return {"success": True}


@agent_model_router.patch("/{agent_id}/model")
async def assign_model_to_agent(
    agent_id: str,
    data: AgentModelAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    agent_result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    old_model = agent.model
    if data.model_config_id:
        config = await _get_org_scoped_config(data.model_config_id, ctx.org.id, db)
        if not config.is_active:
            raise HTTPException(status_code=400, detail="Cannot assign an inactive model")
        agent.model_config_id = config.id
        agent.model = config.model_id
        new_model = config.display_name
    else:
        agent.model_config_id = None
        org_default = await model_service.get_org_default(ctx.org.id, db)
        if org_default:
            agent.model = org_default.model_id
            new_model = org_default.display_name
        else:
            new_model = agent.model

    agent.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(agent)

    await audit_log_service.log(
        AuditAction.agent_model_changed,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="agent",
        resource_id=agent.id,
        details={"agent_name": agent.name, "old_model": old_model, "new_model": new_model},
        db=db,
    )
    return {
        "id": agent.id,
        "org_id": agent.org_id,
        "name": agent.name,
        "role": agent.role,
        "description": agent.description,
        "system_prompt": agent.system_prompt,
        "model": agent.model,
        "model_config_id": agent.model_config_id,
        "tools": agent.tools,
        "memory_enabled": agent.memory_enabled,
        "memory_window": agent.memory_window,
        "max_tokens": agent.max_tokens,
        "temperature": agent.temperature,
        "max_iterations": agent.max_iterations,
        "timeout": agent.timeout,
        "max_retries": agent.max_retries,
        "retry_delay_seconds": agent.retry_delay_seconds,
        "retry_backoff_multiplier": agent.retry_backoff_multiplier,
        "retry_on_timeout": agent.retry_on_timeout,
        "telegram_enabled": agent.telegram_enabled,
        "is_active": agent.is_active,
        "created_at": agent.created_at,
        "updated_at": agent.updated_at,
    }

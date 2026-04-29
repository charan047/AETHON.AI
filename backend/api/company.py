from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import Agent, CompanyProfile, User, Workflow
from services.company_yaml_service import CompanyYamlError, CompanyYamlService


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class CompanyProfileUpdate(BaseModel):
    company_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    mission: Optional[str] = None
    industry: Optional[str] = None
    stage: Optional[str] = None
    monthly_revenue: Optional[int] = Field(default=None, ge=0)
    monthly_budget_usd: Optional[float] = Field(default=None, ge=0)
    runway_months: Optional[int] = Field(default=None, ge=0)
    primary_tech_stack: Optional[str] = None
    goals: Optional[str] = None


class YamlBody(BaseModel):
    yaml_content: str


def _agent_dict(agent: Agent) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "description": agent.description,
        "system_prompt": agent.system_prompt,
        "model": agent.model,
        "tools": agent.tools or [],
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


def _workflow_dict(workflow: Workflow) -> dict:
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "nodes": workflow.nodes or [],
        "edges": workflow.edges or [],
        "status": workflow.status,
        "trigger": workflow.trigger,
        "schedule": workflow.schedule,
        "template_id": workflow.template_id,
        "execution_mode": workflow.execution_mode,
        "orchestration_prompt": workflow.orchestration_prompt,
        "max_cycles": workflow.max_cycles,
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at,
    }


def _profile_dict(profile: CompanyProfile | None) -> dict | None:
    if not profile:
        return None
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "company_name": profile.company_name,
        "mission": profile.mission,
        "industry": profile.industry,
        "stage": profile.stage,
        "monthly_revenue": profile.monthly_revenue,
        "monthly_budget_usd": profile.monthly_budget_usd,
        "runway_months": profile.runway_months,
        "primary_tech_stack": profile.primary_tech_stack,
        "goals": profile.goals,
        "onboarding_complete": profile.onboarding_complete,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    }


async def _get_profile(db: AsyncSession, user_id: str, org_id: str) -> CompanyProfile | None:
    result = await db.execute(select(CompanyProfile).where(CompanyProfile.user_id == user_id, CompanyProfile.org_id == org_id))
    return result.scalar_one_or_none()


async def _get_company_state(db: AsyncSession, user_id: str, org_id: str) -> tuple[CompanyProfile | None, list[Agent], list[Workflow]]:
    profile = await _get_profile(db, user_id, org_id)
    agents = (await db.execute(select(Agent).where(Agent.org_id == org_id).order_by(Agent.created_at.asc()))).scalars().all()
    workflows = (await db.execute(select(Workflow).where(Workflow.org_id == org_id).order_by(Workflow.created_at.asc()))).scalars().all()
    return profile, agents, workflows


@router.get("/profile")
async def get_company_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    profile, agents, workflows = await _get_company_state(db, current_user.id, ctx.org.id)
    return {
        "company_profile": _profile_dict(profile),
        "agents": [_agent_dict(agent) for agent in agents],
        "workflows": [_workflow_dict(workflow) for workflow in workflows],
    }


@router.put("/profile")
async def update_company_profile(
    data: CompanyProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    profile = await _get_profile(db, current_user.id, ctx.org.id)
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    profile.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)
    return _profile_dict(profile)


@router.get("/yaml")
async def export_company_yaml(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    profile, agents, workflows = await _get_company_state(db, current_user.id, ctx.org.id)
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")

    yaml_content = CompanyYamlService().generate_yaml_from_current_state(profile, agents, workflows)
    return Response(
        content=yaml_content,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="company.yaml"'},
    )


@router.post("/yaml/validate")
async def validate_company_yaml(data: YamlBody):
    return CompanyYamlService().validate_yaml(data.yaml_content)


@router.post("/yaml/preview")
async def preview_company_yaml(
    data: YamlBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    return await CompanyYamlService().preview_changes(data.yaml_content, current_user.id, db, org_id=ctx.org.id)


@router.post("/yaml/apply")
async def apply_company_yaml(
    data: YamlBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        return await CompanyYamlService().parse_and_apply(data.yaml_content, current_user.id, db, org_id=ctx.org.id)
    except CompanyYamlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

import json
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database import get_db
from database.models import (
    Agent,
    CompanyProfile,
    Execution,
    ListingStatus,
    MarketplaceListing,
    OrgPlan,
    Organization,
    User,
    UserIntegration,
    Workflow,
)
from onboarding.demo_seeder import seed_demo_data


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class OnboardingStatusResponse(BaseModel):
    onboarding_completed: bool
    current_step: str
    company_name: str
    has_agents: bool
    has_integrations: bool


class CompanyIdentityRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    company_description: str = Field(..., min_length=1)
    primary_challenge: str = Field(..., min_length=1, max_length=100)


class HireFirstAgentRequest(BaseModel):
    listing_slug: str = Field(default="market-researcher", min_length=1, max_length=255)
    competitors: str = Field(..., min_length=1)
    delivery_method: str = Field(..., min_length=1, max_length=255)


class _SafeFormatDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _render_template(template: str | None, values: dict[str, Any] | None) -> str:
    if not template:
        return ""
    clean_values = {key: value for key, value in (values or {}).items() if value is not None}
    return template.format_map(_SafeFormatDict(clean_values))


def _to_role_name(role_slug: str | None, fallback: str) -> str:
    if not role_slug:
        return fallback
    return role_slug.replace("_", " ").title()


def _single_agent_nodes(agent_id: str, agent_name: str) -> list[dict[str, Any]]:
    return [
        {
            "id": "agent_node_1",
            "type": "agentNode",
            "position": {
                "x": 180,
                "y": 180,
            },
            "data": {
                "agent_id": agent_id,
                "label": agent_name,
            },
        }
    ]


def _parse_competitors(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


async def _get_org_profile(db: AsyncSession, user_id: str, org_id: str) -> CompanyProfile | None:
    result = await db.execute(
        select(CompanyProfile).where(
            CompanyProfile.user_id == user_id,
            CompanyProfile.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def _sync_company_profile(
    db: AsyncSession,
    user: User,
    org: Organization,
    *,
    company_name: str,
    company_description: str,
    primary_challenge: str | None = None,
    onboarding_complete: Optional[bool] = None,
) -> CompanyProfile:
    profile = await _get_org_profile(db, user.id, org.id)
    goals = [primary_challenge] if primary_challenge else []
    payload = {
        "company_name": company_name,
        "mission": company_description,
        "goals": json.dumps(goals),
        "updated_at": datetime.utcnow(),
    }
    if onboarding_complete is not None:
        payload["onboarding_complete"] = onboarding_complete

    if profile:
        for field, value in payload.items():
            setattr(profile, field, value)
    else:
        profile = CompanyProfile(
            org_id=org.id,
            user_id=user.id,
            monthly_revenue=0,
            primary_tech_stack=json.dumps([]),
            **payload,
        )
        db.add(profile)
        await db.flush()

    return profile


async def _build_market_research_install(
    *,
    db: AsyncSession,
    user: User,
    org: Organization,
    listing: MarketplaceListing,
    competitors: str,
    delivery_method: str,
) -> tuple[Agent, Workflow]:
    template = json.loads(listing.template_data or "{}")
    listing_cfg = template.get("listing", {})
    agent_cfg = template.get("agent", {})
    workflow_cfg = template.get("workflow", {})
    if not agent_cfg or not workflow_cfg:
        raise HTTPException(status_code=400, detail="Marketplace listing is missing installable template data")

    await check_plan_limit("agents", org, db)
    await check_plan_limit("workflows", org, db)

    configured_inputs = {
        "company_name": org.name,
        "company_description": org.company_description or "We are building a new AI-native company.",
        "competitors": competitors,
        "delivery_method": delivery_method,
    }

    role_slug = agent_cfg.get("role_slug") or listing.role_slug
    agent_name = agent_cfg.get("name") or listing.name
    workflow_name = workflow_cfg.get("name") or listing.name

    agent = Agent(
        id=str(uuid4()),
        org_id=org.id,
        name=agent_name,
        role=_to_role_name(role_slug, agent_name),
        description=listing.short_description or workflow_cfg.get("description", ""),
        system_prompt=_render_template(agent_cfg.get("system_prompt"), configured_inputs),
        model=agent_cfg.get("model", "llama-3.3-70b-versatile"),
        role_slug=role_slug,
        seniority_level=agent_cfg.get("seniority_level", 1),
        autonomy_level=agent_cfg.get("autonomy_level", "supervised"),
        trust_score=agent_cfg.get("initial_trust_score", 50.0),
        tools=agent_cfg.get("tools", []),
        temperature=agent_cfg.get("temperature", 0.2),
        max_iterations=agent_cfg.get("max_iterations", 15),
        installed_from_listing_id=listing.id,
        created_by_user_id=user.id,
    )
    db.add(agent)
    await db.flush()

    is_free_plan = (org.plan.value if hasattr(org.plan, "value") else str(org.plan)) == OrgPlan.free.value
    trigger = "manual" if is_free_plan else workflow_cfg.get("trigger_type", "manual")
    schedule = None if is_free_plan else workflow_cfg.get("schedule")

    workflow = Workflow(
        id=str(uuid4()),
        org_id=org.id,
        name=workflow_name,
        description=workflow_cfg.get("description", ""),
        nodes=_single_agent_nodes(agent.id, agent.name),
        edges=[],
        status="draft",
        trigger=trigger,
        schedule=schedule,
        input_template=_render_template(workflow_cfg.get("input_template"), configured_inputs),
        input_variables=workflow_cfg.get("input_variables", []),
        configured_inputs=configured_inputs,
        installed_from_listing_id=listing.id,
        created_by_user_id=user.id,
        execution_mode="sequential",
    )
    db.add(workflow)
    await db.flush()

    return agent, workflow


@router.get("/status", response_model=OnboardingStatusResponse)
async def get_onboarding_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    has_agents = bool(
        await db.scalar(select(func.count(Agent.id)).where(Agent.org_id == ctx.org.id))
    )
    has_integrations = bool(
        await db.scalar(
            select(func.count(UserIntegration.id)).where(
                UserIntegration.org_id == ctx.org.id,
                UserIntegration.is_active == True,  # noqa: E712
            )
        )
    )

    current_step = "completed" if ctx.org.onboarding_completed else (ctx.org.onboarding_step or "company_identity")
    return OnboardingStatusResponse(
        onboarding_completed=bool(ctx.org.onboarding_completed),
        current_step=current_step,
        company_name=ctx.org.name,
        has_agents=has_agents,
        has_integrations=has_integrations,
    )


@router.post("/company")
async def save_company_identity(
    data: CompanyIdentityRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    ctx.org.name = data.company_name
    ctx.org.company_description = data.company_description
    ctx.org.primary_challenge = data.primary_challenge
    ctx.org.onboarding_step = "hire_agent"
    ctx.org.updated_at = datetime.utcnow()

    await _sync_company_profile(
        db,
        current_user,
        ctx.org,
        company_name=data.company_name,
        company_description=data.company_description,
        primary_challenge=data.primary_challenge,
        onboarding_complete=False,
    )

    await db.commit()
    return {"success": True, "next_step": "hire_agent"}


@router.post("/hire-first-agent")
async def hire_first_agent(
    data: HireFirstAgentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    listing = await db.scalar(
        select(MarketplaceListing).where(
            MarketplaceListing.slug == data.listing_slug,
            MarketplaceListing.status == ListingStatus.published,
        )
    )
    if not listing:
        raise HTTPException(status_code=404, detail="Marketplace listing not found")

    ctx.org.competitors = _parse_competitors(data.competitors)
    ctx.org.onboarding_step = "connect_tools"
    ctx.org.updated_at = datetime.utcnow()

    agent, workflow = await _build_market_research_install(
        db=db,
        user=current_user,
        org=ctx.org,
        listing=listing,
        competitors=data.competitors,
        delivery_method=data.delivery_method,
    )

    await db.commit()
    return {
        "agent_id": agent.id,
        "workflow_id": workflow.id,
        "next_step": "connect_tools",
    }


@router.post("/complete")
async def complete_onboarding(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    ctx.org.onboarding_completed = True
    ctx.org.onboarding_step = "completed"
    ctx.org.updated_at = datetime.utcnow()

    await _sync_company_profile(
        db,
        current_user,
        ctx.org,
        company_name=ctx.org.name,
        company_description=ctx.org.company_description or ctx.org.name,
        primary_challenge=ctx.org.primary_challenge,
        onboarding_complete=True,
    )

    execution_count = await db.scalar(
        select(func.count(Execution.id)).where(Execution.org_id == ctx.org.id)
    ) or 0

    await db.commit()

    if execution_count == 0:
        await seed_demo_data(ctx.org.id, db)

    return {"success": True, "redirect": "/dashboard"}


@router.post("/skip")
async def skip_onboarding(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    ctx.org.onboarding_completed = True
    ctx.org.onboarding_step = "completed"
    ctx.org.updated_at = datetime.utcnow()

    await _sync_company_profile(
        db,
        current_user,
        ctx.org,
        company_name=ctx.org.name,
        company_description=ctx.org.company_description or "We are building an AI-native company.",
        primary_challenge=ctx.org.primary_challenge,
        onboarding_complete=True,
    )

    execution_count = await db.scalar(
        select(func.count(Execution.id)).where(Execution.org_id == ctx.org.id)
    ) or 0
    await db.commit()

    if execution_count == 0:
        await seed_demo_data(ctx.org.id, db)

    return {"success": True}

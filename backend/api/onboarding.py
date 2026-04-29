import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import Agent, CompanyProfile, User, Workflow
from services.team_generator import ROLE_TEMPLATES, TeamGeneratorService


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class OnboardingStatusResponse(BaseModel):
    has_agents: bool
    has_workflows: bool
    has_company_profile: bool
    onboarding_complete: bool


class CompanyProfileCreate(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    mission: Optional[str] = None
    industry: Optional[str] = None
    stage: Optional[str] = None
    monthly_revenue: int = Field(default=0, ge=0)
    team_size_goal: Optional[int] = Field(default=None, ge=1)
    primary_tools: list[str] = Field(default_factory=list)


class CompanyProfileResponse(BaseModel):
    id: str
    user_id: str
    company_name: str
    mission: Optional[str]
    industry: Optional[str]
    stage: Optional[str]
    monthly_revenue: int
    runway_months: Optional[int]
    primary_tech_stack: list[str]
    goals: list[str]
    onboarding_complete: bool
    created_at: datetime
    updated_at: Optional[datetime]


class GenerateTeamRequest(BaseModel):
    company_profile_id: str
    selected_roles: list[str] = Field(..., min_length=1)


class GeneratedAgentResponse(BaseModel):
    id: str
    name: str
    role: str
    description: str
    system_prompt: str
    model: str
    tools: list[str]

    model_config = {"from_attributes": True}


def _json_array(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _serialize_profile(profile: CompanyProfile) -> CompanyProfileResponse:
    return CompanyProfileResponse(
        id=profile.id,
        user_id=profile.user_id,
        company_name=profile.company_name,
        mission=profile.mission,
        industry=profile.industry,
        stage=profile.stage,
        monthly_revenue=profile.monthly_revenue or 0,
        runway_months=profile.runway_months,
        primary_tech_stack=_json_array(profile.primary_tech_stack),
        goals=_json_array(profile.goals),
        onboarding_complete=profile.onboarding_complete,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _get_user_profile(db: AsyncSession, user_id: str, org_id: str) -> CompanyProfile | None:
    result = await db.execute(select(CompanyProfile).where(CompanyProfile.user_id == user_id, CompanyProfile.org_id == org_id))
    return result.scalar_one_or_none()


@router.get("/status", response_model=OnboardingStatusResponse)
async def get_onboarding_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    agent_count = await db.scalar(select(func.count(Agent.id)).where(Agent.org_id == ctx.org.id))
    workflow_count = await db.scalar(select(func.count(Workflow.id)).where(Workflow.org_id == ctx.org.id))
    profile = await _get_user_profile(db, current_user.id, ctx.org.id)

    return OnboardingStatusResponse(
        has_agents=bool(agent_count),
        has_workflows=bool(workflow_count),
        has_company_profile=profile is not None,
        onboarding_complete=bool(profile and profile.onboarding_complete),
    )


@router.post("/company-profile", response_model=CompanyProfileResponse, status_code=201)
async def create_company_profile(
    data: CompanyProfileCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    profile = await _get_user_profile(db, current_user.id, ctx.org.id)
    goals = []
    if data.team_size_goal:
        goals.append(f"Build an AI team with {data.team_size_goal} useful roles")

    payload = {
        "company_name": data.company_name,
        "mission": data.mission,
        "industry": data.industry,
        "stage": data.stage,
        "monthly_revenue": data.monthly_revenue,
        "primary_tech_stack": json.dumps(data.primary_tools),
        "goals": json.dumps(goals),
        "updated_at": datetime.utcnow(),
    }

    if profile:
        for field, value in payload.items():
            setattr(profile, field, value)
    else:
        profile = CompanyProfile(
            org_id=ctx.org.id,
            user_id=current_user.id,
            **payload,
        )
        db.add(profile)

    await db.commit()
    await db.refresh(profile)
    return _serialize_profile(profile)


@router.post("/generate-team", response_model=list[GeneratedAgentResponse])
async def generate_team(
    data: GenerateTeamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(CompanyProfile).where(
            CompanyProfile.id == data.company_profile_id,
            CompanyProfile.user_id == current_user.id,
            CompanyProfile.org_id == ctx.org.id,
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")

    unknown_roles = [role for role in data.selected_roles if role not in ROLE_TEMPLATES]
    if unknown_roles:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported roles: {', '.join(unknown_roles)}",
        )

    generator = TeamGeneratorService()
    created_agents = []
    for role in data.selected_roles:
        created_agents.append(await generator.generate_agent_for_role(role, profile, db))

    await db.commit()
    for agent in created_agents:
        await db.refresh(agent)

    return created_agents


@router.post("/complete")
async def complete_onboarding(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    profile = await _get_user_profile(db, current_user.id, ctx.org.id)
    if not profile:
        raise HTTPException(status_code=400, detail="Create a company profile before completing onboarding")

    profile.onboarding_complete = True
    profile.updated_at = datetime.utcnow()
    await db.commit()

    return {"onboarding_complete": True, "redirect": "/"}

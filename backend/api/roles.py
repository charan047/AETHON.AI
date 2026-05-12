from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import Agent, AgentContract, AgentMemoryEntry, AgentRole, AgentTrustScore, Organization, User
from services.agent_memory_service import agent_memory_service
from services.agent_naming_service import agent_naming_service


router = APIRouter(
    dependencies=[Depends(get_current_user), Depends(get_org_context)],
)


ROLE_CONTRACT_DEFAULTS: dict[str, dict] = {
    "sde_1": {
        "forbidden_tools": ["gmail_send", "slack_post"],
        "requires_approval_for": ["production_deploy", "database_migration"],
        "escalates_to_role": "sde_2",
        "escalation_triggers": ["complex_task", "needs_senior_review", "blocked_on_architecture"],
        "requires_review_from": ["sde_2"],
    },
    "sde_2": {
        "forbidden_tools": ["gmail_send"],
        "requires_approval_for": ["production_deploy", "database_migration"],
        "escalates_to_role": "senior_engineer",
        "escalation_triggers": ["complex_task", "security_risk", "architecture_change"],
        "requires_review_from": ["senior_engineer"],
    },
    "senior_engineer": {
        "requires_approval_for": ["production_deploy", "database_migration"],
        "escalates_to_role": "tech_lead",
        "escalation_triggers": ["cross_team_dependency", "platform_risk"],
    },
}


class AssignRoleRequest(BaseModel):
    role_slug: str = Field(..., min_length=1)


class MemoryFeedbackRequest(BaseModel):
    feedback: str = Field(..., min_length=1)
    type: str = Field(..., pattern="^(correction|praise|preference|instruction)$")


async def _get_agent_or_404(agent_id: str, org_id: str, db: AsyncSession) -> Agent:
    agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


async def _get_org_name(org_id: str, db: AsyncSession) -> str:
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    return org.name if org and org.name else "our company"


def _default_contract_payload(role: AgentRole) -> dict:
    role_defaults = ROLE_CONTRACT_DEFAULTS.get(role.slug, {})
    return {
        "responsibilities": [],
        "allowed_tools": role.default_tools or [],
        "forbidden_tools": role_defaults.get("forbidden_tools", []),
        "forbidden_actions": role_defaults.get("forbidden_actions", []),
        "requires_approval_for": role_defaults.get("requires_approval_for", []),
        "escalates_to_role": role_defaults.get("escalates_to_role"),
        "escalation_triggers": role_defaults.get("escalation_triggers", []),
        "max_tokens_per_task": 50000,
        "max_cost_per_task_cents": 100,
        "requires_review_from": role_defaults.get("requires_review_from", []),
        "autonomy_level": role.default_autonomy_level or "supervised",
    }


def _contract_payload(contract: AgentContract | None) -> dict | None:
    if contract is None:
        return None
    return {
        "id": contract.id,
        "agent_id": contract.agent_id,
        "responsibilities": contract.responsibilities or [],
        "allowed_tools": contract.allowed_tools or [],
        "forbidden_tools": contract.forbidden_tools or [],
        "forbidden_actions": contract.forbidden_actions or [],
        "requires_approval_for": contract.requires_approval_for or [],
        "escalates_to_role": contract.escalates_to_role,
        "escalation_triggers": contract.escalation_triggers or [],
        "max_tokens_per_task": contract.max_tokens_per_task,
        "max_cost_per_task_cents": contract.max_cost_per_task_cents,
        "requires_review_from": contract.requires_review_from or [],
        "autonomy_level": contract.autonomy_level,
        "created_at": contract.created_at,
        "updated_at": contract.updated_at,
    }


def _trust_score_payload(score: AgentTrustScore) -> dict:
    return {
        "id": score.id,
        "agent_id": score.agent_id,
        "task_success_rate": score.task_success_rate,
        "review_pass_rate": score.review_pass_rate,
        "cost_efficiency": score.cost_efficiency,
        "on_time_rate": score.on_time_rate,
        "risky_action_rate": score.risky_action_rate,
        "overall_score": score.overall_score,
        "skill_scores": score.skill_scores or {},
        "trajectory": score.trajectory,
        "trajectory_delta": score.trajectory_delta,
        "total_tasks": score.total_tasks,
        "successful_tasks": score.successful_tasks,
        "failed_tasks": score.failed_tasks,
        "total_reviews": score.total_reviews,
        "passed_reviews": score.passed_reviews,
        "risky_actions_attempted": score.risky_actions_attempted,
        "risky_actions_blocked": score.risky_actions_blocked,
        "human_overrides": score.human_overrides,
        "autonomy_history": score.autonomy_history or [],
        "last_calculated": score.last_calculated,
        "created_at": score.created_at,
    }


@router.get("/roles")
async def list_roles(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AgentRole).order_by(AgentRole.seniority_level.asc(), AgentRole.name.asc()))
    roles = result.scalars().all()
    return [
        {
            "id": role.id,
            "name": role.name,
            "slug": role.slug,
            "seniority_level": role.seniority_level,
            "department_type": role.department_type,
            "description": role.description,
            "color": role.color,
            "icon": role.icon,
            "default_tools": role.default_tools or [],
            "default_max_iterations": role.default_max_iterations,
            "default_autonomy_level": role.default_autonomy_level,
            "is_system_role": role.is_system_role,
        }
        for role in roles
    ]


@router.get("/roles/{slug}")
async def get_role(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    role = await db.scalar(select(AgentRole).where(AgentRole.slug == slug))
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return {
        "id": role.id,
        "name": role.name,
        "slug": role.slug,
        "seniority_level": role.seniority_level,
        "department_type": role.department_type,
        "description": role.description,
        "color": role.color,
        "icon": role.icon,
        "default_tools": role.default_tools or [],
        "default_max_iterations": role.default_max_iterations,
        "default_autonomy_level": role.default_autonomy_level,
        "is_system_role": role.is_system_role,
        "default_contract": _default_contract_payload(role),
    }


@router.post("/agents/{agent_id}/assign-role")
async def assign_role(
    agent_id: str,
    data: AssignRoleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    agent = await _get_agent_or_404(agent_id, ctx.org.id, db)
    role = await db.scalar(select(AgentRole).where(AgentRole.slug == data.role_slug))
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    existing_contract = await db.scalar(select(AgentContract).where(AgentContract.agent_id == agent.id))
    if existing_contract:
        raise HTTPException(status_code=409, detail="Agent already has a contract")

    contract_defaults = _default_contract_payload(role)
    contract = AgentContract(
        id=str(uuid4()),
        agent_id=agent.id,
        **contract_defaults,
    )
    trust_score = AgentTrustScore(
        id=str(uuid4()),
        agent_id=agent.id,
        overall_score=50.0,
        autonomy_history=[],
        created_at=datetime.utcnow(),
        last_calculated=datetime.utcnow(),
    )

    agent.role_slug = role.slug
    agent.role = role.name
    agent.seniority_level = role.seniority_level
    agent.autonomy_level = role.default_autonomy_level or "supervised"
    if not agent.tools:
        agent.tools = role.default_tools or []
    agent.updated_at = datetime.utcnow()

    db.add(contract)
    db.add(trust_score)
    await db.commit()
    await db.refresh(agent)

    if agent.persona_name:
        await agent_naming_service.seed_identity_memory(
            agent_id=str(agent.id),
            org_id=str(agent.org_id),
            persona_name=agent.persona_name,
            role_display=agent.role or role.name,
            company_name=await _get_org_name(ctx.org.id, db),
            department_type=role.department_type or "operations",
            db=db,
        )

    return {
        "agent": {
            "id": agent.id,
            "role_slug": agent.role_slug,
            "role": agent.role,
            "seniority_level": agent.seniority_level,
            "autonomy_level": agent.autonomy_level,
            "trust_score": agent.trust_score,
        },
        "contract": _contract_payload(contract),
        "trust_score_record": _trust_score_payload(trust_score),
    }


@router.get("/agents/{agent_id}/contract")
async def get_agent_contract(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_agent_or_404(agent_id, ctx.org.id, db)
    contract = await db.scalar(select(AgentContract).where(AgentContract.agent_id == agent_id))
    if not contract:
        raise HTTPException(status_code=404, detail="Agent contract not found")
    return _contract_payload(contract)


@router.get("/agents/{agent_id}/trust-score")
async def get_agent_trust_score(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_agent_or_404(agent_id, ctx.org.id, db)
    score = await db.scalar(select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id))
    if not score:
        raise HTTPException(status_code=404, detail="Agent trust score not found")
    return _trust_score_payload(score)


@router.get("/agents/{agent_id}/memories")
async def get_agent_memories(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_agent_or_404(agent_id, ctx.org.id, db)
    memories = await agent_memory_service.get_for_display(agent_id, ctx.org.id, db)
    return [
        {
            "id": memory.id,
            "agent_id": memory.agent_id,
            "org_id": memory.org_id,
            "mem0_memory_id": memory.mem0_memory_id,
            "content_preview": memory.content_preview,
            "memory_type": memory.memory_type,
            "tags": memory.tags or [],
            "importance": memory.importance_score,
            "created_at": memory.created_at,
        }
        for memory in memories
    ]


@router.post("/agents/{agent_id}/memories/feedback")
async def store_memory_feedback(
    agent_id: str,
    data: MemoryFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_agent_or_404(agent_id, ctx.org.id, db)
    await agent_memory_service.store_ceo_feedback(
        agent_id=agent_id,
        org_id=ctx.org.id,
        feedback=data.feedback,
        feedback_type=data.type,
        db=db,
    )
    return {"success": True, "recorded_by": current_user.id}

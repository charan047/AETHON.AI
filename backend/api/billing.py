from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import InAppNotification, NotificationPriority, OrgPlan, User
from services.plan_service import PLAN_LIMITS, plan_service


router = APIRouter()


PLAN_PRICING = {
    OrgPlan.free: {"monthly_usd": 0, "label": "Free"},
    OrgPlan.solo: {"monthly_usd": 29, "label": "Solo"},
    OrgPlan.team: {"monthly_usd": 99, "label": "Team"},
    OrgPlan.business: {"monthly_usd": 299, "label": "Business"},
    OrgPlan.enterprise: {"monthly_usd": None, "label": "Enterprise"},
}


class UpgradeRequest(BaseModel):
    target_plan: OrgPlan


def _plan_value(plan):
    return plan.value if hasattr(plan, "value") else str(plan)


def _plan_payload(plan: OrgPlan) -> dict:
    return {
        "plan": plan.value,
        "name": PLAN_PRICING[plan]["label"],
        "monthly_usd": PLAN_PRICING[plan]["monthly_usd"],
        "limits": plan_service.get_limits(plan),
    }


@router.get("/usage")
async def get_usage(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    return await plan_service.get_usage_summary(ctx.org, db)


@router.get("/plan")
async def get_current_plan(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    plan = ctx.org.plan if isinstance(ctx.org.plan, OrgPlan) else OrgPlan(str(ctx.org.plan))
    return {
        "organization": {
            "id": ctx.org.id,
            "name": ctx.org.name,
            "slug": ctx.org.slug,
            "plan": _plan_value(ctx.org.plan),
        },
        "plan": _plan_payload(plan),
        "usage": await plan_service.get_usage_summary(ctx.org, db),
    }


@router.get("/plans")
async def list_plans():
    return [_plan_payload(plan) for plan in PLAN_LIMITS]


@router.post("/upgrade")
async def request_upgrade(
    data: UpgradeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    current_plan = ctx.org.plan if isinstance(ctx.org.plan, OrgPlan) else OrgPlan(str(ctx.org.plan))
    if data.target_plan == current_plan:
        raise HTTPException(status_code=400, detail="You are already on this plan")

    notification = InAppNotification(
        user_id=current_user.id,
        title="Upgrade request received",
        message=(
            f"Upgrade requested for {ctx.org.name}: "
            f"{current_plan.value} → {data.target_plan.value}. We'll contact you within 24 hours."
        ),
        priority=NotificationPriority.normal,
        action_url="/billing",
    )
    db.add(notification)
    await db.commit()
    return {
        "message": "Upgrade requested. We'll contact you within 24 hours.",
        "current_plan": current_plan.value,
        "target_plan": data.target_plan.value,
    }

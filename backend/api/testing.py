from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import OrgPlan, User


router = APIRouter(prefix="/testing", tags=["testing"])


class OrgPlanOverrideRequest(BaseModel):
    plan: OrgPlan


@router.post("/e2e/org-plan")
async def set_e2e_org_plan(
    data: OrgPlanOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    if settings.environment == "production" or (
        settings.environment != "test" and not settings.enable_testing_api
    ):
        raise HTTPException(status_code=404, detail="Not found")

    ctx.org.plan = data.plan
    ctx.org.updated_at = datetime.now(timezone.utc)

    if data.plan == OrgPlan.free:
        ctx.org.max_members = 1
        ctx.org.max_agents = 3
        ctx.org.max_workflows = 5
        ctx.org.max_monthly_executions = 100
        ctx.org.monthly_budget_usd = 10.0
    elif data.plan == OrgPlan.solo:
        ctx.org.max_members = 1
        ctx.org.max_agents = 999
        ctx.org.max_workflows = 999
        ctx.org.max_monthly_executions = 2000
        ctx.org.monthly_budget_usd = 50.0
    elif data.plan == OrgPlan.team:
        ctx.org.max_members = 5
        ctx.org.max_agents = 999999
        ctx.org.max_workflows = 999999
        ctx.org.max_monthly_executions = 10000
        ctx.org.monthly_budget_usd = 200.0
    elif data.plan == OrgPlan.business:
        ctx.org.max_members = 25
        ctx.org.max_agents = 999999
        ctx.org.max_workflows = 999999
        ctx.org.max_monthly_executions = 50000
        ctx.org.monthly_budget_usd = 1000.0
    else:
        ctx.org.max_members = 999999
        ctx.org.max_agents = 999999
        ctx.org.max_workflows = 999999
        ctx.org.max_monthly_executions = 999999
        ctx.org.monthly_budget_usd = 999999.0

    await db.commit()
    await db.refresh(ctx.org)

    return {
        "org_id": ctx.org.id,
        "plan": ctx.org.plan.value if hasattr(ctx.org.plan, "value") else str(ctx.org.plan),
    }

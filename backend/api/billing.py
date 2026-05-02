from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context, require_org_admin
from config import settings
from database import get_db
from database.models import OrgPlan, User
from services.plan_service import PLAN_LIMITS, plan_service
from services.stripe_service import PLAN_TO_PRICE_ID, stripe_service


router = APIRouter()


class SubscribeRequest(BaseModel):
    plan: OrgPlan
    payment_method_id: str


class UpgradeRequest(BaseModel):
    plan: OrgPlan


class CancelRequest(BaseModel):
    immediately: bool = False


def _plan_payload(plan: OrgPlan) -> dict:
    limits = plan_service.get_limits(plan)
    return {
        "plan": plan.value,
        "price_id": PLAN_TO_PRICE_ID.get(plan.value, ""),
        "limits": limits,
        "features": {
            key: value for key, value in limits.items() if isinstance(value, bool)
        },
    }


@router.get("/plans")
async def list_plans():
    return {
        "publishable_key": settings.stripe_publishable_key,
        "plans": [_plan_payload(plan) for plan in PLAN_LIMITS],
    }


@router.get("/subscription")
async def get_subscription(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    return {
        "organization": {
            "id": ctx.org.id,
            "name": ctx.org.name,
            "plan": ctx.org.plan.value if hasattr(ctx.org.plan, "value") else str(ctx.org.plan),
        },
        "subscription": await stripe_service.get_subscription_status(ctx.org),
        "usage": await plan_service.get_usage_summary(ctx.org, db),
    }


@router.get("/plan")
async def get_current_plan(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    return await get_subscription(db=db, ctx=ctx)


@router.get("/usage")
async def get_usage(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    return await plan_service.get_usage_summary(ctx.org, db)


@router.get("/invoices")
async def list_invoices(
    limit: int = Query(default=12, ge=1, le=100),
    ctx: OrgContext = Depends(get_org_context),
):
    return await stripe_service.list_invoices(ctx.org, limit=limit)


@router.get("/upcoming-invoice")
async def get_upcoming_invoice(
    ctx: OrgContext = Depends(get_org_context),
):
    return await stripe_service.get_upcoming_invoice(ctx.org)


@router.post("/setup-intent")
async def create_setup_intent(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
):
    await stripe_service.get_or_create_customer(ctx.org, current_user, db)
    client_secret = await stripe_service.create_setup_intent(ctx.org)
    return {"client_secret": client_secret}


@router.get("/payment-methods")
async def list_payment_methods(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
):
    if not ctx.org.stripe_customer_id:
        await stripe_service.get_or_create_customer(ctx.org, current_user, db)
    return await stripe_service.list_payment_methods(ctx.org)


@router.post("/payment-methods/{payment_method_id}/set-default")
async def set_default_payment_method(
    payment_method_id: str,
    ctx: OrgContext = Depends(require_org_admin),
):
    await stripe_service.set_default_payment_method(ctx.org, payment_method_id)
    return {"updated": True}


@router.delete("/payment-methods/{payment_method_id}")
async def delete_payment_method(
    payment_method_id: str,
    ctx: OrgContext = Depends(require_org_admin),
):
    if not ctx.org.stripe_customer_id:
        raise HTTPException(status_code=400, detail="Organization does not have a Stripe customer")
    await stripe_service.delete_payment_method(payment_method_id)
    return {"deleted": True}


@router.post("/subscribe")
async def subscribe(
    payload: SubscribeRequest,
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.plan == OrgPlan.free:
        raise HTTPException(status_code=400, detail="Use cancel to move back to the free plan")
    await stripe_service.get_or_create_customer(ctx.org, current_user, db)
    return await stripe_service.create_subscription(
        ctx.org,
        payload.plan.value,
        payload.payment_method_id,
        db,
    )


@router.post("/upgrade")
async def upgrade(
    payload: UpgradeRequest,
    ctx: OrgContext = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
):
    if payload.plan == OrgPlan.free:
        raise HTTPException(status_code=400, detail="Use cancel to move back to the free plan")
    return await stripe_service.upgrade_subscription(ctx.org, payload.plan.value, db)


@router.post("/cancel")
async def cancel(
    payload: CancelRequest,
    ctx: OrgContext = Depends(require_org_admin),
    db: AsyncSession = Depends(get_db),
):
    return await stripe_service.cancel_subscription(ctx.org, immediately=payload.immediately, db=db)

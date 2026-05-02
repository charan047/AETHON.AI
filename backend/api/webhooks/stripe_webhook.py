import logging
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from database.models import (
    AuditAction,
    NotificationPriority,
    Organization,
    OrgPlan,
    WebhookEventLog,
)
from services import audit_log_service
from services.plan_service import plan_service
from services.stripe_service import stripe_service
from services.websocket_manager import ws_manager


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/stripe", tags=["webhooks"])


async def _find_org_for_subscription(payload: dict, db: AsyncSession) -> Organization | None:
    metadata = payload.get("metadata") or {}
    org_id = metadata.get("org_id")
    if org_id:
        result = await db.execute(select(Organization).where(Organization.id == org_id))
        org = result.scalar_one_or_none()
        if org:
            return org

    sub_id = payload.get("id")
    if sub_id:
        result = await db.execute(select(Organization).where(Organization.stripe_subscription_id == sub_id))
        org = result.scalar_one_or_none()
        if org:
            return org

    customer_id = payload.get("customer")
    if customer_id:
        result = await db.execute(select(Organization).where(Organization.stripe_customer_id == customer_id))
        return result.scalar_one_or_none()
    return None


async def _find_org_for_invoice(payload: dict, db: AsyncSession) -> Organization | None:
    subscription_id = payload.get("subscription")
    if subscription_id:
        result = await db.execute(select(Organization).where(Organization.stripe_subscription_id == subscription_id))
        org = result.scalar_one_or_none()
        if org:
            return org

    customer_id = payload.get("customer")
    if customer_id:
        result = await db.execute(select(Organization).where(Organization.stripe_customer_id == customer_id))
        return result.scalar_one_or_none()
    return None


async def _apply_plan_sync(org: Organization, plan_value: str | OrgPlan) -> None:
    plan_service.apply_plan_to_org(org, plan_value)
    plan_service.clear_caches(org.id)


async def _handle_subscription_created(payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_subscription(payload, db)
    if not org:
        return
    stripe_service._sync_org_subscription(org, payload, (payload.get("metadata") or {}).get("plan") or org.plan)
    await _apply_plan_sync(org, org.plan)
    await stripe_service.notify_org(
        org,
        "Subscription started",
        f"{org.name} is now on the {org.plan.value if hasattr(org.plan, 'value') else org.plan} plan.",
        action_url="/billing",
        db=db,
    )


async def _handle_subscription_updated(payload: dict, event_payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_subscription(payload, db)
    if not org:
        return

    previous = ((event_payload.get("data") or {}).get("previous_attributes") or {})
    previous_status = previous.get("status")
    stripe_service._sync_org_subscription(org, payload, (payload.get("metadata") or {}).get("plan") or org.plan)
    await _apply_plan_sync(org, org.plan)
    if previous_status == "trialing" and payload.get("status") == "active":
        await stripe_service.notify_org(
            org,
            "Trial ended",
            "Your trial has ended and billing is now active.",
            action_url="/billing",
            db=db,
        )


async def _handle_subscription_deleted(payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_subscription(payload, db)
    if not org:
        return
    await _apply_plan_sync(org, OrgPlan.free)
    org.stripe_subscription_status = "canceled"
    org.cancellation_date = datetime.now(timezone.utc)
    org.stripe_metered_subscription_item_id = None
    await stripe_service.notify_org(
        org,
        "Subscription cancelled",
        "Your subscription has been cancelled and the organization has been downgraded to the free plan.",
        priority=NotificationPriority.urgent,
        action_url="/billing",
        db=db,
    )


async def _handle_invoice_payment_succeeded(payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_invoice(payload, db)
    if not org:
        return
    org.current_period_executions = 0
    await stripe_service.notify_org(
        org,
        "Payment received",
        "Your invoice was paid successfully. A receipt is available in Billing.",
        action_url="/billing",
        db=db,
    )


async def _handle_invoice_payment_failed(payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_invoice(payload, db)
    if not org:
        return

    attempt_count = int(payload.get("attempt_count") or 0)
    await stripe_service.notify_org(
        org,
        "Payment failed",
        "We couldn't process your payment. Please update your payment method to avoid service interruption.",
        priority=NotificationPriority.urgent,
        action_url="/billing",
        db=db,
    )
    await audit_log_service.log(
        AuditAction.billing_payment_failed,
        user_id=org.owner_user_id,
        org_id=org.id,
        resource_type="invoice",
        resource_id=payload.get("id"),
        details={"attempt_count": attempt_count, "status": payload.get("status")},
        db=db,
    )
    if attempt_count >= 3:
        await _apply_plan_sync(org, OrgPlan.free)
        org.stripe_subscription_status = "past_due"
        org.cancellation_date = datetime.now(timezone.utc)


async def _handle_invoice_payment_action_required(payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_invoice(payload, db)
    if not org:
        return
    await stripe_service.notify_org(
        org,
        "Payment action required",
        "Your invoice needs attention. Please update or re-authorize your payment method.",
        priority=NotificationPriority.urgent,
        action_url="/billing",
        db=db,
    )


async def _handle_trial_will_end(payload: dict, db: AsyncSession) -> None:
    org = await _find_org_for_subscription(payload, db)
    if not org:
        return
    message = "Your trial ends in 3 days."
    if not org.stripe_customer_id:
        message += " Add a payment method to continue without interruption."
    await stripe_service.notify_org(
        org,
        "Trial ending soon",
        message,
        action_url="/billing",
        db=db,
    )


EVENT_HANDLERS = {
    "customer.subscription.created": _handle_subscription_created,
    "customer.subscription.updated": _handle_subscription_updated,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.payment_succeeded": _handle_invoice_payment_succeeded,
    "invoice.payment_failed": _handle_invoice_payment_failed,
    "invoice.payment_action_required": _handle_invoice_payment_action_required,
    "customer.subscription.trial_will_end": _handle_trial_will_end,
}


async def _dispatch_event(event_type: str, event_data: dict, db: AsyncSession) -> None:
    handler = EVENT_HANDLERS.get(event_type)
    if not handler:
        return
    payload = (event_data.get("data") or {}).get("object") or {}
    if event_type == "customer.subscription.updated":
        await handler(payload, event_data, db)
        return
    await handler(payload, db)


@router.post("")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=settings.stripe_webhook_secret,
        )
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "Invalid Stripe signature"})

    event_data = event.to_dict_recursive()
    event_id = event_data.get("id")
    event_type = event_data.get("type", "unknown")

    if event_id:
        existing = await db.scalar(select(WebhookEventLog.id).where(WebhookEventLog.event_id == event_id))
        if existing:
            return {"received": True, "duplicate": True}

    event_log = WebhookEventLog(
        source="stripe",
        event_type=event_type,
        event_id=event_id,
        payload=payload.decode("utf-8", errors="replace"),
        processed=False,
    )
    db.add(event_log)
    await db.commit()
    await db.refresh(event_log)

    try:
        await _dispatch_event(event_type, event_data, db)
        event_log.processed = True
        event_log.processing_error = None
        await db.commit()
        await ws_manager.broadcast(
            {
                "type": "stripe_webhook_processed",
                "event_type": event_type,
                "event_id": event_id,
            }
        )
    except Exception as exc:
        logger.exception("Stripe webhook handler failed for event %s", event_id)
        event_log.processed = False
        event_log.processing_error = str(exc)
        await db.commit()

    return {"received": True}

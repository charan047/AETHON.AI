import asyncio
from datetime import datetime, timezone
from typing import Any

import stripe
from fastapi import HTTPException
from stripe.error import StripeError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import InAppNotification, NotificationPriority, Organization, OrgPlan, User
from services.plan_service import plan_service
from services.websocket_manager import ws_manager


stripe.api_key = settings.stripe_secret_key

PLAN_TO_PRICE_ID = {
    OrgPlan.free.value: settings.stripe_free_price_id,
    OrgPlan.solo.value: settings.stripe_solo_price_id,
    OrgPlan.team.value: settings.stripe_team_price_id,
    OrgPlan.business.value: settings.stripe_business_price_id,
    OrgPlan.enterprise.value: settings.stripe_enterprise_price_id,
}


def _timestamp_to_datetime(value: int | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc)


class StripeService:
    def _require_config(self) -> None:
        if not settings.stripe_secret_key:
            raise HTTPException(status_code=503, detail="Stripe is not configured")

    def _normalize_plan(self, plan: str | OrgPlan) -> OrgPlan:
        return plan if isinstance(plan, OrgPlan) else OrgPlan(plan)

    def _price_id_for_plan(self, plan: str | OrgPlan) -> str:
        normalized_plan = self._normalize_plan(plan).value
        price_id = PLAN_TO_PRICE_ID.get(normalized_plan, "")
        if not price_id:
            raise HTTPException(status_code=400, detail=f"Stripe price is not configured for plan '{normalized_plan}'")
        return price_id

    def _sync_org_subscription(self, org: Organization, subscription: Any, plan: str | OrgPlan | None = None) -> None:
        data = subscription.to_dict_recursive() if hasattr(subscription, "to_dict_recursive") else dict(subscription)
        metadata = data.get("metadata") or {}
        resolved_plan = plan or metadata.get("plan") or org.plan
        plan_service.apply_plan_to_org(org, resolved_plan)
        org.stripe_subscription_id = data.get("id")
        org.stripe_subscription_status = data.get("status")
        org.stripe_current_period_end = _timestamp_to_datetime(data.get("current_period_end"))
        org.stripe_trial_end = _timestamp_to_datetime(data.get("trial_end"))
        org.cancellation_date = _timestamp_to_datetime(data.get("cancel_at")) if data.get("cancel_at") else None

        metered_price_id = settings.stripe_metered_execution_price_id
        metered_item_id = None
        for item in ((data.get("items") or {}).get("data") or []):
            price = item.get("price") or {}
            if metered_price_id and price.get("id") == metered_price_id:
                metered_item_id = item.get("id")
                break
        org.stripe_metered_subscription_item_id = metered_item_id

    async def create_customer(self, org: Organization, user: User) -> str:
        self._require_config()
        customer = await asyncio.to_thread(
            stripe.Customer.create,
            email=user.email,
            name=org.name,
            metadata={
                "org_id": org.id,
                "user_id": user.id,
                "platform": "ai-company-os",
            },
        )
        return customer.id

    async def get_or_create_customer(self, org: Organization, user: User, db: AsyncSession) -> str:
        if org.stripe_customer_id:
            return org.stripe_customer_id
        customer_id = await self.create_customer(org, user)
        org.stripe_customer_id = customer_id
        await db.commit()
        await db.refresh(org)
        return customer_id

    async def create_subscription(
        self,
        org: Organization,
        plan: str,
        payment_method_id: str,
        db: AsyncSession,
    ) -> dict:
        self._require_config()
        price_id = self._price_id_for_plan(plan)
        if not org.stripe_customer_id:
            raise HTTPException(status_code=400, detail="Stripe customer has not been created for this organization")

        try:
            await asyncio.to_thread(
                stripe.PaymentMethod.attach,
                payment_method_id,
                customer=org.stripe_customer_id,
            )
            await asyncio.to_thread(
                stripe.Customer.modify,
                org.stripe_customer_id,
                invoice_settings={"default_payment_method": payment_method_id},
            )

            items = [{"price": price_id}]
            if settings.stripe_metered_execution_price_id:
                items.append({"price": settings.stripe_metered_execution_price_id})

            subscription = await asyncio.to_thread(
                stripe.Subscription.create,
                customer=org.stripe_customer_id,
                items=items,
                default_payment_method=payment_method_id,
                metadata={"org_id": org.id, "plan": self._normalize_plan(plan).value},
                trial_period_days=14,
                expand=["latest_invoice.payment_intent"],
            )
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        self._sync_org_subscription(org, subscription, plan)
        await db.commit()
        await db.refresh(org)
        return subscription.to_dict_recursive()

    async def upgrade_subscription(
        self,
        org: Organization,
        new_plan: str,
        db: AsyncSession,
    ) -> dict:
        self._require_config()
        if not org.stripe_subscription_id:
            raise HTTPException(status_code=400, detail="Organization does not have an active Stripe subscription")

        try:
            current = await asyncio.to_thread(
                stripe.Subscription.retrieve,
                org.stripe_subscription_id,
            )
            items = current["items"]["data"]
            base_item = next(
                (
                    item
                    for item in items
                    if item.get("price", {}).get("id") != settings.stripe_metered_execution_price_id
                ),
                items[0],
            )
            subscription = await asyncio.to_thread(
                stripe.Subscription.modify,
                org.stripe_subscription_id,
                items=[{"id": base_item["id"], "price": self._price_id_for_plan(new_plan)}],
                proration_behavior="create_prorations",
                metadata={"org_id": org.id, "plan": self._normalize_plan(new_plan).value},
            )
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        self._sync_org_subscription(org, subscription, new_plan)
        plan_service.clear_caches(org.id)
        await db.commit()
        await db.refresh(org)
        await ws_manager.broadcast(
            {
                "type": "plan_upgraded",
                "org_id": org.id,
                "new_plan": self._normalize_plan(new_plan).value,
            }
        )
        return subscription.to_dict_recursive()

    async def cancel_subscription(
        self,
        org: Organization,
        immediately: bool = False,
        db: AsyncSession | None = None,
    ) -> dict:
        self._require_config()
        if not org.stripe_subscription_id:
            raise HTTPException(status_code=400, detail="Organization does not have an active Stripe subscription")

        try:
            if immediately:
                subscription = await asyncio.to_thread(
                    stripe.Subscription.delete,
                    org.stripe_subscription_id,
                )
                plan_service.apply_plan_to_org(org, OrgPlan.free)
                org.stripe_subscription_status = "canceled"
                org.cancellation_date = datetime.now(timezone.utc)
            else:
                subscription = await asyncio.to_thread(
                    stripe.Subscription.modify,
                    org.stripe_subscription_id,
                    cancel_at_period_end=True,
                )
                data = subscription.to_dict_recursive() if hasattr(subscription, "to_dict_recursive") else dict(subscription)
                org.stripe_subscription_status = data.get("status")
                org.cancellation_date = _timestamp_to_datetime(data.get("current_period_end"))
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if db is not None:
            await db.commit()
            await db.refresh(org)
        return subscription.to_dict_recursive() if hasattr(subscription, "to_dict_recursive") else dict(subscription)

    async def get_subscription_status(self, org: Organization) -> dict:
        self._require_config()
        if not org.stripe_subscription_id:
            return {
                "status": "inactive",
                "current_plan": org.plan.value if hasattr(org.plan, "value") else str(org.plan),
                "current_period_end": None,
                "cancel_at_period_end": False,
                "trial_end": None,
                "next_invoice_amount": None,
            }

        try:
            subscription = await asyncio.to_thread(
                stripe.Subscription.retrieve,
                org.stripe_subscription_id,
            )
            upcoming = None
            if org.stripe_customer_id:
                try:
                    upcoming = await asyncio.to_thread(
                        stripe.Invoice.upcoming,
                        customer=org.stripe_customer_id,
                    )
                except StripeError:
                    upcoming = None
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        data = subscription.to_dict_recursive()
        return {
            "status": data.get("status"),
            "current_plan": (data.get("metadata") or {}).get("plan") or (
                org.plan.value if hasattr(org.plan, "value") else str(org.plan)
            ),
            "current_period_end": _timestamp_to_datetime(data.get("current_period_end")),
            "cancel_at_period_end": bool(data.get("cancel_at_period_end")),
            "trial_end": _timestamp_to_datetime(data.get("trial_end")),
            "next_invoice_amount": (upcoming.amount_due / 100.0) if upcoming else None,
        }

    async def report_execution_usage(self, org: Organization, execution_count: int = 1) -> None:
        self._require_config()
        if not org.stripe_metered_subscription_item_id or execution_count <= 0:
            return
        try:
            await asyncio.to_thread(
                stripe.SubscriptionItem.create_usage_record,
                org.stripe_metered_subscription_item_id,
                quantity=execution_count,
                timestamp="now",
                action="increment",
            )
        except StripeError:
            return

    async def create_setup_intent(self, org: Organization) -> str:
        self._require_config()
        if not org.stripe_customer_id:
            raise HTTPException(status_code=400, detail="Stripe customer has not been created for this organization")
        try:
            intent = await asyncio.to_thread(
                stripe.SetupIntent.create,
                customer=org.stripe_customer_id,
                usage="off_session",
                payment_method_types=["card"],
            )
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return intent.client_secret

    async def list_payment_methods(self, org: Organization) -> list[dict]:
        self._require_config()
        if not org.stripe_customer_id:
            return []
        try:
            payment_methods = await asyncio.to_thread(
                stripe.PaymentMethod.list,
                customer=org.stripe_customer_id,
                type="card",
            )
            customer = await asyncio.to_thread(stripe.Customer.retrieve, org.stripe_customer_id)
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        default_pm = ((customer.get("invoice_settings") or {}).get("default_payment_method"))
        if hasattr(default_pm, "get"):
            default_pm = default_pm.get("id")

        items = []
        for pm in payment_methods.data:
            card = pm.card
            items.append(
                {
                    "id": pm.id,
                    "brand": getattr(card, "brand", None),
                    "last4": getattr(card, "last4", None),
                    "exp_month": getattr(card, "exp_month", None),
                    "exp_year": getattr(card, "exp_year", None),
                    "is_default": pm.id == default_pm,
                }
            )
        return items

    async def set_default_payment_method(self, org: Organization, payment_method_id: str) -> None:
        self._require_config()
        if not org.stripe_customer_id:
            raise HTTPException(status_code=400, detail="Stripe customer has not been created for this organization")
        try:
            await asyncio.to_thread(
                stripe.Customer.modify,
                org.stripe_customer_id,
                invoice_settings={"default_payment_method": payment_method_id},
            )
            if org.stripe_subscription_id:
                await asyncio.to_thread(
                    stripe.Subscription.modify,
                    org.stripe_subscription_id,
                    default_payment_method=payment_method_id,
                )
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def delete_payment_method(self, payment_method_id: str) -> None:
        self._require_config()
        try:
            await asyncio.to_thread(stripe.PaymentMethod.detach, payment_method_id)
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def list_invoices(self, org: Organization, limit: int = 12) -> list[dict]:
        self._require_config()
        if not org.stripe_customer_id:
            return []
        try:
            invoices = await asyncio.to_thread(
                stripe.Invoice.list,
                customer=org.stripe_customer_id,
                limit=limit,
            )
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        return [
            {
                "id": invoice.id,
                "date": _timestamp_to_datetime(invoice.created),
                "amount": invoice.amount_paid / 100.0,
                "status": invoice.status,
                "pdf_url": invoice.invoice_pdf,
            }
            for invoice in invoices.data
        ]

    async def get_upcoming_invoice(self, org: Organization) -> dict:
        self._require_config()
        if not org.stripe_customer_id:
            return {"amount_due": 0.0, "period_end": None, "line_items": []}
        try:
            invoice = await asyncio.to_thread(
                stripe.Invoice.upcoming,
                customer=org.stripe_customer_id,
            )
        except StripeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        return {
            "amount_due": invoice.amount_due / 100.0,
            "period_end": _timestamp_to_datetime(invoice.period_end),
            "line_items": [
                {
                    "description": line.description,
                    "amount": line.amount / 100.0,
                    "quantity": line.quantity,
                }
                for line in invoice.lines.data
            ],
        }

    async def notify_org(self, org: Organization, title: str, message: str, priority: NotificationPriority = NotificationPriority.normal, action_url: str | None = None, db: AsyncSession | None = None) -> None:
        if db is None:
            return
        db.add(
            InAppNotification(
                org_id=org.id,
                user_id=org.owner_user_id,
                title=title,
                message=message,
                priority=priority,
                action_url=action_url,
            )
        )


stripe_service = StripeService()

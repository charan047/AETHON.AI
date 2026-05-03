import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from typing import Optional

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from croniter import croniter
from database.db import get_db
from database.models import User, WebhookEndpoint, Workflow
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.integration_crypto import decrypt_config
from services.webhook_service import WebhookService
from middleware.rate_limit import limiter

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
public_router = APIRouter()
webhook_service = WebhookService()


class ScheduleRequest(BaseModel):
    cron_expression: str


class WebhookCreateRequest(BaseModel):
    workflow_id: str
    name: str
    source: str = "generic"


class WebhookResponse(BaseModel):
    id: str
    workflow_id: str
    name: str
    endpoint_path: str
    source: str
    is_active: bool
    last_triggered_at: Optional[datetime]
    trigger_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


def _preview_cron(expression: str, count: int = 10) -> list[str]:
    try:
        iterator = croniter(expression, datetime.now(timezone.utc))
        return [iterator.get_next(datetime).isoformat() for _ in range(count)]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid cron expression: {expression}") from exc


def _scheduler(request: Request):
    scheduler = getattr(request.app.state, "scheduler", None)
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler is not running")
    return scheduler


@router.get("/triggers/scheduled")
async def list_scheduled_workflows(request: Request):
    return _scheduler(request).get_scheduled_jobs()


@router.put("/workflows/{workflow_id}/schedule")
async def set_workflow_schedule(
    workflow_id: str,
    data: ScheduleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("scheduling", ctx.org, db)
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    next_runs = _preview_cron(data.cron_expression, count=5)
    workflow.schedule = data.cron_expression
    workflow.trigger = "schedule"
    workflow.updated_at = datetime.utcnow()
    await db.commit()
    await _scheduler(request).schedule_workflow(workflow_id, data.cron_expression, current_user.id)
    return {"workflow_id": workflow_id, "cron_expression": data.cron_expression, "next_runs": next_runs}


@router.delete("/workflows/{workflow_id}/schedule")
async def remove_workflow_schedule(
    workflow_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    workflow.schedule = None
    workflow.trigger = "manual"
    workflow.updated_at = datetime.utcnow()
    await db.commit()
    await _scheduler(request).unschedule_workflow(workflow_id)
    return {"workflow_id": workflow_id, "scheduled": False}


@router.get("/triggers/cron/preview")
async def preview_cron(expression: str = Query(...)):
    return {"expression": expression, "next_runs": _preview_cron(expression, count=10)}


@router.get("/triggers/webhooks", response_model=list[WebhookResponse])
async def list_webhooks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.user_id == current_user.id, WebhookEndpoint.org_id == ctx.org.id, WebhookEndpoint.is_active == True)
        .order_by(WebhookEndpoint.created_at.desc())
    )
    return result.scalars().all()


@router.post("/triggers/webhooks", status_code=201)
async def create_webhook(
    data: WebhookCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("webhooks", ctx.org, db)
    workflow_result = await db.execute(select(Workflow).where(Workflow.id == data.workflow_id, Workflow.org_id == ctx.org.id))
    workflow = workflow_result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    try:
        endpoint = await webhook_service.create_webhook(
            workflow_id=data.workflow_id,
            user_id=current_user.id,
            org_id=ctx.org.id,
            source=data.source,
            name=data.name,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    base_url = str(request.base_url).rstrip("/")
    return {
        "id": endpoint.id,
        "workflow_id": endpoint.workflow_id,
        "name": endpoint.name,
        "source": endpoint.source,
        "endpoint_path": endpoint.endpoint_path,
        "webhook_url": f"{base_url}{endpoint.endpoint_path}",
        "signing_secret": getattr(endpoint, "_plain_signing_secret", None),
        "message": "Store this signing secret now. It will not be shown again.",
    }


@router.delete("/triggers/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.user_id == current_user.id,
            WebhookEndpoint.org_id == ctx.org.id,
        )
    )
    endpoint = result.scalar_one_or_none()
    if not endpoint:
        raise HTTPException(status_code=404, detail="Webhook not found")
    endpoint.is_active = False
    await db.commit()


@router.post("/triggers/webhooks/{webhook_id}/test")
async def test_webhook(
    webhook_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.user_id == current_user.id,
            WebhookEndpoint.org_id == ctx.org.id,
            WebhookEndpoint.is_active == True,
        )
    )
    endpoint = result.scalar_one_or_none()
    if not endpoint:
        raise HTTPException(status_code=404, detail="Webhook not found")

    payload = {
        "type": "test",
        "message": "This is a test webhook trigger from Aethon.",
        "webhook_id": webhook_id,
    }
    body = json.dumps(payload).encode("utf-8")
    secret = decrypt_config(endpoint.signing_secret).get("secret", "")
    headers = _signed_test_headers(endpoint.source, body, secret)
    return await webhook_service.process_webhook(endpoint.id, headers, body, db=db)


def _signed_test_headers(source: str, body: bytes, secret: str) -> dict[str, str]:
    if source == "github":
        signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return {"x-github-event": "ping", "x-hub-signature-256": signature}
    if source == "stripe":
        timestamp = str(int(time.time()))
        signed_payload = f"{timestamp}.{body.decode('utf-8')}".encode("utf-8")
        signature = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
        return {"stripe-signature": f"t={timestamp},v1={signature}"}
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return {"x-webhook-signature": signature}


@public_router.post("/webhooks/{endpoint_path}")
@limiter.limit("100/minute")
async def receive_webhook(
    request: Request,
    endpoint_path: str,
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()
    try:
        return await webhook_service.process_webhook(endpoint_path, dict(request.headers), body, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

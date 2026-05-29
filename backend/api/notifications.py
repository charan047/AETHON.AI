from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import InAppNotification, NotificationPreference, User


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    priority: str
    notification_type: str
    is_read: bool
    action_url: str | None
    created_at: datetime | None


class NotificationPreferenceResponse(BaseModel):
    email_on_approval_needed: bool
    email_on_execution_complete: bool
    email_on_autonomy_change: bool
    daily_digest_enabled: bool
    daily_digest_time: str
    notification_email: str | None


class NotificationPreferenceUpdate(BaseModel):
    email_on_approval_needed: bool = True
    email_on_execution_complete: bool = False
    email_on_autonomy_change: bool = True
    daily_digest_enabled: bool = True
    daily_digest_time: str = "08:00"
    notification_email: str | None = None


class NotificationMarkReadRequest(BaseModel):
    notification_ids: list[str] | None = None
    all: bool = False


def _notification_type(notification: InAppNotification) -> str:
    action_url = (notification.action_url or "").lower()
    title = (notification.title or "").lower()
    message = (notification.message or "").lower()
    haystack = f"{title} {message}"

    if "/approvals" in action_url or "approval" in haystack:
        return "approval_request"
    if "/executions" in action_url and ("review" in haystack or "needs review" in haystack):
        return "execution_pending_review"
    if "/files" in action_url or "file" in haystack or "deliverable" in haystack:
        return "file_ready"
    if "/agency-chat" in action_url or "/company-chat" in action_url or "cto update" in title:
        return "cto_update"
    if "/messages" in action_url or "message" in haystack:
        return "message"
    return "default"


def _response(notification: InAppNotification) -> NotificationResponse:
    priority = notification.priority.value if hasattr(notification.priority, "value") else str(notification.priority)
    return NotificationResponse(
        id=notification.id,
        title=notification.title,
        message=notification.message,
        priority=priority,
        notification_type=_notification_type(notification),
        is_read=notification.is_read,
        action_url=notification.action_url,
        created_at=notification.created_at,
    )


def _serialize_preference(pref: NotificationPreference) -> NotificationPreferenceResponse:
    return NotificationPreferenceResponse(
        email_on_approval_needed=bool(pref.email_on_approval_needed),
        email_on_execution_complete=bool(pref.email_on_execution_complete),
        email_on_autonomy_change=bool(pref.email_on_autonomy_change),
        daily_digest_enabled=bool(pref.daily_digest_enabled),
        daily_digest_time=pref.daily_digest_time or "08:00",
        notification_email=pref.notification_email,
    )


async def _get_or_create_preferences(user_id: str, org_id: str, db: AsyncSession) -> NotificationPreference:
    pref = await db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.org_id == org_id,
        )
    )
    if pref:
        return pref
    pref = NotificationPreference(org_id=org_id, user_id=user_id)
    db.add(pref)
    await db.commit()
    await db.refresh(pref)
    return pref


async def _get_notification(notification_id: str, user_id: str, org_id: str, db: AsyncSession) -> InAppNotification:
    result = await db.execute(
        select(InAppNotification).where(
            InAppNotification.id == notification_id,
            InAppNotification.user_id == user_id,
            InAppNotification.org_id == org_id,
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    query = select(InAppNotification).where(
        InAppNotification.user_id == current_user.id,
        InAppNotification.org_id == ctx.org.id,
    )
    if unread_only:
        query = query.where(InAppNotification.is_read == False)  # noqa: E712
    result = await db.execute(query.order_by(InAppNotification.created_at.desc()).limit(limit))
    return [_response(notification) for notification in result.scalars().all()]


@router.post("/mark-read")
async def mark_notifications_read(
    data: NotificationMarkReadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    if data.all:
        result = await db.execute(
            select(InAppNotification).where(
                InAppNotification.user_id == current_user.id,
                InAppNotification.org_id == ctx.org.id,
                InAppNotification.is_read == False,  # noqa: E712
            )
        )
        notifications = result.scalars().all()
        for notification in notifications:
            notification.is_read = True
        await db.commit()
        return {"updated": len(notifications)}

    notification_ids = [item for item in (data.notification_ids or []) if item]
    if not notification_ids:
        raise HTTPException(status_code=400, detail="notification_ids or all=true is required")

    result = await db.execute(
        select(InAppNotification).where(
            InAppNotification.id.in_(notification_ids),
            InAppNotification.user_id == current_user.id,
            InAppNotification.org_id == ctx.org.id,
        )
    )
    notifications = result.scalars().all()
    for notification in notifications:
        notification.is_read = True
    await db.commit()
    return {"updated": len(notifications)}


@router.get("/preferences", response_model=NotificationPreferenceResponse)
async def get_notification_preferences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    pref = await _get_or_create_preferences(current_user.id, ctx.org.id, db)
    return _serialize_preference(pref)


@router.put("/preferences", response_model=NotificationPreferenceResponse)
async def update_notification_preferences(
    data: NotificationPreferenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    pref = await _get_or_create_preferences(current_user.id, ctx.org.id, db)
    pref.email_on_approval_needed = data.email_on_approval_needed
    pref.email_on_execution_complete = data.email_on_execution_complete
    pref.email_on_autonomy_change = data.email_on_autonomy_change
    pref.daily_digest_enabled = data.daily_digest_enabled
    pref.daily_digest_time = data.daily_digest_time
    pref.notification_email = data.notification_email
    await db.commit()
    await db.refresh(pref)
    return _serialize_preference(pref)


@router.get("/count")
async def notification_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    unread = await db.scalar(
        select(func.count(InAppNotification.id)).where(
            InAppNotification.user_id == current_user.id,
            InAppNotification.org_id == ctx.org.id,
            InAppNotification.is_read == False,  # noqa: E712
        )
    )
    return {"unread": unread or 0}


@router.get("/unread-count")
async def notification_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    unread = await db.scalar(
        select(func.count(InAppNotification.id)).where(
            InAppNotification.user_id == current_user.id,
            InAppNotification.org_id == ctx.org.id,
            InAppNotification.is_read == False,  # noqa: E712
        )
    )
    return {"count": int(unread or 0)}


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    notification = await _get_notification(notification_id, current_user.id, ctx.org.id, db)
    notification.is_read = True
    await db.commit()
    await db.refresh(notification)
    return _response(notification)


@router.post("/read-all")
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(InAppNotification).where(
            InAppNotification.user_id == current_user.id,
            InAppNotification.org_id == ctx.org.id,
            InAppNotification.is_read == False,  # noqa: E712
        )
    )
    notifications = result.scalars().all()
    for notification in notifications:
        notification.is_read = True
    await db.commit()
    return {"updated": len(notifications)}


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    notification = await _get_notification(notification_id, current_user.id, ctx.org.id, db)
    await db.delete(notification)
    await db.commit()

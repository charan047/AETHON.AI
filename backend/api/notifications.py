from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import InAppNotification, User


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    priority: str
    is_read: bool
    action_url: str | None
    created_at: datetime | None


def _response(notification: InAppNotification) -> NotificationResponse:
    priority = notification.priority.value if hasattr(notification.priority, "value") else str(notification.priority)
    return NotificationResponse(
        id=notification.id,
        title=notification.title,
        message=notification.message,
        priority=priority,
        is_read=notification.is_read,
        action_url=notification.action_url,
        created_at=notification.created_at,
    )


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
    unread_only: bool = Query(default=True),
    limit: int = Query(default=20, ge=1, le=100),
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

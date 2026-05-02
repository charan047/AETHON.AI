from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import require_admin
from database import get_db
from database.models import AuditAction, AuditLog, User


router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


@router.get("")
async def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: AuditAction | None = None,
    org_id: str | None = None,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    conditions = []
    if action:
        conditions.append(AuditLog.action == action)
    if org_id:
        conditions.append(AuditLog.org_id == org_id)
    if user_id:
        conditions.append(AuditLog.user_id == user_id)

    total = await db.scalar(select(func.count(AuditLog.id)).where(*conditions)) or 0
    result = await db.execute(
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    items = result.scalars().all()
    return {
        "items": [
            {
                "id": item.id,
                "user_id": item.user_id,
                "org_id": item.org_id,
                "action": _enum_value(item.action),
                "resource_type": item.resource_type,
                "resource_id": item.resource_id,
                "ip_address": item.ip_address,
                "user_agent": item.user_agent,
                "details": item.details,
                "created_at": item.created_at,
            }
            for item in items
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }

import enum
import json

from database.db import AsyncSessionLocal
from database.models import AuditAction, AuditLog


async def log(
    action: AuditAction | str,
    user_id: str | None = None,
    org_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    request=None,
    details: dict | None = None,
    db=None,
):
    owns_session = db is None
    if owns_session:
        db = AsyncSessionLocal()

    try:
        normalized_action = action if isinstance(action, AuditAction) else AuditAction(action)
        entry = AuditLog(
            user_id=user_id,
            org_id=org_id,
            action=normalized_action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            details=json.dumps(details, default=str) if details else None,
        )
        db.add(entry)
        await db.commit()
        return entry
    finally:
        if owns_session:
            await db.close()

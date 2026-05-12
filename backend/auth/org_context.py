from pydantic import BaseModel, ConfigDict
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from database.db import get_db
from database.models import OrgMember, OrgMemberRole, Organization, User


class OrgContext(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    org: Organization
    member: OrgMember
    effective_role: OrgMemberRole


async def get_org_context(
    org_id: str | None = Header(None, alias="X-Org-Id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrgContext:
    if org_id:
        result = await db.execute(
            select(Organization, OrgMember)
            .join(OrgMember, OrgMember.org_id == Organization.id)
            .where(
                Organization.id == org_id,
                Organization.is_active == True,  # noqa: E712
                OrgMember.user_id == current_user.id,
            )
        )
    else:
        result = await db.execute(
            select(Organization, OrgMember)
            .join(OrgMember, OrgMember.org_id == Organization.id)
            .where(
                Organization.is_active == True,  # noqa: E712
                OrgMember.user_id == current_user.id,
            )
            .order_by(
                (OrgMember.role == OrgMemberRole.owner).desc(),
                OrgMember.joined_at.asc(),
            )
            .limit(1)
        )

    row = result.one_or_none()
    if not row:
        detail = "Not a member of this organization" if org_id else "No organization membership found"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    org, member = row
    role = member.role if isinstance(member.role, OrgMemberRole) else OrgMemberRole(member.role)
    return OrgContext(org=org, member=member, effective_role=role)


async def require_org_admin(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
    if ctx.effective_role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization admin access required",
        )
    return ctx


async def require_org_owner(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
    if ctx.effective_role != OrgMemberRole.owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization owner access required",
        )
    return ctx


async def check_plan_limit(resource: str, org: Organization, db: AsyncSession) -> None:
    return

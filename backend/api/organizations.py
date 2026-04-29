import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import get_org_context, require_org_admin, require_org_owner
from database.db import get_db
from database.models import OrgInvite, OrgMember, OrgMemberRole, OrgPlan, Organization, User


router = APIRouter()


class OrganizationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str | None = Field(default=None, max_length=100)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    timezone: str | None = Field(default=None, max_length=50)
    logo_url: str | None = Field(default=None, max_length=500)


class InviteCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    role: OrgMemberRole = OrgMemberRole.member


class RoleUpdate(BaseModel):
    role: OrgMemberRole


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug or "organization")[:100]


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = _slugify(base)
    candidate = slug
    suffix = 2
    while await db.scalar(select(Organization.id).where(Organization.slug == candidate)):
        candidate = f"{slug[:90]}-{suffix}"
        suffix += 1
    return candidate


def _org_payload(org: Organization, role: OrgMemberRole | str | None = None, member_count: int | None = None) -> dict:
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "plan": _enum_value(org.plan),
        "owner_user_id": org.owner_user_id,
        "max_members": org.max_members,
        "max_agents": org.max_agents,
        "max_workflows": org.max_workflows,
        "max_monthly_executions": org.max_monthly_executions,
        "billing_email": org.billing_email,
        "monthly_budget_usd": org.monthly_budget_usd,
        "current_period_executions": org.current_period_executions,
        "timezone": org.timezone,
        "logo_url": org.logo_url,
        "custom_domain": org.custom_domain,
        "is_active": org.is_active,
        "created_at": org.created_at,
        "updated_at": org.updated_at,
        "role": _enum_value(role) if role else None,
        "member_count": member_count,
    }


def _member_payload(member: OrgMember, user: User | None = None) -> dict:
    return {
        "id": member.id,
        "org_id": member.org_id,
        "user_id": member.user_id,
        "email": user.email if user else None,
        "full_name": user.full_name if user else None,
        "role": _enum_value(member.role),
        "invited_by_user_id": member.invited_by_user_id,
        "joined_at": member.joined_at,
    }


async def _get_org_member_or_403(org_id: str, user_id: str, db: AsyncSession) -> tuple[Organization, OrgMember]:
    result = await db.execute(
        select(Organization, OrgMember)
        .join(OrgMember, OrgMember.org_id == Organization.id)
        .where(
            Organization.id == org_id,
            Organization.is_active == True,  # noqa: E712
            OrgMember.user_id == user_id,
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    return row


async def _members_for_org(org_id: str, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(OrgMember, User)
        .join(User, OrgMember.user_id == User.id)
        .where(OrgMember.org_id == org_id)
        .order_by(OrgMember.joined_at.asc())
    )
    return [_member_payload(member, user) for member, user in result.all()]


@router.get("/organizations/me")
async def my_organizations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Organization, OrgMember)
        .join(OrgMember, OrgMember.org_id == Organization.id)
        .where(OrgMember.user_id == current_user.id, Organization.is_active == True)  # noqa: E712
        .order_by(OrgMember.joined_at.asc())
    )
    rows = result.all()
    payload = []
    for org, member in rows:
        count = await db.scalar(select(func.count(OrgMember.id)).where(OrgMember.org_id == org.id)) or 0
        payload.append(_org_payload(org, role=member.role, member_count=count))
    return payload


@router.post("/organizations", status_code=201)
async def create_organization(
    data: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_count = await db.scalar(
        select(func.count(OrgMember.id)).where(OrgMember.user_id == current_user.id)
    ) or 0
    if org_count >= 3:
        raise HTTPException(status_code=429, detail="Free users can create up to 3 organizations")

    org = Organization(
        id=str(uuid.uuid4()),
        name=data.name,
        slug=await _unique_slug(db, data.slug or data.name),
        plan=OrgPlan.free,
        owner_user_id=current_user.id,
        billing_email=current_user.email,
    )
    member = OrgMember(
        id=str(uuid.uuid4()),
        org_id=org.id,
        user_id=current_user.id,
        role=OrgMemberRole.owner,
    )
    db.add(org)
    db.add(member)
    await db.commit()
    await db.refresh(org)
    return _org_payload(org, role=OrgMemberRole.owner, member_count=1)


@router.get("/organizations/{org_id}")
async def get_organization(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    payload = _org_payload(org, role=member.role)
    payload["members"] = await _members_for_org(org_id, db)
    payload["member_count"] = len(payload["members"])
    return payload


@router.put("/organizations/{org_id}")
async def update_organization(
    org_id: str,
    data: OrganizationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(org, field, value)
    org.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(org)
    return _org_payload(org, role=member.role)


@router.get("/organizations/{org_id}/members")
async def list_members(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_org_member_or_403(org_id, current_user.id, db)
    return await _members_for_org(org_id, db)


@router.post("/organizations/{org_id}/invites", status_code=201)
async def create_invite(
    org_id: str,
    data: InviteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")

    invite = OrgInvite(
        id=str(uuid.uuid4()),
        org_id=org_id,
        email=data.email.lower(),
        role=data.role,
        token=secrets.token_urlsafe(32),
        invited_by_user_id=current_user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return {
        "id": invite.id,
        "email": invite.email,
        "role": _enum_value(invite.role),
        "expires_at": invite.expires_at,
        "invite_url": f"https://platform.com/invite/{invite.token}",
    }


@router.get("/invites/{token}")
async def get_invite(
    invite_token: str = Path(..., alias="token"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OrgInvite, Organization, User)
        .join(Organization, OrgInvite.org_id == Organization.id)
        .join(User, OrgInvite.invited_by_user_id == User.id)
        .where(OrgInvite.token == invite_token)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite, org, inviter = row
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invite already accepted")
    if invite.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")
    return {
        "org_name": org.name,
        "org_slug": org.slug,
        "email": invite.email,
        "role": _enum_value(invite.role),
        "inviter_name": inviter.full_name or inviter.email,
        "expires_at": invite.expires_at,
    }


@router.post("/invites/{token}/accept")
async def accept_invite(
    invite_token: str = Path(..., alias="token"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite = await db.scalar(select(OrgInvite).where(OrgInvite.token == invite_token))
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invite already accepted")
    if invite.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite expired")
    if invite.email.lower() != current_user.email.lower():
        raise HTTPException(status_code=403, detail="Invite email does not match current user")

    existing = await db.scalar(
        select(OrgMember).where(OrgMember.org_id == invite.org_id, OrgMember.user_id == current_user.id)
    )
    if not existing:
        db.add(
            OrgMember(
                id=str(uuid.uuid4()),
                org_id=invite.org_id,
                user_id=current_user.id,
                role=invite.role,
                invited_by_user_id=invite.invited_by_user_id,
            )
        )
    invite.accepted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"accepted": True, "org_id": invite.org_id}


@router.delete("/organizations/{org_id}/members/{user_id}", status_code=204)
async def remove_member(
    org_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    if user_id == org.owner_user_id:
        raise HTTPException(status_code=400, detail="Cannot remove the organization owner")
    target = await db.scalar(select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user_id))
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.delete(target)
    await db.commit()


@router.put("/organizations/{org_id}/members/{user_id}/role")
async def change_member_role(
    org_id: str,
    user_id: str,
    data: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role != OrgMemberRole.owner:
        raise HTTPException(status_code=403, detail="Only the owner can change member roles")
    if user_id == org.owner_user_id:
        raise HTTPException(status_code=400, detail="Cannot change the owner's role")
    target = await db.scalar(select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user_id))
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    target.role = data.role
    await db.commit()
    await db.refresh(target)
    return _member_payload(target, await db.get(User, user_id))

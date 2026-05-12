import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import get_org_context, require_org_admin, require_org_owner
from database.db import get_db
from database.seed_models import seed_org_default_model
from database.models import AuditAction, OrgInvite, OrgMember, OrgMemberRole, Organization, User
from services import audit_log_service
from utils.sanitize import validate_url


router = APIRouter()


class OrganizationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str | None = Field(default=None, max_length=100)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    slug: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = Field(default=None, max_length=50)
    logo_url: str | None = Field(default=None, max_length=500)
    agent_message_retention_days: int | None = Field(default=None)


class InviteCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    role: OrgMemberRole = OrgMemberRole.member
    message: str | None = Field(default=None, max_length=1000)


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
        "monthly_budget_usd": org.monthly_budget_usd,
        "current_period_executions": org.current_period_executions,
        "timezone": org.timezone,
        "logo_url": org.logo_url,
        "agent_message_retention_days": org.agent_message_retention_days,
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
        "last_active_at": user.updated_at or user.created_at if user else None,
    }


def _invite_payload(invite: OrgInvite, inviter: User | None = None) -> dict:
    return {
        "id": invite.id,
        "org_id": invite.org_id,
        "email": invite.email,
        "role": _enum_value(invite.role),
        "token": invite.token,
        "invited_by_user_id": invite.invited_by_user_id,
        "invited_by": inviter.full_name or inviter.email if inviter else None,
        "accepted_at": invite.accepted_at,
        "created_at": invite.created_at,
        "expires_at": invite.expires_at,
        "invite_url": f"/invite/{invite.token}",
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
    member_count_sq = (
        select(
            OrgMember.org_id,
            func.count(OrgMember.id).label("member_count"),
        )
        .group_by(OrgMember.org_id)
        .subquery()
    )

    result = await db.execute(
        select(
            Organization,
            OrgMember.role,
            func.coalesce(member_count_sq.c.member_count, 0).label("member_count"),
        )
        .join(OrgMember, OrgMember.org_id == Organization.id)
        .outerjoin(member_count_sq, member_count_sq.c.org_id == Organization.id)
        .where(OrgMember.user_id == current_user.id, Organization.is_active == True)  # noqa: E712
        .order_by(OrgMember.joined_at.asc())
    )
    rows = result.all()
    return [
        _org_payload(org, role=role, member_count=member_count)
        for org, role, member_count in rows
    ]


@router.post("/organizations", status_code=201)
async def create_organization(
    data: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = Organization(
        id=str(uuid.uuid4()),
        name=data.name,
        slug=await _unique_slug(db, data.slug or data.name),
        plan="open_source",
        owner_user_id=current_user.id,
    )
    db.add(org)
    await db.flush()
    member = OrgMember(
        id=str(uuid.uuid4()),
        org_id=org.id,
        user_id=current_user.id,
        role=OrgMemberRole.owner,
    )
    db.add(member)
    await db.commit()
    await seed_org_default_model(org.id, db)
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
    updates = data.model_dump(exclude_unset=True)
    if "agent_message_retention_days" in updates:
        value = updates["agent_message_retention_days"]
        if value is not None and value not in {7, 30, 45}:
            raise HTTPException(status_code=400, detail="Retention must be 7, 30, or 45 days")
    if "logo_url" in updates and not validate_url(updates["logo_url"]):
        raise HTTPException(status_code=400, detail="Invalid logo URL")
    owner_only_fields = {"name", "slug", "logo_url"}
    if owner_only_fields.intersection(updates) and member.role != OrgMemberRole.owner:
        raise HTTPException(status_code=403, detail="Only the organization owner can update identity settings")
    if "slug" in updates:
        next_slug = _slugify(updates.pop("slug"))
        existing = await db.scalar(select(Organization.id).where(Organization.slug == next_slug, Organization.id != org_id))
        if existing:
            raise HTTPException(status_code=400, detail="Organization slug is already taken")
        org.slug = next_slug
    for field, value in updates.items():
        setattr(org, field, value)
    org.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(org)
    return _org_payload(org, role=member.role)


@router.delete("/organizations/{org_id}", status_code=204)
async def delete_organization(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role != OrgMemberRole.owner:
        raise HTTPException(status_code=403, detail="Only the organization owner can delete this organization")
    org.is_active = False
    org.updated_at = datetime.now(timezone.utc)
    await db.commit()


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
    if data.role == OrgMemberRole.owner:
        raise HTTPException(status_code=400, detail="Cannot invite a member as owner")

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
    return _invite_payload(invite, current_user)


@router.get("/organizations/{org_id}/invites")
async def list_invites(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    result = await db.execute(
        select(OrgInvite, User)
        .join(User, OrgInvite.invited_by_user_id == User.id)
        .where(
            OrgInvite.org_id == org.id,
            OrgInvite.accepted_at.is_(None),
            OrgInvite.expires_at > datetime.now(timezone.utc),
        )
        .order_by(OrgInvite.created_at.desc())
    )
    return [_invite_payload(invite, inviter) for invite, inviter in result.all()]


@router.post("/organizations/{org_id}/invites/{invite_id}/resend")
async def resend_invite(
    org_id: str,
    invite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    invite = await db.scalar(select(OrgInvite).where(OrgInvite.id == invite_id, OrgInvite.org_id == org.id))
    if not invite or invite.accepted_at:
        raise HTTPException(status_code=404, detail="Pending invite not found")
    invite.token = secrets.token_urlsafe(32)
    invite.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.commit()
    await db.refresh(invite)
    return _invite_payload(invite, await db.get(User, invite.invited_by_user_id))


@router.delete("/organizations/{org_id}/invites/{invite_id}", status_code=204)
async def revoke_invite(
    org_id: str,
    invite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    invite = await db.scalar(select(OrgInvite).where(OrgInvite.id == invite_id, OrgInvite.org_id == org.id))
    if not invite or invite.accepted_at:
        raise HTTPException(status_code=404, detail="Pending invite not found")
    await db.delete(invite)
    await db.commit()


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
        "org_id": org.id,
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
    org = await db.get(Organization, invite.org_id)
    return {"accepted": True, "org_id": invite.org_id, "org_name": org.name if org else None}


@router.delete("/organizations/{org_id}/members/{user_id}", status_code=204)
async def remove_member(
    org_id: str,
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot remove yourself")
    if user_id == org.owner_user_id:
        raise HTTPException(status_code=400, detail="Cannot remove the organization owner")
    target = await db.scalar(select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user_id))
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    removed_role = _enum_value(target.role)
    await db.delete(target)
    await db.commit()
    await audit_log_service.log(
        AuditAction.org_member_removed,
        user_id=current_user.id,
        org_id=org_id,
        resource_type="org_member",
        resource_id=user_id,
        request=request,
        details={"removed_user_id": user_id, "role": removed_role},
        db=db,
    )


@router.put("/organizations/{org_id}/members/{user_id}/role")
async def change_member_role(
    org_id: str,
    user_id: str,
    data: RoleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org, member = await _get_org_member_or_403(org_id, current_user.id, db)
    if member.role not in (OrgMemberRole.owner, OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Organization admin access required")
    if user_id == org.owner_user_id:
        raise HTTPException(status_code=400, detail="Cannot change the owner's role")
    target = await db.scalar(select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user_id))
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role != OrgMemberRole.owner and (target.role == OrgMemberRole.admin or data.role == OrgMemberRole.admin):
        raise HTTPException(status_code=403, detail="Only the owner can change admin roles")
    if data.role == OrgMemberRole.owner:
        raise HTTPException(status_code=400, detail="Ownership transfer is not supported here")
    previous_role = _enum_value(target.role)
    target.role = data.role
    await db.commit()
    await db.refresh(target)
    await audit_log_service.log(
        AuditAction.org_member_role_changed,
        user_id=current_user.id,
        org_id=org_id,
        resource_type="org_member",
        resource_id=user_id,
        request=request,
        details={"previous_role": previous_role, "new_role": _enum_value(data.role)},
        db=db,
    )
    return _member_payload(target, await db.get(User, user_id))

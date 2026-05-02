from typing import Optional
import re
import uuid

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from auth.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_api_key,
    hash_password,
    verify_password,
)
from config import settings
from database.db import get_db
from database.seed_models import seed_org_default_model
from database.models import ApiKey, AuditAction, OrgMember, OrgMemberRole, OrgPlan, Organization, User, UserRole
from middleware.rate_limit import limiter
from services import audit_log_service


router = APIRouter(prefix="/auth", tags=["auth"])


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "my-company"


async def _unique_org_slug(db: AsyncSession, email: str) -> str:
    base = _slugify(email.split("@")[0])[:80]
    candidate = base
    suffix = 2
    while await db.scalar(select(Organization.id).where(Organization.slug == candidate)):
        candidate = f"{base[:70]}-{suffix}"
        suffix += 1
    return candidate


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    email: str


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key="refresh_token", path="/")


def _token_response_for_user(user: User) -> TokenResponse:
    access = create_access_token(user_id=user.id, role=str(user.role.value if hasattr(user.role, "value") else user.role))
    refresh = create_refresh_token(user_id=user.id)
    role_str = str(user.role.value if hasattr(user.role, "value") else user.role)
    return TokenResponse(access_token=access, refresh_token=refresh, user_id=user.id, role=role_str, email=user.email)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    if len(payload.password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalars().first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    total_users_result = await db.execute(select(func.count(User.id)))
    total_users = int(total_users_result.scalar() or 0)
    role = UserRole.admin if total_users == 0 else UserRole.editor

    user = User(
        email=str(payload.email).lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    org = Organization(
        id=str(uuid.uuid4()),
        name="My Company",
        slug=await _unique_org_slug(db, user.email),
        plan=OrgPlan.free,
        owner_user_id=user.id,
        billing_email=user.email,
    )
    db.add(org)
    await db.flush()
    member = OrgMember(
        id=str(uuid.uuid4()),
        org_id=org.id,
        user_id=user.id,
        role=OrgMemberRole.owner,
    )
    db.add(member)
    await db.commit()
    await seed_org_default_model(org.id, db)
    await db.refresh(user)
    await audit_log_service.log(
        AuditAction.user_registered,
        user_id=user.id,
        org_id=org.id,
        resource_type="user",
        resource_id=user.id,
        request=request,
        details={"email": user.email},
        db=db,
    )
    tokens = _token_response_for_user(user)
    _set_refresh_cookie(response, tokens.refresh_token)
    return tokens


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    invalid_msg = "Invalid email or password"

    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalars().first()
    if not user or not verify_password(payload.password, user.hashed_password):
        await audit_log_service.log(
            AuditAction.user_login_failed,
            request=request,
            details={"email": str(payload.email).lower()},
            db=db,
        )
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": invalid_msg},
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        await audit_log_service.log(
            AuditAction.user_login_failed,
            user_id=user.id,
            request=request,
            details={"email": user.email, "reason": "disabled"},
            db=db,
        )
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "User account is disabled"},
        )

    tokens = _token_response_for_user(user)
    org_id = await db.scalar(select(OrgMember.org_id).where(OrgMember.user_id == user.id).limit(1))
    await audit_log_service.log(
        AuditAction.user_login,
        user_id=user.id,
        org_id=org_id,
        resource_type="user",
        resource_id=user.id,
        request=request,
        details={"email": user.email},
        db=db,
    )
    _set_refresh_cookie(response, tokens.refresh_token)
    return tokens


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    payload: RefreshRequest | None = None,
    refresh_cookie: Optional[str] = Cookie(default=None, alias="refresh_token"),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    token = (payload.refresh_token if payload else None) or refresh_cookie
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    try:
        token_payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    if token_payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = token_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is disabled")

    tokens = _token_response_for_user(user)
    _set_refresh_cookie(response, tokens.refresh_token)
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> Response:
    _clear_refresh_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/api-keys")
async def create_api_key(
    name: str = Query(..., min_length=1, max_length=100),
    request: Request = None,
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await check_plan_limit("api_keys", ctx.org, db)
    raw_key, key_hash, key_prefix = generate_api_key()
    api_key = ApiKey(
        org_id=ctx.org.id,
        user_id=current_user.id,
        name=name,
        key_hash=key_hash,
        key_prefix=key_prefix,
        is_active=True,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    await audit_log_service.log(
        AuditAction.api_key_created,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="api_key",
        resource_id=api_key.id,
        request=request,
        details={"name": api_key.name, "prefix": api_key.key_prefix},
        db=db,
    )
    return {
        "api_key": raw_key,
        "message": "Save this key — it will not be shown again",
        "id": api_key.id,
        "prefix": api_key.key_prefix,
        "name": api_key.name,
    }


@router.get("/api-keys")
async def list_api_keys(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(ApiKey)
        .where(and_(ApiKey.user_id == current_user.id, ApiKey.org_id == ctx.org.id, ApiKey.is_active == True))  # noqa: E712
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return [
        {
            "id": k.id,
            "name": k.name,
            "prefix": k.key_prefix,
            "last_used_at": k.last_used_at,
            "created_at": k.created_at,
        }
        for k in keys
    ]


@router.delete("/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(
        select(ApiKey).where(and_(ApiKey.id == key_id, ApiKey.user_id == current_user.id, ApiKey.org_id == ctx.org.id))
    )
    api_key = result.scalars().first()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    api_key.is_active = False
    await db.commit()
    await audit_log_service.log(
        AuditAction.api_key_revoked,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="api_key",
        resource_id=api_key.id,
        request=request,
        details={"name": api_key.name, "prefix": api_key.key_prefix},
        db=db,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

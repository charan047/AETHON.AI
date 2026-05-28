import json
import smtplib
import secrets
import asyncio
import base64
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from config import settings
from database import get_db
from database.models import IntegrationType, User, UserIntegration
from services.integration_crypto import decrypt_config, encrypt_config
from services.integration_support import (
    is_supported_integration_type,
    unsupported_integration_note,
)
from tools.registry import tool_registry


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class IntegrationResponse(BaseModel):
    id: str
    integration_type: str
    name: str
    connected_account: str | None = None
    is_supported: bool = True
    support_note: str | None = None
    needs_reauth: bool = False
    reauth_reason: str | None = None
    is_active: bool
    last_tested_at: datetime | None
    last_test_result: str | None
    created_at: datetime | None
    default_repo: str | None = None


class GitHubIntegrationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    access_token: str = Field(..., min_length=1)
    default_repo: str = ""


class EmailIntegrationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    smtp_host: str
    smtp_port: int = 587
    smtp_user: str
    smtp_password: str
    imap_host: str
    imap_port: int = 993
    from_name: str = ""


class SearchIntegrationCreate(BaseModel):
    name: str = Field("Agency Search", min_length=1, max_length=100)
    provider: str = Field(..., min_length=1, max_length=20)
    api_key: str = Field(..., min_length=1)


class OAuthCallbackRequest(BaseModel):
    code: str = Field(..., min_length=1)
    state: str = Field(..., min_length=1)


_OAUTH_STATE_PREFIX = "aethon:oauth:state:"
_OAUTH_STATE_TTL_SECONDS = 600
_GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]
_SLACK_SCOPES = ["chat:write", "channels:read", "im:read", "im:write"]


def _safe_response(integration: UserIntegration) -> IntegrationResponse:
    default_repo = None
    connected_account = None
    needs_reauth = False
    reauth_reason = None
    is_supported = is_supported_integration_type(integration.integration_type)
    support_note = None if is_supported else unsupported_integration_note(integration.integration_type)
    if integration.integration_type == IntegrationType.github:
        try:
            default_repo = decrypt_config(integration.config).get("default_repo")
        except Exception:
            default_repo = None
    elif integration.integration_type in {IntegrationType.gmail, IntegrationType.slack}:
        try:
            config = decrypt_config(integration.config)
            connected_account = config.get("email") or config.get("workspace") or config.get("workspace_url")
            if integration.integration_type == IntegrationType.gmail:
                granted_scopes = config.get("granted_scopes")
                if granted_scopes is None:
                    granted_scopes = config.get("scopes")
                if isinstance(granted_scopes, str):
                    granted_scopes = granted_scopes.split()
                required_scopes = {
                    "https://www.googleapis.com/auth/drive.file",
                    "https://www.googleapis.com/auth/spreadsheets",
                }
                if not granted_scopes or not required_scopes.issubset(set(granted_scopes)):
                    needs_reauth = True
                    reauth_reason = "Google Docs and Sheets require updated permissions"
        except Exception:
            connected_account = None
    elif integration.integration_type == IntegrationType.search_api:
        try:
            config = decrypt_config(integration.config)
            connected_account = config.get("provider")
        except Exception:
            connected_account = None
    return IntegrationResponse(
        id=integration.id,
        integration_type=integration.integration_type.value,
        name=integration.name,
        connected_account=connected_account,
        is_supported=is_supported,
        support_note=support_note,
        needs_reauth=needs_reauth,
        reauth_reason=reauth_reason,
        is_active=integration.is_active,
        last_tested_at=integration.last_tested_at,
        last_test_result=integration.last_test_result,
        created_at=integration.created_at,
        default_repo=default_repo,
    )


async def _validate_github_token(access_token: str) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
        if response.status_code >= 400:
            return False, f"GitHub validation failed ({response.status_code})"
        return True, "success"
    except Exception as exc:
        return False, str(exc)


def _test_email_config(config: dict) -> tuple[bool, str]:
    try:
        server = smtplib.SMTP(config["smtp_host"], int(config.get("smtp_port", 587)), timeout=15)
        server.starttls()
        server.login(config["smtp_user"], config["smtp_password"])
        server.quit()
        return True, "success"
    except Exception as exc:
        return False, str(exc)[:50]


async def _upsert_integration(
    db: AsyncSession,
    user_id: str,
    org_id: str,
    integration_type: IntegrationType,
    name: str,
    config: dict,
    test_result: str,
) -> UserIntegration:
    result = await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == user_id,
            UserIntegration.org_id == org_id,
            UserIntegration.integration_type == integration_type,
            UserIntegration.name == name,
        )
    )
    integration = result.scalar_one_or_none()
    if integration:
        integration.config = encrypt_config(config)
        integration.is_active = True
        integration.last_tested_at = datetime.now(timezone.utc)
        integration.last_test_result = test_result
    else:
        integration = UserIntegration(
            id=str(uuid4()),
            org_id=org_id,
            user_id=user_id,
            integration_type=integration_type,
            name=name,
            config=encrypt_config(config),
            is_active=True,
            last_tested_at=datetime.now(timezone.utc),
            last_test_result=test_result,
        )
        db.add(integration)
    await db.commit()
    await db.refresh(integration)
    return integration


async def _upsert_oauth_integration(
    db: AsyncSession,
    user_id: str,
    org_id: str,
    integration_type: IntegrationType,
    name: str,
    config: dict,
    test_result: str,
) -> UserIntegration:
    integration = await db.scalar(
        select(UserIntegration).where(
            UserIntegration.user_id == user_id,
            UserIntegration.org_id == org_id,
            UserIntegration.integration_type == integration_type,
        )
    )
    if integration:
        integration.name = name
        integration.config = encrypt_config(config)
        integration.is_active = True
        integration.last_tested_at = datetime.now(timezone.utc)
        integration.last_test_result = test_result
    else:
        integration = UserIntegration(
            id=str(uuid4()),
            org_id=org_id,
            user_id=user_id,
            integration_type=integration_type,
            name=name,
            config=encrypt_config(config),
            is_active=True,
            last_tested_at=datetime.now(timezone.utc),
            last_test_result=test_result,
        )
        db.add(integration)
    await db.commit()
    await db.refresh(integration)
    return integration


async def _integration_exists(
    db: AsyncSession,
    user_id: str,
    org_id: str,
    integration_type: IntegrationType,
    name: str,
) -> bool:
    return bool(
        await db.scalar(
            select(UserIntegration.id).where(
                UserIntegration.user_id == user_id,
                UserIntegration.org_id == org_id,
                UserIntegration.integration_type == integration_type,
                UserIntegration.name == name,
                UserIntegration.is_active == True,  # noqa: E712
            )
        )
    )


def _oauth_redis():
    return redis.from_url(settings.redis_url, decode_responses=True)


async def _store_oauth_state(state: str, payload: dict) -> None:
    client = _oauth_redis()
    try:
        await client.setex(f"{_OAUTH_STATE_PREFIX}{state}", _OAUTH_STATE_TTL_SECONDS, json.dumps(payload))
    finally:
        await client.aclose()


async def _consume_oauth_state(state: str) -> dict:
    client = _oauth_redis()
    try:
        raw = await client.get(f"{_OAUTH_STATE_PREFIX}{state}")
        await client.delete(f"{_OAUTH_STATE_PREFIX}{state}")
    finally:
        await client.aclose()
    if not raw:
        raise HTTPException(status_code=400, detail="OAuth state is invalid or expired")
    return json.loads(raw)


def _require_google_oauth() -> None:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured on the server")


def _require_slack_oauth() -> None:
    if not settings.slack_client_id or not settings.slack_client_secret:
        raise HTTPException(status_code=503, detail="Slack OAuth is not configured on the server")


def _build_google_oauth_url(state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": " ".join(_GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"


def _build_slack_oauth_url(state: str) -> str:
    params = {
        "client_id": settings.slack_client_id,
        "redirect_uri": settings.slack_oauth_redirect_uri,
        "scope": ",".join(_SLACK_SCOPES),
        "state": state,
        "user_scope": "",
    }
    return f"https://slack.com/oauth/v2/authorize?{urlencode(params)}"


async def _exchange_google_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_oauth_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        response.raise_for_status()
        return response.json()


async def _fetch_gmail_profile(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()


async def _exchange_slack_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://slack.com/api/oauth.v2.access",
            data={
                "code": code,
                "client_id": settings.slack_client_id,
                "client_secret": settings.slack_client_secret,
                "redirect_uri": settings.slack_oauth_redirect_uri,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise HTTPException(status_code=400, detail=payload.get("error", "Slack OAuth exchange failed"))
        return payload


async def _fetch_slack_identity(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://slack.com/api/auth.test",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise HTTPException(status_code=400, detail=payload.get("error", "Slack auth test failed"))
        return payload


def _oauth_expiry_iso(expires_in: int | None) -> str | None:
    if not expires_in:
        return None
    return (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()


async def refresh_gmail_oauth_tokens(
    org_id: str,
    user_id: str,
    db: AsyncSession,
) -> tuple[UserIntegration, dict]:
    integration = await db.scalar(
        select(UserIntegration).where(
            UserIntegration.org_id == org_id,
            UserIntegration.user_id == user_id,
            UserIntegration.integration_type == IntegrationType.gmail,
            UserIntegration.is_active == True,  # noqa: E712
        )
    )
    if not integration:
        raise HTTPException(status_code=404, detail="Gmail integration not found")

    config = decrypt_config(integration.config)
    expires_at_raw = config.get("token_expires_at")
    expires_at = None
    if expires_at_raw:
        try:
            expires_at = datetime.fromisoformat(expires_at_raw)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
        except ValueError:
            expires_at = None

    if expires_at and expires_at > datetime.now(timezone.utc) + timedelta(minutes=1):
        return integration, config

    refresh_token = config.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Stored Gmail integration has no refresh token")

    _require_google_oauth()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        response.raise_for_status()
        payload = response.json()

    config["access_token"] = payload["access_token"]
    if payload.get("refresh_token"):
        config["refresh_token"] = payload["refresh_token"]
    if payload.get("scope"):
        config["scopes"] = payload["scope"].split()
        config["granted_scopes"] = payload["scope"]
    config["token_expires_at"] = _oauth_expiry_iso(payload.get("expires_in"))
    integration.config = encrypt_config(config)
    integration.last_tested_at = datetime.now(timezone.utc)
    integration.last_test_result = "success"
    await db.commit()
    await db.refresh(integration)
    return integration, config


@router.get("", response_model=list[IntegrationResponse])
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(UserIntegration)
        .where(UserIntegration.user_id == current_user.id, UserIntegration.org_id == ctx.org.id, UserIntegration.is_active == True)
        .order_by(UserIntegration.created_at.desc())
    )
    return [_safe_response(integration) for integration in result.scalars().all()]


@router.get("/oauth/gmail/start")
async def start_gmail_oauth(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _require_google_oauth()
    state = secrets.token_urlsafe(24)
    await _store_oauth_state(
        state,
        {
            "provider": "gmail",
            "org_id": ctx.org.id,
            "user_id": current_user.id,
        },
    )
    return {"oauth_url": _build_google_oauth_url(state)}


@router.get("/oauth/slack/start")
async def start_slack_oauth(
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    _require_slack_oauth()
    state = secrets.token_urlsafe(24)
    await _store_oauth_state(
        state,
        {
            "provider": "slack",
            "org_id": ctx.org.id,
            "user_id": current_user.id,
        },
    )
    return {"oauth_url": _build_slack_oauth_url(state)}


@router.post("/oauth/callback")
async def oauth_callback(
    payload: OAuthCallbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    state_payload = await _consume_oauth_state(payload.state)
    if state_payload.get("org_id") != ctx.org.id or state_payload.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="OAuth state does not match the current session")

    provider = state_payload.get("provider")
    if provider == "gmail":
        _require_google_oauth()
        token_payload = await _exchange_google_code(payload.code)
        profile = await _fetch_gmail_profile(token_payload["access_token"])
        if not await _integration_exists(db, current_user.id, ctx.org.id, IntegrationType.gmail, profile["emailAddress"]):
            existing = await db.scalar(
                select(UserIntegration.id).where(
                    UserIntegration.user_id == current_user.id,
                    UserIntegration.org_id == ctx.org.id,
                    UserIntegration.integration_type == IntegrationType.gmail,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            if not existing:
                await check_plan_limit("integrations", ctx.org, db)

        integration = await _upsert_oauth_integration(
            db,
            current_user.id,
            ctx.org.id,
            IntegrationType.gmail,
            profile["emailAddress"],
            {
                "access_token": token_payload["access_token"],
                "refresh_token": token_payload.get("refresh_token"),
                "scopes": token_payload.get("scope", "").split(),
                "granted_scopes": token_payload.get("scope", ""),
                "token_type": token_payload.get("token_type", "Bearer"),
                "token_expires_at": _oauth_expiry_iso(token_payload.get("expires_in")),
                "email": profile["emailAddress"],
            },
            "success",
        )
        await tool_registry.clear_user_cache(current_user.id)
        return {
            "success": True,
            "provider": "gmail",
            "email": profile["emailAddress"],
            "integration": _safe_response(integration).model_dump(),
        }

    if provider == "slack":
        _require_slack_oauth()
        token_payload = await _exchange_slack_code(payload.code)
        identity = await _fetch_slack_identity(token_payload["access_token"])
        workspace = token_payload.get("team", {}).get("name") or identity.get("team") or "Slack Workspace"
        if not await _integration_exists(db, current_user.id, ctx.org.id, IntegrationType.slack, workspace):
            existing = await db.scalar(
                select(UserIntegration.id).where(
                    UserIntegration.user_id == current_user.id,
                    UserIntegration.org_id == ctx.org.id,
                    UserIntegration.integration_type == IntegrationType.slack,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            if not existing:
                await check_plan_limit("integrations", ctx.org, db)

        integration = await _upsert_oauth_integration(
            db,
            current_user.id,
            ctx.org.id,
            IntegrationType.slack,
            workspace,
            {
                "access_token": token_payload["access_token"],
                "refresh_token": token_payload.get("refresh_token"),
                "token_expires_at": _oauth_expiry_iso(token_payload.get("expires_in")),
                "workspace": workspace,
                "workspace_url": identity.get("url"),
                "user": identity.get("user"),
                "scopes": token_payload.get("scope", "").split(",") if token_payload.get("scope") else [],
            },
            "success",
        )
        await tool_registry.clear_user_cache(current_user.id)
        return {
            "success": True,
            "provider": "slack",
            "workspace": workspace,
            "integration": _safe_response(integration).model_dump(),
        }

    raise HTTPException(status_code=400, detail="Unsupported OAuth provider")


@router.get("/oauth/gmail/refresh")
async def refresh_gmail_oauth(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    integration, config = await refresh_gmail_oauth_tokens(ctx.org.id, current_user.id, db)
    return {
        "success": True,
        "provider": "gmail",
        "email": config.get("email") or integration.name,
        "expires_at": config.get("token_expires_at"),
    }


@router.post("/github", response_model=IntegrationResponse, status_code=201)
async def create_github_integration(
    data: GitHubIntegrationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    if not await _integration_exists(db, current_user.id, ctx.org.id, IntegrationType.github, data.name):
        await check_plan_limit("integrations", ctx.org, db)
    ok, result = await _validate_github_token(data.access_token)
    if not ok:
        raise HTTPException(status_code=400, detail=result)
    integration = await _upsert_integration(
        db,
        current_user.id,
        ctx.org.id,
        IntegrationType.github,
        data.name,
        {"access_token": data.access_token, "default_repo": data.default_repo},
        result,
    )
    await tool_registry.clear_user_cache(current_user.id)
    return _safe_response(integration)


@router.post("/email", response_model=IntegrationResponse, status_code=201)
async def create_email_integration(
    data: EmailIntegrationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    if not await _integration_exists(db, current_user.id, ctx.org.id, IntegrationType.email_smtp, data.name):
        await check_plan_limit("integrations", ctx.org, db)
    config = data.model_dump()
    ok, result = _test_email_config(config)
    if not ok:
        raise HTTPException(status_code=400, detail=f"SMTP validation failed: {result}")
    integration = await _upsert_integration(
        db,
        current_user.id,
        ctx.org.id,
        IntegrationType.email_smtp,
        data.name,
        config,
        result,
    )
    await tool_registry.clear_user_cache(current_user.id)
    return _safe_response(integration)


@router.post("/search", response_model=IntegrationResponse, status_code=201)
async def create_search_integration(
    data: SearchIntegrationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    from tools.research.search_backend import search_backend

    existing = await db.scalar(
        select(UserIntegration.id).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.org_id == ctx.org.id,
            UserIntegration.integration_type == IntegrationType.search_api,
            UserIntegration.is_active == True,  # noqa: E712
        )
    )
    if not existing:
        await check_plan_limit("integrations", ctx.org, db)

    provider = data.provider.strip().lower()
    ok, result = await search_backend.validate_provider_config(provider, data.api_key)
    if not ok:
        raise HTTPException(status_code=400, detail=result)

    integration = await _upsert_oauth_integration(
        db,
        current_user.id,
        ctx.org.id,
        IntegrationType.search_api,
        data.name,
        {"provider": provider, "api_key": data.api_key},
        result,
    )
    await tool_registry.clear_user_cache(current_user.id)
    return _safe_response(integration)


@router.post("/{integration_id}/test", response_model=IntegrationResponse)
async def test_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(UserIntegration).where(
            UserIntegration.id == integration_id,
            UserIntegration.user_id == current_user.id,
            UserIntegration.org_id == ctx.org.id,
            UserIntegration.is_active == True,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    config = decrypt_config(integration.config)
    if not is_supported_integration_type(integration.integration_type):
        raise HTTPException(
            status_code=400,
            detail=unsupported_integration_note(integration.integration_type),
        )
    if integration.integration_type == IntegrationType.github:
        ok, test_result = await _validate_github_token(config["access_token"])
    elif integration.integration_type == IntegrationType.gmail:
        from tools.communication.utils import get_gmail_service

        service = await get_gmail_service(ctx.org.id, current_user.id)
        def _send_test():
            msg = MIMEText("Aethon Gmail integration test")
            msg["to"] = config.get("email") or integration.name
            msg["subject"] = "Aethon Gmail test"
            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
            return service.users().messages().send(userId="me", body={"raw": raw}).execute()

        await asyncio.to_thread(_send_test)
        ok, test_result = True, "success"
    elif integration.integration_type == IntegrationType.slack:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://slack.com/api/auth.test",
                headers={"Authorization": f"Bearer {config.get('access_token', '')}"},
            )
            payload = response.json()
            ok = response.status_code < 400 and payload.get("ok", False)
            test_result = "success" if ok else payload.get("error", "Slack auth test failed")
    elif integration.integration_type == IntegrationType.search_api:
        from tools.research.search_backend import search_backend

        ok, test_result = await search_backend.validate_provider_config(
            str(config.get("provider", "")),
            str(config.get("api_key", "")),
        )
    elif integration.integration_type == IntegrationType.email_smtp:
        ok, test_result = _test_email_config(config)

    integration.last_tested_at = datetime.now(timezone.utc)
    integration.last_test_result = "success" if ok else test_result[:50]
    await db.commit()
    await db.refresh(integration)
    return _safe_response(integration)


@router.delete("/{integration_id}", status_code=204)
async def delete_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(UserIntegration).where(
            UserIntegration.id == integration_id,
            UserIntegration.user_id == current_user.id,
            UserIntegration.org_id == ctx.org.id,
            UserIntegration.is_active == True,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    integration.is_active = False
    await db.commit()
    await tool_registry.clear_user_cache(current_user.id)

import smtplib
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database import get_db
from database.models import IntegrationType, User, UserIntegration
from services.integration_crypto import decrypt_config, encrypt_config
from tools.registry import tool_registry


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class IntegrationResponse(BaseModel):
    id: str
    integration_type: str
    name: str
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


def _safe_response(integration: UserIntegration) -> IntegrationResponse:
    default_repo = None
    if integration.integration_type == IntegrationType.github:
        try:
            default_repo = decrypt_config(integration.config).get("default_repo")
        except Exception:
            default_repo = None
    return IntegrationResponse(
        id=integration.id,
        integration_type=integration.integration_type.value,
        name=integration.name,
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
    if integration.integration_type == IntegrationType.github:
        ok, test_result = await _validate_github_token(config["access_token"])
    elif integration.integration_type == IntegrationType.email_smtp:
        ok, test_result = _test_email_config(config)
    else:
        ok, test_result = False, "Testing not implemented"

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

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging

from sqlalchemy import select

from config import settings
from database.db import AsyncSessionLocal
from database.models import IntegrationType, UserIntegration
from services.integration_crypto import decrypt_config, encrypt_config


logger = logging.getLogger(__name__)


async def get_active_integration_config(
    org_id: str,
    user_id: str,
    integration_type: IntegrationType,
    prefetched_config: dict | None = None,
) -> tuple[UserIntegration, dict]:
    if prefetched_config:
        class _IntegrationStub:
            id = "prefetched"

        return _IntegrationStub(), prefetched_config

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(UserIntegration).where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.user_id == user_id,
                    UserIntegration.integration_type == integration_type,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            integration = result.scalar_one_or_none()
        except Exception as exc:
            raise ValueError(
                f"Could not load {integration_type.value} integration. Ensure the database is reachable."
            ) from exc

    if not integration:
        raise ValueError(
            f"{integration_type.value} not connected. Please connect it in Settings > Integrations."
        )

    try:
        config = decrypt_config(integration.config)
    except Exception as exc:
        raise ValueError(f"Stored {integration_type.value} credentials could not be decrypted") from exc
    return integration, config


async def save_integration_config(integration_id: str, updated_config: dict) -> None:
    if integration_id == "prefetched":
        return
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(UserIntegration).where(UserIntegration.id == integration_id))
        integration = result.scalar_one_or_none()
        if not integration:
            raise ValueError("Integration not found while saving refreshed credentials")
        integration.config = encrypt_config(updated_config)
        integration.last_tested_at = datetime.now(timezone.utc)
        integration.last_test_result = "success"
        await db.commit()


async def get_gmail_service(org_id: str, user_id: str, prefetched_config: dict | None = None):
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError as exc:  # pragma: no cover
        raise ValueError(
            "Google Gmail dependencies are not installed. Install google-api-python-client, "
            "google-auth-httplib2, and google-auth-oauthlib."
        ) from exc

    creds = await get_google_credentials(
        org_id,
        user_id,
        prefetched_config=prefetched_config,
        required_scopes=[
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.compose",
        ],
    )
    service = await asyncio.to_thread(lambda: build("gmail", "v1", credentials=creds, cache_discovery=False))
    return service


async def get_google_credentials(
    org_id: str,
    user_id: str,
    prefetched_config: dict | None = None,
    required_scopes: list[str] | None = None,
):
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError as exc:  # pragma: no cover
        raise ValueError(
            "Google OAuth dependencies are not installed. Install google-api-python-client, "
            "google-auth-httplib2, and google-auth-oauthlib."
        ) from exc

    integration, config = await get_active_integration_config(
        org_id,
        user_id,
        IntegrationType.gmail,
        prefetched_config=prefetched_config,
    )

    if prefetched_config is None:
        try:
            from api.integrations import refresh_gmail_oauth_tokens

            async with AsyncSessionLocal() as db:
                integration, config = await refresh_gmail_oauth_tokens(org_id, user_id, db)
        except Exception:
            pass

    access_token = config.get("access_token") or config.get("token")
    refresh_token = config.get("refresh_token")
    scopes = config.get("scopes") or ["https://www.googleapis.com/auth/gmail.modify"]
    if not access_token:
        raise ValueError("Google access token is missing. Reconnect Google in Settings > Integrations.")
    if not refresh_token:
        raise ValueError("Google refresh token is missing. Reconnect Google with offline access enabled.")
    if required_scopes:
        missing_scopes = [scope for scope in required_scopes if scope not in scopes]
        if missing_scopes:
            raise ValueError(
                "Google integration is missing required scopes. Reconnect Google in /integrations "
                f"to grant: {', '.join(missing_scopes)}"
            )
    if not settings.google_client_id or not settings.google_client_secret:
        raise ValueError("Google OAuth credentials are not configured on the server.")

    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri=config.get("token_uri") or "https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=scopes,
    )

    if creds.expired and creds.refresh_token:
        await asyncio.to_thread(creds.refresh, Request())
        config["access_token"] = creds.token
        if creds.expiry:
            config["token_expires_at"] = creds.expiry.astimezone(timezone.utc).isoformat()
        await save_integration_config(integration.id, config)

    return creds


async def get_slack_token(org_id: str, user_id: str, prefetched_config: dict | None = None) -> str:
    _, config = await get_active_integration_config(
        org_id,
        user_id,
        IntegrationType.slack,
        prefetched_config=prefetched_config,
    )
    token = config.get("access_token") or config.get("bot_token") or config.get("token")
    if not token:
        raise ValueError("Slack access token is missing. Reconnect Slack in Settings > Integrations.")
    return token

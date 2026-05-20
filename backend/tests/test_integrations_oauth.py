from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from config import settings
from database.models import IntegrationType, UserIntegration
from services.integration_crypto import decrypt_config, encrypt_config
from tools.communication.gmail import GmailSendTool


class _FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    async def setex(self, key: str, ttl: int, value: str):
        self.values[key] = value
        return True

    async def get(self, key: str):
        return self.values.get(key)

    async def delete(self, key: str):
        self.values.pop(key, None)
        return 1

    async def aclose(self):
        return None


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class _FakeOAuthClient:
    def __init__(self, responses: dict[tuple[str, str], _FakeResponse]):
        self.responses = responses

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, **kwargs):
        return self.responses[("GET", url)]

    async def post(self, url: str, **kwargs):
        return self.responses[("POST", url)]


@pytest.mark.asyncio
async def test_gmail_oauth_start_returns_url_and_stores_state(monkeypatch, authed_client, test_org, test_user):
    import api.integrations as integrations_module

    fake_redis = _FakeRedis()
    monkeypatch.setattr(integrations_module.redis, "from_url", lambda *args, **kwargs: fake_redis)
    monkeypatch.setattr(settings, "google_client_id", "google-client-id", raising=False)
    monkeypatch.setattr(settings, "google_client_secret", "google-client-secret", raising=False)
    monkeypatch.setattr(settings, "google_oauth_redirect_uri", "http://localhost:5173/integrations/oauth/callback", raising=False)

    response = await authed_client.get("/api/integrations/oauth/gmail/start")
    assert response.status_code == 200
    payload = response.json()
    assert "accounts.google.com" in payload["oauth_url"]
    assert "gmail.send" in payload["oauth_url"]
    assert "drive.file" in payload["oauth_url"]
    assert len(fake_redis.values) == 1

    stored_payload = json.loads(next(iter(fake_redis.values.values())))
    assert stored_payload["provider"] == "gmail"
    assert stored_payload["org_id"] == test_org.id
    assert stored_payload["user_id"] == test_user.id


@pytest.mark.asyncio
async def test_gmail_oauth_callback_upserts_integration(monkeypatch, authed_client, db, test_org, test_user):
    import api.integrations as integrations_module

    state = "state-gmail-123"
    fake_redis = _FakeRedis()
    fake_redis.values[f"aethon:oauth:state:{state}"] = json.dumps(
        {"provider": "gmail", "org_id": test_org.id, "user_id": test_user.id}
    )
    monkeypatch.setattr(integrations_module.redis, "from_url", lambda *args, **kwargs: fake_redis)
    monkeypatch.setattr(settings, "google_client_id", "google-client-id", raising=False)
    monkeypatch.setattr(settings, "google_client_secret", "google-client-secret", raising=False)
    monkeypatch.setattr(settings, "google_oauth_redirect_uri", "http://localhost:5173/integrations/oauth/callback", raising=False)

    responses = {
        ("POST", "https://oauth2.googleapis.com/token"): _FakeResponse(
            {
                "access_token": "gmail-access",
                "refresh_token": "gmail-refresh",
                "scope": "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file",
                "expires_in": 3600,
                "token_type": "Bearer",
            }
        ),
        ("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile"): _FakeResponse(
            {"emailAddress": "hello@example.com", "messagesTotal": 0, "threadsTotal": 0}
        ),
    }
    monkeypatch.setattr(integrations_module.httpx, "AsyncClient", lambda *args, **kwargs: _FakeOAuthClient(responses))

    response = await authed_client.post(
        "/api/integrations/oauth/callback",
        json={"code": "auth-code", "state": state},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["provider"] == "gmail"
    assert payload["email"] == "hello@example.com"

    integration = await db.scalar(
        select(UserIntegration).where(
            UserIntegration.org_id == test_org.id,
            UserIntegration.user_id == test_user.id,
            UserIntegration.integration_type == IntegrationType.gmail,
        )
    )
    assert integration is not None
    stored = decrypt_config(integration.config)
    assert stored["access_token"] == "gmail-access"
    assert stored["refresh_token"] == "gmail-refresh"
    assert stored["granted_scopes"] == (
        "https://www.googleapis.com/auth/gmail.send "
        "https://www.googleapis.com/auth/gmail.readonly "
        "https://www.googleapis.com/auth/drive.file"
    )
    assert stored["email"] == "hello@example.com"


@pytest.mark.asyncio
async def test_slack_oauth_callback_upserts_integration(monkeypatch, authed_client, db, test_org, test_user):
    import api.integrations as integrations_module

    state = "state-slack-123"
    fake_redis = _FakeRedis()
    fake_redis.values[f"aethon:oauth:state:{state}"] = json.dumps(
        {"provider": "slack", "org_id": test_org.id, "user_id": test_user.id}
    )
    monkeypatch.setattr(integrations_module.redis, "from_url", lambda *args, **kwargs: fake_redis)
    monkeypatch.setattr(settings, "slack_client_id", "slack-client-id", raising=False)
    monkeypatch.setattr(settings, "slack_client_secret", "slack-client-secret", raising=False)
    monkeypatch.setattr(settings, "slack_oauth_redirect_uri", "http://localhost:5173/integrations/oauth/callback", raising=False)

    responses = {
        ("POST", "https://slack.com/api/oauth.v2.access"): _FakeResponse(
            {
                "ok": True,
                "access_token": "xoxb-test",
                "refresh_token": "refresh-slack",
                "expires_in": 7200,
                "team": {"name": "Aethon Workspace"},
                "authed_user": {"id": "U123"},
                "scope": "chat:write,channels:read,im:read,im:write",
            }
        ),
        ("POST", "https://slack.com/api/auth.test"): _FakeResponse(
            {"ok": True, "user": "charan", "team": "Aethon Workspace", "url": "https://aethon.slack.com/"}
        ),
    }
    monkeypatch.setattr(integrations_module.httpx, "AsyncClient", lambda *args, **kwargs: _FakeOAuthClient(responses))

    response = await authed_client.post(
        "/api/integrations/oauth/callback",
        json={"code": "auth-code", "state": state},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "slack"
    assert payload["workspace"] == "Aethon Workspace"

    integration = await db.scalar(
        select(UserIntegration).where(
            UserIntegration.org_id == test_org.id,
            UserIntegration.user_id == test_user.id,
            UserIntegration.integration_type == IntegrationType.slack,
        )
    )
    assert integration is not None
    stored = decrypt_config(integration.config)
    assert stored["access_token"] == "xoxb-test"
    assert stored["workspace"] == "Aethon Workspace"


@pytest.mark.asyncio
async def test_gmail_refresh_endpoint_updates_tokens(monkeypatch, authed_client, db, test_org, test_user):
    import api.integrations as integrations_module

    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "old-token",
                "refresh_token": "refresh-token",
                "email": "hello@example.com",
                "scopes": ["https://www.googleapis.com/auth/gmail.send"],
                "token_expires_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            }
        ),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    monkeypatch.setattr(settings, "google_client_id", "google-client-id", raising=False)
    monkeypatch.setattr(settings, "google_client_secret", "google-client-secret", raising=False)

    responses = {
        ("POST", "https://oauth2.googleapis.com/token"): _FakeResponse(
            {
                "access_token": "new-token",
                "expires_in": 1800,
                "scope": "https://www.googleapis.com/auth/gmail.send",
                "token_type": "Bearer",
            }
        ),
    }
    monkeypatch.setattr(integrations_module.httpx, "AsyncClient", lambda *args, **kwargs: _FakeOAuthClient(responses))

    response = await authed_client.get("/api/integrations/oauth/gmail/refresh")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["email"] == "hello@example.com"

    await db.refresh(integration)
    stored = decrypt_config(integration.config)
    assert stored["access_token"] == "new-token"


@pytest.mark.asyncio
async def test_list_integrations_marks_old_gmail_connection_for_reauth(authed_client, db, test_org, test_user):
    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "gmail-access",
                "refresh_token": "gmail-refresh",
                "email": "hello@example.com",
                "scopes": [
                    "https://www.googleapis.com/auth/gmail.send",
                    "https://www.googleapis.com/auth/gmail.readonly",
                ],
            }
        ),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    response = await authed_client.get("/api/integrations")

    assert response.status_code == 200
    payload = response.json()
    gmail = next(item for item in payload if item["integration_type"] == "gmail")
    assert gmail["needs_reauth"] is True
    assert "updated permissions" in gmail["reauth_reason"].lower()


@pytest.mark.asyncio
async def test_list_integrations_marks_updated_gmail_connection_as_ready(authed_client, db, test_org, test_user):
    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "gmail-access",
                "refresh_token": "gmail-refresh",
                "email": "hello@example.com",
                "granted_scopes": (
                    "https://www.googleapis.com/auth/gmail.send "
                    "https://www.googleapis.com/auth/gmail.readonly "
                    "https://www.googleapis.com/auth/drive.file"
                ),
            }
        ),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    response = await authed_client.get("/api/integrations")

    assert response.status_code == 200
    payload = response.json()
    gmail = next(item for item in payload if item["integration_type"] == "gmail")
    assert gmail["needs_reauth"] is False
    assert gmail["reauth_reason"] is None


@pytest.mark.asyncio
async def test_gmail_tool_returns_helpful_error_when_not_connected(monkeypatch, db_engine, test_org, test_user):
    from tools.communication import utils as gmail_utils

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(gmail_utils, "AsyncSessionLocal", session_factory)

    tool = GmailSendTool()
    result = await tool.execute(
        {"to": "test@example.com", "subject": "Hello", "body": "Hi there"},
        org_id=test_org.id,
        user_id=test_user.id,
    )
    assert result.success is False
    assert result.error == "Gmail is not connected. Visit /integrations to connect with OAuth."

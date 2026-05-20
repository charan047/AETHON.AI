from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import IntegrationType, UserIntegration
from services.integration_crypto import encrypt_config
from tools.productivity import google_docs as google_docs_module
from tools.productivity.google_docs import GoogleDocsTool, _markdown_to_plain


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class _FakeHttpClient:
    def __init__(self, responses: dict[tuple[str, str], _FakeResponse]):
        self.responses = responses

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, **kwargs):
        return self.responses[("POST", url)]


@pytest.mark.asyncio
async def test_google_docs_validate_auth_checks_org_connection(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_docs_module, "AsyncSessionLocal", session_factory)
    tool = GoogleDocsTool()
    assert await tool.validate_auth(test_org.id, test_user.id) is False

    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config({"access_token": "token", "email": "hello@example.com"}),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    assert await tool.validate_auth(test_org.id, test_user.id) is True


@pytest.mark.asyncio
async def test_google_docs_execute_returns_helpful_error_when_not_connected(db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_docs_module, "AsyncSessionLocal", session_factory)
    tool = GoogleDocsTool()
    result = await tool.execute({"title": "Doc", "content": "Body"}, test_org.id, test_user.id)

    assert result.success is False
    assert result.error == "Google not connected. Visit /integrations to connect."


@pytest.mark.asyncio
async def test_google_docs_execute_creates_document_and_returns_url(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_docs_module, "AsyncSessionLocal", session_factory)
    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "fresh-token",
                "refresh_token": "refresh-token",
                "email": "hello@example.com",
            }
        ),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    async def fake_refresh(org_id: str, user_id: str, db):
        return integration, {
            "access_token": "fresh-token",
            "email": "hello@example.com",
            "granted_scopes": "https://www.googleapis.com/auth/drive.file",
        }

    monkeypatch.setattr(google_docs_module, "refresh_gmail_oauth_tokens", fake_refresh)

    responses = {
        ("POST", "https://docs.googleapis.com/v1/documents"): _FakeResponse({"documentId": "doc-123"}),
        ("POST", "https://docs.googleapis.com/v1/documents/doc-123:batchUpdate"): _FakeResponse({"replies": []}),
    }
    monkeypatch.setattr(
        google_docs_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses),
    )

    tool = GoogleDocsTool()
    result = await tool.execute(
        {"title": "Client Report", "content": "## Findings\n\n**Strong** results."},
        test_org.id,
        test_user.id,
    )

    assert result.success is True
    assert result.result == "https://docs.google.com/document/d/doc-123/edit"
    assert result.metadata["doc_id"] == "doc-123"
    assert result.metadata["title"] == "Client Report"


@pytest.mark.asyncio
async def test_google_docs_execute_returns_expired_token_error(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_docs_module, "AsyncSessionLocal", session_factory)
    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "stale-token",
                "refresh_token": "refresh-token",
                "email": "hello@example.com",
            }
        ),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    async def fake_refresh(org_id: str, user_id: str, db):
        return integration, {
            "access_token": "stale-token",
            "email": "hello@example.com",
            "granted_scopes": "https://www.googleapis.com/auth/drive.file",
        }

    monkeypatch.setattr(google_docs_module, "refresh_gmail_oauth_tokens", fake_refresh)

    responses = {
        ("POST", "https://docs.googleapis.com/v1/documents"): _FakeResponse({}, status_code=401),
    }
    monkeypatch.setattr(
        google_docs_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses),
    )

    tool = GoogleDocsTool()
    result = await tool.execute(
        {"title": "Client Report", "content": "Body"},
        test_org.id,
        test_user.id,
    )

    assert result.success is False
    assert result.error == "Google token expired. Reconnect Gmail in /integrations."


@pytest.mark.asyncio
async def test_google_docs_execute_requires_drive_scope(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_docs_module, "AsyncSessionLocal", session_factory)
    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "token",
                "refresh_token": "refresh-token",
                "email": "hello@example.com",
            }
        ),
        is_active=True,
    )
    db.add(integration)
    await db.commit()

    async def fake_refresh(org_id: str, user_id: str, db):
        return integration, {"access_token": "token", "email": "hello@example.com"}

    monkeypatch.setattr(google_docs_module, "refresh_gmail_oauth_tokens", fake_refresh)

    tool = GoogleDocsTool()
    result = await tool.execute(
        {"title": "Client Report", "content": "Body"},
        test_org.id,
        test_user.id,
    )

    assert result.success is False
    assert result.error == "Google Docs requires updated permissions. Reconnect Gmail in /integrations."


def test_markdown_to_plain_strips_basic_markdown():
    text = _markdown_to_plain("## Title\n\n**Bold** [Link](https://example.com)\n\n```py\nprint('x')\n```")

    assert "Title" in text
    assert "Bold" in text
    assert "Link" in text
    assert "print('x')" not in text

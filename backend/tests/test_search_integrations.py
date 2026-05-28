from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from config import settings
from database.models import IntegrationType, OrgMember, OrgMemberRole, Organization, UserIntegration
from services.integration_crypto import decrypt_config, encrypt_config
from tools.research.search_backend import search_backend


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200, headers: dict | None = None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class _FakeAsyncClient:
    def __init__(self, recorder: list[tuple[str, str, dict]]):
        self.recorder = recorder

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, **kwargs):
        self.recorder.append(("GET", url, kwargs))
        return _FakeResponse(
            {
                "web": {
                    "results": [
                        {"title": "Org result", "url": "https://example.com/org", "description": "Scoped result"}
                    ]
                }
            },
            headers={"X-RateLimit-Remaining": "98"},
        )

    async def post(self, url: str, **kwargs):
        self.recorder.append(("POST", url, kwargs))
        return _FakeResponse(
            {
                "organic": [
                    {"title": "Serper result", "link": "https://example.com/serper", "snippet": "Scoped result"}
                ]
            },
            headers={"X-RateLimit-Limit": "2500"},
        )


class _FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    async def get(self, key: str):
        return self.values.get(key)

    async def setex(self, key: str, ttl: int, value: str):
        self.values[key] = value
        return True

    async def aclose(self):
        return None


@pytest.mark.asyncio
async def test_create_search_integration_persists_provider_and_key(authed_client, db, test_org, test_user, monkeypatch):
    recorder: list[tuple[str, str, dict]] = []
    monkeypatch.setattr("tools.research.search_backend.httpx.AsyncClient", lambda *args, **kwargs: _FakeAsyncClient(recorder))

    response = await authed_client.post(
        "/api/integrations/search",
        json={
            "provider": "brave",
            "api_key": "brave-org-key",
            "name": "Agency Search",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["integration_type"] == "search_api"
    assert payload["name"] == "Agency Search"
    assert payload["connected_account"] == "brave"

    integration = await db.scalar(
        select(UserIntegration).where(
            UserIntegration.org_id == test_org.id,
            UserIntegration.user_id == test_user.id,
            UserIntegration.integration_type == IntegrationType.search_api,
        )
    )
    assert integration is not None
    stored = decrypt_config(integration.config)
    assert stored["provider"] == "brave"
    assert stored["api_key"] == "brave-org-key"
    assert integration.last_test_result == "success"


@pytest.mark.asyncio
async def test_search_backend_prefers_org_integration_over_platform_key(db, test_org, test_user, monkeypatch):
    recorder: list[tuple[str, str, dict]] = []
    monkeypatch.setattr("tools.research.search_backend.httpx.AsyncClient", lambda *args, **kwargs: _FakeAsyncClient(recorder))
    monkeypatch.setattr(settings, "brave_search_api_key", "platform-brave-key", raising=False)
    monkeypatch.setattr(settings, "serper_api_key", "", raising=False)
    monkeypatch.setattr(search_backend, "session_factory", async_sessionmaker(db.bind, expire_on_commit=False))

    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.search_api,
        name="Agency Search",
        config=encrypt_config({"provider": "brave", "api_key": "org-brave-key"}),
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(integration)
    await db.commit()

    results = await search_backend.search("best agencies", org_id=test_org.id, user_id=test_user.id)

    assert results[0]["title"] == "Org result"
    assert recorder
    _, _, kwargs = recorder[0]
    assert kwargs["headers"]["X-Subscription-Token"] == "org-brave-key"


@pytest.mark.asyncio
async def test_tool_health_uses_org_search_integration(authed_client, db, test_org, test_user, monkeypatch):
    import tools.research.search_backend as search_backend_module

    fake_redis = _FakeRedis()
    recorder: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(search_backend_module.aioredis, "from_url", lambda *args, **kwargs: fake_redis)
    monkeypatch.setattr(search_backend_module.httpx, "AsyncClient", lambda *args, **kwargs: _FakeAsyncClient(recorder))
    monkeypatch.setattr(settings, "brave_search_api_key", "", raising=False)
    monkeypatch.setattr(settings, "serper_api_key", "", raising=False)
    monkeypatch.setattr(search_backend_module.search_backend, "session_factory", async_sessionmaker(db.bind, expire_on_commit=False))

    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.search_api,
        name="Agency Search",
        config=encrypt_config({"provider": "serper", "api_key": "org-serper-key"}),
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(integration)
    await db.commit()

    response = await authed_client.get("/api/tools/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["provider"] == "serper"
    assert payload["search"]["status"] == "healthy"
    assert "org integration" in payload["search"]["note"].lower()
    assert recorder
    _, _, kwargs = recorder[0]
    assert kwargs["headers"]["X-API-KEY"] == "org-serper-key"


@pytest.mark.asyncio
async def test_tool_health_isolated_per_org(authed_client, db, test_org, test_user, monkeypatch):
    import tools.research.search_backend as search_backend_module

    second_org = Organization(
        name="Second Company",
        slug="second-company",
        plan="open_source",
        owner_user_id=test_user.id,
    )
    db.add(second_org)
    await db.commit()
    await db.refresh(second_org)
    db.add(OrgMember(org_id=second_org.id, user_id=test_user.id, role=OrgMemberRole.owner))
    await db.commit()

    integration = UserIntegration(
        id=str(uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.search_api,
        name="Agency Search",
        config=encrypt_config({"provider": "brave", "api_key": "org-brave-key"}),
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(integration)
    await db.commit()

    fake_redis = _FakeRedis()
    monkeypatch.setattr(search_backend_module.aioredis, "from_url", lambda *args, **kwargs: fake_redis)
    monkeypatch.setattr(settings, "brave_search_api_key", "", raising=False)
    monkeypatch.setattr(settings, "serper_api_key", "", raising=False)
    monkeypatch.setattr(search_backend_module.search_backend, "session_factory", async_sessionmaker(db.bind, expire_on_commit=False))

    authed_client.headers["X-Org-Id"] = second_org.id
    response = await authed_client.get("/api/tools/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["status"] == "not_configured"
    assert "integrations" in payload["search"]["note"].lower()

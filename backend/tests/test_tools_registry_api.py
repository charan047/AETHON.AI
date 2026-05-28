import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from datetime import datetime, timezone
from uuid import uuid4

from database.models import IntegrationType, UserIntegration
from services.integration_crypto import encrypt_config


@pytest.mark.asyncio
async def test_tool_health_marks_search_as_not_configured_without_api_keys(authed_client, db, monkeypatch):
    from config import settings
    import tools.research.search_backend as search_backend_module

    monkeypatch.setattr(settings, "brave_search_api_key", "", raising=False)
    monkeypatch.setattr(settings, "serper_api_key", "", raising=False)
    monkeypatch.setattr(
        search_backend_module.search_backend,
        "session_factory",
        async_sessionmaker(db.bind, expire_on_commit=False),
    )

    response = await authed_client.get("/api/tools/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["status"] == "not_configured"
    assert "Connect Brave or Serper in Integrations" in payload["search"]["note"]


@pytest.mark.asyncio
async def test_tool_catalog_exposes_google_sheets_when_supported(authed_client):
    response = await authed_client.get("/api/tools/catalog")

    assert response.status_code == 200
    names = {item["name"] for item in response.json()}
    assert "google_sheets" in names


@pytest.mark.asyncio
async def test_tool_health_uses_connected_supported_integrations_for_current_user(
    authed_client,
    db,
    test_org,
    test_user,
    monkeypatch,
):
    from config import settings
    import tools.research.search_backend as search_backend_module

    monkeypatch.setattr(settings, "google_client_id", "", raising=False)
    monkeypatch.setattr(settings, "slack_client_id", "", raising=False)
    monkeypatch.setattr(settings, "brave_search_api_key", "", raising=False)
    monkeypatch.setattr(settings, "serper_api_key", "", raising=False)
    monkeypatch.setattr(
        search_backend_module.search_backend,
        "session_factory",
        async_sessionmaker(db.bind, expire_on_commit=False),
    )

    db.add_all(
        [
            UserIntegration(
                id=str(uuid4()),
                org_id=test_org.id,
                user_id=test_user.id,
                integration_type=IntegrationType.gmail,
                name="ops@example.com",
                config=encrypt_config(
                    {
                        "email": "ops@example.com",
                        "granted_scopes": (
                            "https://www.googleapis.com/auth/gmail.send "
                            "https://www.googleapis.com/auth/gmail.readonly "
                            "https://www.googleapis.com/auth/drive.file "
                            "https://www.googleapis.com/auth/spreadsheets"
                        ),
                    }
                ),
                is_active=True,
                created_at=datetime.now(timezone.utc),
            ),
            UserIntegration(
                id=str(uuid4()),
                org_id=test_org.id,
                user_id=test_user.id,
                integration_type=IntegrationType.slack,
                name="Aethon Workspace",
                config=encrypt_config(
                    {
                        "workspace": "Aethon Workspace",
                        "workspace_url": "https://aethon.slack.com/",
                        "access_token": "xoxb-test",
                    }
                ),
                is_active=True,
                created_at=datetime.now(timezone.utc),
            ),
            UserIntegration(
                id=str(uuid4()),
                org_id=test_org.id,
                user_id=test_user.id,
                integration_type=IntegrationType.github,
                name="Primary GitHub",
                config=encrypt_config(
                    {
                        "default_repo": "octo-org/platform",
                        "access_token": "ghp_test_token",
                    }
                ),
                is_active=True,
                created_at=datetime.now(timezone.utc),
            ),
        ]
    )
    await db.commit()

    response = await authed_client.get("/api/tools/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["gmail"]["status"] == "healthy"
    assert payload["gmail"]["note"] == "Connected as ops@example.com."
    assert payload["slack"]["status"] == "healthy"
    assert payload["slack"]["note"] == "Connected to Aethon Workspace."
    assert payload["github"]["status"] == "healthy"
    assert payload["github"]["note"] == "Connected to octo-org/platform."

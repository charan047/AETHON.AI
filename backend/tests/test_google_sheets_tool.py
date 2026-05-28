from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import IntegrationType, UserIntegration
from services.integration_crypto import encrypt_config
from tools.productivity import google_sheets as google_sheets_module
from tools.productivity.google_sheets import GoogleSheetsTool
from tools.registry import ToolRegistry


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
    def __init__(self, responses: dict[tuple[str, str], _FakeResponse], recorded: list[tuple[str, str, dict]] | None = None):
        self.responses = responses
        self.recorded = recorded if recorded is not None else []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, **kwargs):
        self.recorded.append(("POST", url, kwargs))
        return self.responses[("POST", url)]

    async def put(self, url: str, **kwargs):
        self.recorded.append(("PUT", url, kwargs))
        return self.responses[("PUT", url)]


@pytest.mark.asyncio
async def test_google_sheets_validate_auth_checks_org_connection(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
    tool = GoogleSheetsTool()
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
async def test_google_sheets_execute_returns_helpful_error_when_not_connected(db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
    tool = GoogleSheetsTool()

    result = await tool.execute(
        {"title": "Sheet", "sheet_name": "Daily", "headers": ["Item"], "rows": [["Notebook"]]},
        test_org.id,
        test_user.id,
    )

    assert result.success is False
    assert result.error == "Google not connected. Visit /integrations to connect."


@pytest.mark.asyncio
async def test_google_sheets_execute_creates_spreadsheet_and_returns_url(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
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
            "granted_scopes": (
                "https://www.googleapis.com/auth/drive.file "
                "https://www.googleapis.com/auth/spreadsheets"
            ),
        }

    monkeypatch.setattr(google_sheets_module, "refresh_gmail_oauth_tokens", fake_refresh)

    recorded: list[tuple[str, str, dict]] = []
    responses = {
        ("POST", "https://sheets.googleapis.com/v4/spreadsheets"): _FakeResponse(
            {
                "spreadsheetId": "sheet-123",
                "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/sheet-123/edit",
            }
        ),
        ("PUT", "https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/Daily!A1?valueInputOption=USER_ENTERED"): _FakeResponse(
            {"updatedRange": "Daily!A1:B3"}
        ),
    }
    monkeypatch.setattr(
        google_sheets_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses, recorded),
    )

    tool = GoogleSheetsTool()
    result = await tool.execute(
        {
            "title": "Best Sellers",
            "sheet_name": "Daily",
            "headers": ["Item", "Sales"],
            "rows": [["Notebook", 240], ["Water Bottle", 180]],
        },
        test_org.id,
        test_user.id,
    )

    assert result.success is True
    assert result.result == "https://docs.google.com/spreadsheets/d/sheet-123/edit"
    assert result.metadata["spreadsheet_id"] == "sheet-123"
    assert result.metadata["sheet_name"] == "Daily"
    assert recorded[1][2]["json"]["values"] == [
        ["Item", "Sales"],
        ["Notebook", 240],
        ["Water Bottle", 180],
    ]


@pytest.mark.asyncio
async def test_google_sheets_execute_appends_rows_to_existing_sheet(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
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
            "granted_scopes": (
                "https://www.googleapis.com/auth/drive.file "
                "https://www.googleapis.com/auth/spreadsheets"
            ),
        }

    monkeypatch.setattr(google_sheets_module, "refresh_gmail_oauth_tokens", fake_refresh)

    recorded: list[tuple[str, str, dict]] = []
    responses = {
        ("POST", "https://sheets.googleapis.com/v4/spreadsheets/existing-sheet-1/values/Leads!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"): _FakeResponse(
            {"updates": {"updatedRange": "Leads!A4:C5"}}
        ),
    }
    monkeypatch.setattr(
        google_sheets_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses, recorded),
    )

    tool = GoogleSheetsTool()
    result = await tool.execute(
        {
            "spreadsheet_id": "existing-sheet-1",
            "sheet_name": "Leads",
            "rows": [
                {"name": "Acme", "score": 92},
                {"name": "Nova", "score": 88},
            ],
        },
        test_org.id,
        test_user.id,
    )

    assert result.success is True
    assert result.metadata["spreadsheet_id"] == "existing-sheet-1"
    assert recorded[0][2]["json"]["values"] == [
        ["Acme", 92],
        ["Nova", 88],
    ]


@pytest.mark.asyncio
async def test_google_sheets_execute_accepts_spreadsheet_url_for_append(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
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
            "granted_scopes": (
                "https://www.googleapis.com/auth/drive.file "
                "https://www.googleapis.com/auth/spreadsheets"
            ),
        }

    monkeypatch.setattr(google_sheets_module, "refresh_gmail_oauth_tokens", fake_refresh)

    recorded: list[tuple[str, str, dict]] = []
    responses = {
        ("POST", "https://sheets.googleapis.com/v4/spreadsheets/existing-sheet-2/values/Leads!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"): _FakeResponse(
            {"updates": {"updatedRange": "Leads!A4:B5"}}
        ),
    }
    monkeypatch.setattr(
        google_sheets_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses, recorded),
    )

    tool = GoogleSheetsTool()
    result = await tool.execute(
        {
            "spreadsheet_url": "https://docs.google.com/spreadsheets/d/existing-sheet-2/edit#gid=0",
            "sheet_name": "Leads",
            "rows": [["Acme", 92], ["Nova", 88]],
        },
        test_org.id,
        test_user.id,
    )

    assert result.success is True
    assert result.metadata["spreadsheet_id"] == "existing-sheet-2"
    assert "existing-sheet-2" in recorded[0][1]


@pytest.mark.asyncio
async def test_google_sheets_execute_overwrites_existing_sheet_when_requested(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
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
            "granted_scopes": (
                "https://www.googleapis.com/auth/drive.file "
                "https://www.googleapis.com/auth/spreadsheets"
            ),
        }

    monkeypatch.setattr(google_sheets_module, "refresh_gmail_oauth_tokens", fake_refresh)

    recorded: list[tuple[str, str, dict]] = []
    responses = {
        ("PUT", "https://sheets.googleapis.com/v4/spreadsheets/existing-sheet-3/values/Report!B2?valueInputOption=USER_ENTERED"): _FakeResponse(
            {"updatedRange": "Report!B2:C4"}
        ),
    }
    monkeypatch.setattr(
        google_sheets_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses, recorded),
    )

    tool = GoogleSheetsTool()
    result = await tool.execute(
        {
            "spreadsheet_id": "existing-sheet-3",
            "sheet_name": "Report",
            "mode": "overwrite",
            "start_cell": "B2",
            "headers": ["Name", "Score"],
            "rows": [{"Name": "Acme", "Score": 92}, {"Name": "Nova", "Score": 88}],
        },
        test_org.id,
        test_user.id,
    )

    assert result.success is True
    assert recorded[0][0] == "PUT"
    assert recorded[0][2]["json"]["values"] == [
        ["Name", "Score"],
        ["Acme", 92],
        ["Nova", 88],
    ]


@pytest.mark.asyncio
async def test_google_sheets_execute_requires_spreadsheets_scope(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
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
        return integration, {
            "access_token": "token",
            "email": "hello@example.com",
            "granted_scopes": "https://www.googleapis.com/auth/drive.file",
        }

    monkeypatch.setattr(google_sheets_module, "refresh_gmail_oauth_tokens", fake_refresh)

    tool = GoogleSheetsTool()
    result = await tool.execute(
        {"title": "Sheet", "sheet_name": "Daily", "rows": [["Notebook"]]},
        test_org.id,
        test_user.id,
    )

    assert result.success is False
    assert result.error == "Google Sheets requires updated permissions. Reconnect Gmail in /integrations."


@pytest.mark.asyncio
async def test_google_sheets_execute_returns_expired_token_error(db, db_engine, test_org, test_user, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(google_sheets_module, "AsyncSessionLocal", session_factory)
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
            "granted_scopes": (
                "https://www.googleapis.com/auth/drive.file "
                "https://www.googleapis.com/auth/spreadsheets"
            ),
        }

    monkeypatch.setattr(google_sheets_module, "refresh_gmail_oauth_tokens", fake_refresh)

    responses = {
        ("POST", "https://sheets.googleapis.com/v4/spreadsheets"): _FakeResponse({}, status_code=401),
    }
    monkeypatch.setattr(
        google_sheets_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeHttpClient(responses),
    )

    tool = GoogleSheetsTool()
    result = await tool.execute(
        {"title": "Sheet", "sheet_name": "Daily", "rows": [["Notebook"]]},
        test_org.id,
        test_user.id,
    )

    assert result.success is False
    assert result.error == "Google token expired. Reconnect Gmail in /integrations."


@pytest.mark.asyncio
async def test_google_sheets_legacy_alias_resolves_to_real_tool():
    registry = ToolRegistry()
    previous_tool_classes = dict(registry._tool_classes)
    previous_tool_instances = dict(registry._tool_instances)
    previous_catalog_instances = dict(registry._catalog_instances)
    previous_instances = dict(registry._instances)
    try:
        registry.register(GoogleSheetsTool())
        instance = await registry.get_tool_instance("google_sheets_create", "user-1", {})
        assert instance.name == "google_sheets"
    finally:
        registry._tool_classes = previous_tool_classes
        registry._tool_instances = previous_tool_instances
        registry._catalog_instances = previous_catalog_instances
        registry._instances = previous_instances


def test_google_sheets_schema_and_description_guide_agent_usage():
    tool = GoogleSheetsTool()
    schema = tool.get_schema()

    assert "append rows" in tool.description.lower()
    assert "spreadsheet_url" in schema["properties"]
    assert "mode" in schema["properties"]
    assert "start_cell" in schema["properties"]

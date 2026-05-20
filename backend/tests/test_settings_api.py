import pytest


@pytest.mark.asyncio
async def test_memory_status_reports_configuration_state(authed_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "mem0_enabled", True, raising=False)
    monkeypatch.setattr(settings, "mem0_api_key", "", raising=False)

    response = await authed_client.get("/api/settings/memory-status")

    assert response.status_code == 200
    assert response.json() == {
        "mem0_enabled": True,
        "mem0_configured": False,
    }

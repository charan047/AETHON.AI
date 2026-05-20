import pytest


@pytest.mark.asyncio
async def test_tool_health_marks_search_as_not_configured_without_api_keys(authed_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "brave_search_api_key", "", raising=False)
    monkeypatch.setattr(settings, "serper_api_key", "", raising=False)

    response = await authed_client.get("/api/tools/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["search"]["status"] == "not_configured"
    assert "No search API configured" in payload["search"]["note"]

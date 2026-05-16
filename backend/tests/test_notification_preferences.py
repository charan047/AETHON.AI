from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_notification_preferences_default_and_update(authed_client):
    get_response = await authed_client.get("/api/notifications/preferences")
    assert get_response.status_code == 200
    default_payload = get_response.json()
    assert default_payload["email_on_approval_needed"] is True
    assert default_payload["daily_digest_enabled"] is True

    update_response = await authed_client.put(
        "/api/notifications/preferences",
        json={
            "email_on_approval_needed": False,
            "email_on_execution_complete": True,
            "email_on_autonomy_change": False,
            "daily_digest_enabled": True,
            "daily_digest_time": "07:30",
            "notification_email": "owner@example.com",
        },
    )

    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload["email_on_approval_needed"] is False
    assert payload["email_on_execution_complete"] is True
    assert payload["email_on_autonomy_change"] is False
    assert payload["daily_digest_time"] == "07:30"
    assert payload["notification_email"] == "owner@example.com"

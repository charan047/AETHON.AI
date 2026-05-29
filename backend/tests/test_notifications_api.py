from datetime import datetime, timedelta

import pytest

from database.models import InAppNotification, NotificationPriority


@pytest.mark.asyncio
async def test_notifications_list_unread_count_mark_read_and_dismiss(
    authed_client,
    db,
    test_org,
    test_user,
):
    older = InAppNotification(
        org_id=test_org.id,
        user_id=test_user.id,
        title="Approval needed",
        message="A workflow is waiting for review.",
        priority=NotificationPriority.urgent,
        action_url="/approvals",
        created_at=datetime.utcnow() - timedelta(minutes=5),
    )
    newer = InAppNotification(
        org_id=test_org.id,
        user_id=test_user.id,
        title="Mission finished",
        message="Your delegated project is complete.",
        priority=NotificationPriority.normal,
        action_url="/company-chat",
        is_read=True,
        created_at=datetime.utcnow(),
    )
    db.add_all([older, newer])
    await db.commit()

    listing = await authed_client.get("/api/notifications")
    assert listing.status_code == 200
    payload = listing.json()
    assert [item["id"] for item in payload] == [newer.id, older.id]
    assert payload[0]["notification_type"] == "cto_update"
    assert payload[1]["notification_type"] == "approval_request"

    unread_only = await authed_client.get("/api/notifications", params={"unread_only": True})
    assert unread_only.status_code == 200
    assert len(unread_only.json()) == 1
    assert unread_only.json()[0]["id"] == older.id

    unread_count = await authed_client.get("/api/notifications/unread-count")
    assert unread_count.status_code == 200
    assert unread_count.json() == {"count": 1}

    mark_read = await authed_client.post(
        "/api/notifications/mark-read",
        json={"notification_ids": [older.id]},
    )
    assert mark_read.status_code == 200
    assert mark_read.json() == {"updated": 1}

    unread_count_after = await authed_client.get("/api/notifications/unread-count")
    assert unread_count_after.status_code == 200
    assert unread_count_after.json() == {"count": 0}

    dismiss = await authed_client.delete(f"/api/notifications/{newer.id}")
    assert dismiss.status_code == 204

    after_delete = await authed_client.get("/api/notifications")
    assert after_delete.status_code == 200
    assert len(after_delete.json()) == 1
    assert after_delete.json()[0]["id"] == older.id


@pytest.mark.asyncio
async def test_notifications_mark_all_read(
    authed_client,
    db,
    test_org,
    test_user,
):
    first = InAppNotification(
        org_id=test_org.id,
        user_id=test_user.id,
        title="File saved",
        message="A deliverable is ready.",
        priority=NotificationPriority.normal,
        action_url="/files/123",
    )
    second = InAppNotification(
        org_id=test_org.id,
        user_id=test_user.id,
        title="Message received",
        message="A teammate sent an update.",
        priority=NotificationPriority.normal,
        action_url="/messages",
    )
    db.add_all([first, second])
    await db.commit()

    response = await authed_client.post("/api/notifications/mark-read", json={"all": True})
    assert response.status_code == 200
    assert response.json() == {"updated": 2}

    unread_count = await authed_client.get("/api/notifications/unread-count")
    assert unread_count.status_code == 200
    assert unread_count.json() == {"count": 0}

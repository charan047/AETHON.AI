from __future__ import annotations

import pytest

from database.models import OrgStorageQuota
from services.storage_service import storage_service


@pytest.mark.asyncio
async def test_upload_blocked_when_over_quota(
    authed_client,
    db,
    test_org,
    monkeypatch,
    tmp_path,
):
    from config import settings

    monkeypatch.setattr(settings, "storage_provider", "local")
    monkeypatch.setattr(storage_service, "_local_root", lambda: tmp_path)

    await storage_service.write_document(
        org_id=test_org.id,
        file_id="quota-seed",
        content=b"ab",
        content_type="text/plain",
        filename="seed.txt",
    )

    quota = OrgStorageQuota(
        org_id=test_org.id,
        used_bytes=0,
        quota_bytes=1,
    )
    db.add(quota)
    await db.commit()

    response = await authed_client.post(
        "/api/files/upload-url",
        json={
            "filename": "big-file.txt",
            "content_type": "text/plain",
        },
    )
    assert response.status_code == 402
    assert "quota" in response.json()["detail"].lower()

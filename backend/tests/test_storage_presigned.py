from __future__ import annotations

import os

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import FileStatus, OrgFile
from tasks.file_tasks import activate_file, validate_and_activate_file


@pytest.mark.asyncio
async def test_presigned_upload_bypasses_backend(
    authed_client,
    auth_headers,
    db,
    db_engine,
    monkeypatch,
):
    from config import settings

    endpoint = os.getenv("AETHON_PRESIGNED_TEST_ENDPOINT", "http://127.0.0.1:3900")
    public_url = os.getenv("AETHON_PRESIGNED_TEST_PUBLIC_URL", endpoint)
    host = endpoint.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]

    monkeypatch.setattr(settings, "storage_provider", "garage")
    monkeypatch.setattr(settings, "storage_endpoint", endpoint)
    monkeypatch.setattr(settings, "storage_public_url", public_url)
    monkeypatch.setattr(validate_and_activate_file, "delay", lambda file_id: None)

    response = await authed_client.post(
        "/api/files/upload-url",
        json={
            "filename": "test-doc.txt",
            "content_type": "text/plain",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()
    assert "upload_url" in payload
    assert host in payload["upload_url"]
    assert "/api/files/" not in payload["upload_url"]
    file_id = payload["file_id"]

    content = b"test content for presigned upload"
    try:
        async with httpx.AsyncClient(timeout=10.0) as external_client:
            put_response = await external_client.put(
                payload["upload_url"],
                content=content,
                headers={"Content-Type": "text/plain"},
            )
    except (httpx.HTTPError, OSError) as exc:
        pytest.skip(f"Garage S3 endpoint is not reachable for direct upload: {exc}")
    assert put_response.status_code in {200, 204}

    complete_response = await authed_client.post(
        "/api/files/upload-complete",
        json={
            "file_id": file_id,
            "size_bytes": len(content),
        },
        headers=auth_headers,
    )
    assert complete_response.status_code == 200

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    await activate_file(file_id, session_factory=session_factory)

    stored = await db.scalar(select(OrgFile).where(OrgFile.id == file_id))
    assert stored is not None
    assert stored.status == FileStatus.ready

    file_response = await authed_client.get(f"/api/files/{file_id}", headers=auth_headers)
    assert file_response.status_code == 200
    assert file_response.json()["status"] == FileStatus.ready.value

    download_response = await authed_client.get(f"/api/files/{file_id}/download-url", headers=auth_headers)
    assert download_response.status_code == 200
    assert host in download_response.json()["download_url"]
    assert "/api/files/" not in download_response.json()["download_url"]

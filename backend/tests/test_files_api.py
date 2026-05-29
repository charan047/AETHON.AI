from datetime import datetime
import asyncio
import io

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from auth.security import create_access_token
from database.models import (
    Client,
    DocumentComment,
    Execution,
    ExecutionStatus,
    FileStatus,
    FileType,
    OrgFile,
    OrgMember,
    OrgMemberRole,
    OrgStorageQuota,
    User,
    UserRole,
)
from services.storage_service import storage_service
from tasks.file_tasks import activate_file, validate_and_activate_file


@pytest.fixture
def local_storage(tmp_path, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "storage_provider", "local")
    monkeypatch.setattr(storage_service, "_local_root", lambda: tmp_path)
    return tmp_path


@pytest.fixture
def sync_file_activation(monkeypatch):
    monkeypatch.setattr(validate_and_activate_file, "delay", lambda file_id: None)


@pytest.mark.asyncio
async def test_local_upload_complete_list_delete_flow(
    authed_client,
    db,
    db_engine,
    test_org,
    test_user,
    local_storage,
    sync_file_activation,
):
    create = await authed_client.post(
        "/api/files/upload-url",
        json={
            "filename": "competitor-brief.md",
            "content_type": "text/markdown",
            "description": "Competitor brief",
        },
    )
    assert create.status_code == 201
    payload = create.json()
    file_id = payload["file_id"]
    assert "/api/files/local-upload/" in payload["upload_url"]

    upload = await authed_client.put(
        f"/api/files/local-upload/{file_id}",
        content=b"# Competitor Brief\nAcme is the main competitor.\n",
        headers={"Content-Type": "text/markdown"},
    )
    assert upload.status_code == 204

    complete = await authed_client.post(
        "/api/files/upload-complete",
        json={"file_id": file_id, "size_bytes": 47},
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "processing"

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    await activate_file(file_id, session_factory=session_factory)

    stored = await db.scalar(select(OrgFile).where(OrgFile.id == file_id))
    assert stored
    assert stored.status == FileStatus.ready

    listing = await authed_client.get("/api/files")
    assert listing.status_code == 200
    items = listing.json()["files"]
    assert items[0]["id"] == file_id
    assert items[0]["download_url"].endswith(f"/api/files/{file_id}/content")

    search = await authed_client.get("/api/files", params={"search": "competitor"})
    assert search.status_code == 200
    assert any(item["id"] == file_id for item in search.json()["files"])

    delete = await authed_client.delete(f"/api/files/{file_id}")
    assert delete.status_code == 200
    assert delete.json()["status"] == "deleted"

    deleted = await db.scalar(select(OrgFile).where(OrgFile.id == file_id))
    assert deleted.status == FileStatus.deleted


@pytest.mark.asyncio
async def test_approve_execution_autosaves_org_file(
    authed_client,
    db,
    test_org,
    test_user,
    test_workflow,
    local_storage,
):
    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        status=ExecutionStatus.pending_review,
        input_message="Review this output",
        output_message="This is a long approved output that should be saved into the org workspace automatically after approval.",
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/approve",
        json={"note": "Looks good"},
    )
    assert response.status_code == 200

    saved_files = (
        await db.execute(
            select(OrgFile).where(OrgFile.execution_id == execution.id, OrgFile.org_id == test_org.id)
        )
    ).scalars().all()
    assert len(saved_files) == 1
    assert saved_files[0].status == FileStatus.ready
    assert saved_files[0].file_type.value == "markdown"


@pytest.mark.asyncio
async def test_create_document_patch_and_agent_write(
    authed_client,
    db,
    test_org,
    monkeypatch,
    local_storage,
):
    calls: list[dict] = []

    async def fake_write_to_document(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(
        "services.agent_doc_writer.agent_doc_writer.write_to_document",
        fake_write_to_document,
    )

    created = await authed_client.post(
        "/api/files/document",
        json={"name": "Quarterly Brief", "description": "Shared draft"},
    )
    assert created.status_code == 201
    payload = created.json()
    file_id = payload["file_id"]
    assert payload["collab_room"].startswith(f"org-{test_org.id}-doc-")

    patched = await authed_client.patch(
        f"/api/files/{file_id}",
        json={"extracted_text": "Competitor changes and client priorities."},
    )
    assert patched.status_code == 200
    assert patched.json()["file_type"] == FileType.document.value

    stored = await db.scalar(select(OrgFile).where(OrgFile.id == file_id, OrgFile.org_id == test_org.id))
    assert stored is not None
    assert stored.extracted_text == "Competitor changes and client priorities."

    streamed = await authed_client.post(
        f"/api/files/{file_id}/agent-write",
        json={"content": "Draft a polished client summary.", "agent_name": "Strategy Agent"},
    )
    assert streamed.status_code == 200
    assert streamed.json()["status"] == "streamed"
    assert len(calls) == 1
    assert calls[0]["room"] == stored.collab_room
    assert calls[0]["content"] == "Draft a polished client summary."
    assert calls[0]["agent_name"] == "Strategy Agent"
    assert calls[0]["org_id"] == test_org.id
    assert isinstance(calls[0]["auth_token"], str)


@pytest.mark.asyncio
async def test_export_document_as_markdown_docx_and_pdf(
    authed_client,
    db,
    test_org,
    local_storage,
):
    created = await authed_client.post(
        "/api/files/document",
        json={"name": "Board Update", "description": "Quarterly document"},
    )
    assert created.status_code == 201
    file_id = created.json()["file_id"]

    patched = await authed_client.patch(
        f"/api/files/{file_id}",
        json={"extracted_text": "Acme is prioritizing a faster launch cadence."},
    )
    assert patched.status_code == 200

    markdown_response = await authed_client.get(
        f"/api/files/{file_id}/export",
        params={"format": "markdown"},
    )
    assert markdown_response.status_code == 200
    assert b"Acme is prioritizing a faster launch cadence." in markdown_response.content
    assert markdown_response.headers["content-disposition"].endswith('.md"')

    docx_response = await authed_client.get(
        f"/api/files/{file_id}/export",
        params={"format": "docx"},
    )
    assert docx_response.status_code == 200
    assert docx_response.headers["content-disposition"].endswith('.docx"')
    assert docx_response.content[:2] == b"PK"

    pdf_response = await authed_client.get(
        f"/api/files/{file_id}/export",
        params={"format": "pdf"},
    )
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-disposition"].endswith('.pdf"')
    assert pdf_response.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_activate_file_broadcasts_rich_file_ready_event(
    db,
    db_engine,
    test_org,
    test_agent,
    local_storage,
    monkeypatch,
):
    client = Client(
        org_id=test_org.id,
        name="Atlas",
        company_name="Atlas Corp",
        color="#6366F1",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    file = OrgFile(
        org_id=test_org.id,
        client_id=client.id,
        agent_id=test_agent.id,
        name="atlas-brief.md",
        file_type=FileType.markdown,
        status=FileStatus.pending,
        storage_key="orgs/test-org/clients/atlas/uploads/raw/file-1/atlas-brief.md",
        size_bytes=2048,
        content_type="text/markdown",
    )
    db.add(file)
    await db.commit()
    await db.refresh(file)

    broadcasts: list[tuple[str, dict]] = []

    async def fake_move_to_safe(raw_key, org_id, file_id, filename, client_id):
        return raw_key.replace("/raw/", "/safe/")

    async def fake_read_document(_storage_key: str):
        return b"# Atlas Brief\nThis is a deliverable."

    async def fake_broadcast(channel: str, payload: dict):
        broadcasts.append((channel, payload))

    monkeypatch.setattr("services.storage_service.storage_service.move_to_safe", fake_move_to_safe)
    monkeypatch.setattr("services.storage_service.storage_service.read_document", fake_read_document)
    monkeypatch.setattr("services.websocket_manager.ws_manager.broadcast_to_channel", fake_broadcast)

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    await activate_file(file.id, session_factory=session_factory)

    assert len(broadcasts) == 1
    channel, payload = broadcasts[0]
    assert channel == f"org:{test_org.id}"
    assert payload["event"] == "file_ready"
    assert payload["file_id"] == file.id
    assert payload["name"] == "atlas-brief.md"
    assert payload["file_type"] == "markdown"
    assert payload["client_id"] == client.id
    assert payload["client_name"] == "Atlas Corp"
    assert payload["agent_id"] == test_agent.id
    assert payload["size_bytes"] == 2048
    assert payload["navigate_to"] == f"/files/{file.id}"
    assert isinstance(payload["created_at"], str)


@pytest.mark.asyncio
async def test_storage_usage_endpoint_returns_quota_and_file_count(
    authed_client,
    db,
    test_org,
):
    quota = OrgStorageQuota(
        org_id=test_org.id,
        used_bytes=8 * 1024 * 1024 * 1024,
        quota_bytes=10 * 1024 * 1024 * 1024,
    )
    db.add(quota)
    db.add(
        OrgFile(
            org_id=test_org.id,
            name="brief-one.md",
            file_type=FileType.markdown,
            status=FileStatus.ready,
            size_bytes=1024,
        )
    )
    db.add(
        OrgFile(
            org_id=test_org.id,
            name="brief-two.md",
            file_type=FileType.markdown,
            status=FileStatus.ready,
            size_bytes=2048,
        )
    )
    await db.commit()

    response = await authed_client.get("/api/files/storage/usage")
    assert response.status_code == 200

    payload = response.json()
    assert payload["used_bytes"] == 8 * 1024 * 1024 * 1024
    assert payload["quota_bytes"] == 10 * 1024 * 1024 * 1024
    assert payload["used_gb"] == 8.0
    assert payload["quota_gb"] == 10.0
    assert payload["percent_used"] == 80.0
    assert payload["file_count"] == 2
    assert payload["status"] == "warning"


@pytest.mark.asyncio
async def test_document_comments_crud_flow(
    authed_client,
    db,
    test_org,
    local_storage,
):
    created = await authed_client.post(
        "/api/files/document",
        json={"name": "Commented Brief", "description": "Shared draft"},
    )
    assert created.status_code == 201
    file_id = created.json()["file_id"]

    comment_create = await authed_client.post(
        f"/api/files/{file_id}/comments",
        json={
            "comment_id": "comment-123",
            "content": "Tighten this recommendation with one concrete metric.",
            "quoted_text": "Launch faster than competitors",
        },
    )
    assert comment_create.status_code == 201
    created_comment = comment_create.json()
    assert created_comment["comment_id"] == "comment-123"
    assert created_comment["resolved"] is False
    assert created_comment["quoted_text"] == "Launch faster than competitors"

    list_response = await authed_client.get(f"/api/files/{file_id}/comments")
    assert list_response.status_code == 200
    listed_comments = list_response.json()
    assert len(listed_comments) == 1
    assert listed_comments[0]["content"] == "Tighten this recommendation with one concrete metric."
    assert listed_comments[0]["created_by_name"] == "Test User"

    resolve_response = await authed_client.patch(
        f"/api/files/{file_id}/comments/comment-123/resolve"
    )
    assert resolve_response.status_code == 200
    assert resolve_response.json()["resolved"] is True

    unresolved_response = await authed_client.get(f"/api/files/{file_id}/comments")
    assert unresolved_response.status_code == 200
    assert unresolved_response.json() == []

    stored_comment = await db.scalar(
        select(DocumentComment).where(
            DocumentComment.file_id == file_id,
            DocumentComment.org_id == test_org.id,
            DocumentComment.comment_id == "comment-123",
        )
    )
    assert stored_comment is not None
    assert stored_comment.resolved is True
    assert stored_comment.resolved_at is not None


@pytest.mark.asyncio
async def test_document_comment_delete_requires_creator_or_org_admin(
    authed_client,
    db,
    test_org,
    local_storage,
):
    created = await authed_client.post(
        "/api/files/document",
        json={"name": "Delete Test", "description": "Shared draft"},
    )
    assert created.status_code == 201
    file_id = created.json()["file_id"]

    comment_create = await authed_client.post(
        f"/api/files/{file_id}/comments",
        json={
            "comment_id": "comment-delete",
            "content": "Please revise this section.",
            "quoted_text": "Original phrase",
        },
    )
    assert comment_create.status_code == 201

    outsider = User(
        email="member@example.com",
        hashed_password="ignored",
        full_name="Member User",
        role=UserRole.editor,
        is_active=True,
    )
    db.add(outsider)
    await db.commit()
    await db.refresh(outsider)
    db.add(
        OrgMember(
            org_id=test_org.id,
            user_id=outsider.id,
            role=OrgMemberRole.member,
        )
    )
    await db.commit()

    outsider_token = create_access_token(outsider.id, outsider.role.value)
    delete_response = await authed_client.delete(
        f"/api/files/{file_id}/comments/comment-delete",
        headers={
            "Authorization": f"Bearer {outsider_token}",
            "X-Org-Id": test_org.id,
        },
    )
    assert delete_response.status_code == 403

    owner_delete = await authed_client.delete(
        f"/api/files/{file_id}/comments/comment-delete"
    )
    assert owner_delete.status_code == 200

    stored_comment = await db.scalar(
        select(DocumentComment).where(
            DocumentComment.file_id == file_id,
            DocumentComment.org_id == test_org.id,
            DocumentComment.comment_id == "comment-delete",
        )
    )
    assert stored_comment is None

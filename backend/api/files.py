from __future__ import annotations

from datetime import datetime
import io
from pathlib import Path
from typing import Any, Optional
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, or_, select, text as text_q, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from celery_app import celery_app
from config import settings
from database import get_db
from database.models import (
    Client,
    FileStatus,
    FileType,
    OrgFile,
    OrgStorageQuota,
    User,
)
from services.storage_service import storage_service


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class FileUploadUrlRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=500)
    content_type: str = Field(..., min_length=1, max_length=200)
    client_id: str | None = None
    description: str | None = None


class FileUploadCompleteRequest(BaseModel):
    file_id: str
    size_bytes: int = Field(..., ge=0)
    checksum_sha256: str | None = Field(None, min_length=16, max_length=64)


class FileCreateDocumentRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    client_id: str | None = None
    description: str | None = None


class FileCreateVersionRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=500)
    content_type: str = Field(..., min_length=1, max_length=200)
    description: str | None = None


class FileUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=500)
    description: str | None = None
    extracted_text: str | None = None
    tags: list[str] | None = None


class FileAgentWriteRequest(BaseModel):
    content: str = Field(..., min_length=1)
    agent_name: str = Field("Aethon Agent", min_length=1, max_length=120)


class FileExportFormat(str):
    markdown = "markdown"
    pdf = "pdf"
    docx = "docx"


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _detect_file_type(content_type: str, filename: str) -> FileType:
    lower = (content_type or "").lower()
    suffix = Path(filename).suffix.lower()
    if lower == "application/pdf" or suffix == ".pdf":
        return FileType.pdf
    if "wordprocessingml" in lower or suffix == ".docx":
        return FileType.docx
    if lower.startswith("image/"):
        return FileType.image
    if lower == "text/markdown" or suffix in {".md", ".markdown"}:
        return FileType.markdown
    if lower.startswith("text/"):
        return FileType.text
    return FileType.other


async def _validate_client_access(client_id: str | None, org_id: str, db: AsyncSession) -> None:
    if not client_id:
        return
    client = await db.scalar(select(Client.id).where(Client.id == client_id, Client.org_id == org_id))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")


async def _get_or_create_quota(org_id: str, db: AsyncSession) -> OrgStorageQuota:
    quota = await db.scalar(select(OrgStorageQuota).where(OrgStorageQuota.org_id == org_id))
    if quota:
        return quota
    quota = OrgStorageQuota(org_id=org_id)
    db.add(quota)
    await db.flush()
    return quota


async def _refresh_quota(org_id: str, db: AsyncSession) -> OrgStorageQuota:
    quota = await _get_or_create_quota(org_id, db)
    quota.used_bytes = await storage_service.get_org_usage_bytes(org_id)
    quota.updated_at = datetime.utcnow()
    await db.flush()
    return quota


async def _org_file_or_404(file_id: str, org_id: str, db: AsyncSession) -> OrgFile:
    item = await db.scalar(select(OrgFile).where(OrgFile.id == file_id, OrgFile.org_id == org_id))
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
    return item


async def _resolve_download_url(file: OrgFile, request: Request) -> str | None:
    if not file.storage_key or _enum_value(file.status) != FileStatus.ready.value:
        return None
    if storage_service._uses_local_storage():
        return str(request.url_for("download_local_file_content", file_id=file.id))
    return await storage_service.generate_download_url(file.storage_key, file.name)


async def _serialize_file(file: OrgFile, request: Request) -> dict[str, Any]:
    return {
        "id": file.id,
        "org_id": file.org_id,
        "client_id": file.client_id,
        "agent_id": file.agent_id,
        "execution_id": file.execution_id,
        "mission_id": file.mission_id,
        "name": file.name,
        "description": file.description,
        "file_type": _enum_value(file.file_type),
        "status": _enum_value(file.status),
        "storage_key": file.storage_key,
        "size_bytes": file.size_bytes,
        "content_type": file.content_type,
        "checksum_sha256": file.checksum_sha256,
        "version": file.version,
        "parent_file_id": file.parent_file_id,
        "is_latest": file.is_latest,
        "collab_room": file.collab_room,
        "yjs_storage_key": file.yjs_storage_key,
        "tags": file.tags or [],
        "created_by": file.created_by,
        "created_at": file.created_at,
        "updated_at": file.updated_at,
        "last_accessed_at": file.last_accessed_at,
        "download_url": await _resolve_download_url(file, request),
    }


async def _root_file(file: OrgFile, db: AsyncSession) -> OrgFile:
    current = file
    while current.parent_file_id:
        parent = await db.scalar(select(OrgFile).where(OrgFile.id == current.parent_file_id))
        if not parent:
            break
        current = parent
    return current


async def _load_versions(file: OrgFile, db: AsyncSession) -> list[OrgFile]:
    versions: list[OrgFile] = []
    current = await _root_file(file, db)
    versions.append(current)
    while True:
        child = await db.scalar(
            select(OrgFile)
            .where(OrgFile.parent_file_id == current.id)
            .order_by(OrgFile.version.asc())
            .limit(1)
        )
        if not child:
            break
        versions.append(child)
        current = child
    return versions


def _export_basename(file: OrgFile) -> str:
    stem = Path(file.name or "document").stem.strip() or "document"
    return stem[:120]


def _file_export_text(file: OrgFile) -> str:
    return (file.extracted_text or "").strip() or (file.description or "").strip() or file.name


def _render_docx_bytes(title: str, content: str) -> bytes:
    buffer = io.BytesIO()
    paragraphs = [title.strip(), *(line.strip() for line in content.split("\n"))]
    paragraph_xml = "".join(
        f"<w:p><w:r><w:t xml:space=\"preserve\">{(paragraph or ' ').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}</w:t></w:r></w:p>"
        for paragraph in paragraphs
        if paragraph is not None
    )
    document_xml = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
        f"<w:body>{paragraph_xml}<w:sectPr/></w:body></w:document>"
    )
    content_types_xml = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
        "</Types>"
    )
    rels_xml = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>"
        "</Relationships>"
    )
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", rels_xml)
        archive.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


def _render_pdf_bytes(title: str, content: str) -> bytes:
    lines = [title.strip(), "", *(line.strip() for line in content.split("\n"))]
    escaped_lines = []
    for line in lines:
        escaped = (
            line.replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )
        escaped_lines.append(escaped)
    content_stream = ["BT", "/F1 12 Tf", "50 780 Td", "14 TL"]
    for index, line in enumerate(escaped_lines):
        if index == 0:
            content_stream.append(f"({line}) Tj")
        else:
            content_stream.append("T*")
            content_stream.append(f"({line}) Tj")
    content_stream.append("ET")
    stream_body = "\n".join(content_stream).encode("utf-8")

    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        f"5 0 obj << /Length {len(stream_body)} >> stream\n".encode("utf-8") + stream_body + b"\nendstream endobj",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
        pdf.extend(b"\n")
    xref_start = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("utf-8"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    pdf.extend(
        (
            f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_start}\n%%EOF"
        ).encode("utf-8")
    )
    return bytes(pdf)


@router.get("")
async def list_files(
    request: Request,
    client_id: str | None = Query(None),
    file_type: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    query = select(OrgFile).where(OrgFile.org_id == ctx.org.id, OrgFile.status != FileStatus.deleted)
    count_query = select(func.count(OrgFile.id)).where(OrgFile.org_id == ctx.org.id, OrgFile.status != FileStatus.deleted)

    if client_id:
        query = query.where(OrgFile.client_id == client_id)
        count_query = count_query.where(OrgFile.client_id == client_id)
    if file_type:
        query = query.where(OrgFile.file_type == file_type)
        count_query = count_query.where(OrgFile.file_type == file_type)
    if search:
        search_text = search.strip()
        if "sqlite" in str(db.bind.url):
            predicate = or_(
                OrgFile.name.ilike(f"%{search_text}%"),
                OrgFile.description.ilike(f"%{search_text}%"),
                OrgFile.extracted_text.ilike(f"%{search_text}%"),
            )
            query = query.where(predicate)
            count_query = count_query.where(predicate)
        else:
            query = query.where(text_q("search_vector @@ plainto_tsquery('english', :query)")).params(query=search_text)
            count_query = count_query.where(text_q("search_vector @@ plainto_tsquery('english', :query)")).params(query=search_text)

    total = await db.scalar(count_query)
    items = (
        await db.execute(query.order_by(OrgFile.created_at.desc()).limit(limit).offset(offset))
    ).scalars().all()

    return {
        "files": [await _serialize_file(item, request) for item in items],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
    }


@router.post("/upload-url", status_code=201)
async def create_upload_url(
    data: FileUploadUrlRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await _validate_client_access(data.client_id, ctx.org.id, db)
    quota = await _refresh_quota(ctx.org.id, db)
    if quota.used_bytes >= quota.quota_bytes:
        raise HTTPException(status_code=402, detail="Storage quota exceeded")

    file = OrgFile(
        org_id=ctx.org.id,
        client_id=data.client_id,
        name=data.filename,
        description=data.description,
        file_type=_detect_file_type(data.content_type, data.filename),
        status=FileStatus.pending,
        content_type=data.content_type,
        created_by=str(current_user.id),
    )
    db.add(file)
    await db.flush()

    if storage_service._uses_local_storage():
        storage_key = storage_service._key(
            ctx.org.id,
            data.client_id,
            file.id,
            data.filename,
            subfolder="uploads/raw",
        )
        upload_url = str(request.url_for("local_file_upload", file_id=file.id))
        file.storage_key = storage_key
        await db.commit()
        return {
            "file_id": file.id,
            "upload_url": upload_url,
            "storage_key": storage_key,
            "expires_in": 900,
        }

    upload = await storage_service.generate_upload_url(
        org_id=ctx.org.id,
        file_id=file.id,
        filename=data.filename,
        content_type=data.content_type,
        client_id=data.client_id,
    )
    file.storage_key = upload["storage_key"]
    await db.commit()

    return {
        "file_id": file.id,
        **upload,
    }


@router.put("/local-upload/{file_id}", name="local_file_upload")
async def local_file_upload(
    file_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    if not storage_service._uses_local_storage():
        raise HTTPException(status_code=404, detail="Local upload is not enabled")
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    body = await request.body()
    if len(body) > 0 and len(body) > settings.storage_quota_per_file:
        raise HTTPException(status_code=413, detail="File exceeds per-file storage limit")
    await storage_service.write_raw_upload(
        file.storage_key or "",
        body,
        file.content_type or request.headers.get("content-type", "application/octet-stream"),
    )
    file.status = FileStatus.uploading
    file.updated_at = datetime.utcnow()
    await db.commit()
    return Response(status_code=204)


@router.post("/upload-complete")
async def mark_upload_complete(
    data: FileUploadCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    file = await _org_file_or_404(data.file_id, ctx.org.id, db)
    if data.size_bytes > settings.storage_quota_per_file:
        raise HTTPException(status_code=413, detail="File exceeds per-file storage limit")
    file.size_bytes = data.size_bytes
    file.checksum_sha256 = data.checksum_sha256
    file.status = FileStatus.uploading
    file.updated_at = datetime.utcnow()
    await db.commit()

    from tasks.file_tasks import validate_and_activate_file

    validate_and_activate_file.delay(file.id)
    return {"file_id": file.id, "status": "processing"}


@router.get("/{file_id}")
async def get_file(
    file_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    file.last_accessed_at = datetime.utcnow()
    await db.commit()
    await db.refresh(file)
    return await _serialize_file(file, request)


@router.patch("/{file_id}")
async def update_file(
    file_id: str,
    data: FileUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    del current_user
    file = await _org_file_or_404(file_id, ctx.org.id, db)

    if data.name is not None:
        file.name = data.name.strip() or file.name
    if data.description is not None:
        file.description = data.description
    if data.tags is not None:
        file.tags = [tag for tag in data.tags if tag]
    if data.extracted_text is not None:
        normalized_text = data.extracted_text[:50_000]
        file.extracted_text = normalized_text
        if "sqlite" in str(db.bind.url):
            file.search_vector = normalized_text
        else:
            await db.execute(
                text_q(
                    "UPDATE org_files SET search_vector = "
                    "to_tsvector('english', :txt) WHERE id = :id"
                ),
                {"txt": normalized_text, "id": file.id},
            )

    file.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(file)
    return await _serialize_file(file, request)


@router.get("/{file_id}/download-url")
async def get_download_url(
    file_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    url = await _resolve_download_url(file, request)
    if not url:
        raise HTTPException(status_code=409, detail="File is not ready for download")
    return {"file_id": file.id, "download_url": url, "expires_in": 3600}


@router.get("/{file_id}/export")
async def export_file(
    file_id: str,
    format: str = Query(..., pattern="^(markdown|pdf|docx)$"),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    export_text = _file_export_text(file)
    basename = _export_basename(file)

    if format == "markdown":
        content = export_text.encode("utf-8")
        filename = f"{basename}.md"
        media_type = "text/markdown; charset=utf-8"
    elif format == "docx":
        content = _render_docx_bytes(file.name, export_text)
        filename = f"{basename}.docx"
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        content = _render_pdf_bytes(file.name, export_text)
        filename = f"{basename}.pdf"
        media_type = "application/pdf"

    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{file_id}/content", name="download_local_file_content")
async def download_local_file_content(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    if not storage_service._uses_local_storage():
        raise HTTPException(status_code=404, detail="Local file content route is disabled")
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    if not file.storage_key or _enum_value(file.status) != FileStatus.ready.value:
        raise HTTPException(status_code=409, detail="File is not ready for download")
    content = await storage_service.read_document(file.storage_key)
    file.last_accessed_at = datetime.utcnow()
    await db.commit()
    return StreamingResponse(
        iter([content]),
        media_type=file.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{file.name}"'},
    )


@router.get("/{file_id}/versions")
async def get_file_versions(
    file_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    versions = await _load_versions(file, db)
    return [await _serialize_file(item, request) for item in versions]


@router.post("/{file_id}/version", status_code=201)
async def create_file_version(
    file_id: str,
    data: FileCreateVersionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    source = await _org_file_or_404(file_id, ctx.org.id, db)
    await _validate_client_access(source.client_id, ctx.org.id, db)

    await db.execute(
        update(OrgFile)
        .where(OrgFile.org_id == ctx.org.id, OrgFile.is_latest == True, or_(OrgFile.id == source.id, OrgFile.parent_file_id == source.id))  # noqa: E712
        .values(is_latest=False, updated_at=datetime.utcnow())
    )

    file = OrgFile(
        org_id=ctx.org.id,
        client_id=source.client_id,
        agent_id=source.agent_id,
        execution_id=source.execution_id,
        mission_id=source.mission_id,
        name=data.filename,
        description=data.description if data.description is not None else source.description,
        file_type=_detect_file_type(data.content_type, data.filename),
        status=FileStatus.pending,
        content_type=data.content_type,
        version=(source.version or 1) + 1,
        parent_file_id=source.id,
        is_latest=True,
        created_by=str(current_user.id),
    )
    db.add(file)
    await db.flush()

    if storage_service._uses_local_storage():
        storage_key = storage_service._key(
            ctx.org.id,
            source.client_id,
            file.id,
            data.filename,
            subfolder="uploads/raw",
        )
        file.storage_key = storage_key
        await db.commit()
        return {
            "file_id": file.id,
            "upload_url": str(request.url_for("local_file_upload", file_id=file.id)),
            "storage_key": storage_key,
            "expires_in": 900,
            "version": file.version,
        }

    upload = await storage_service.generate_upload_url(
        org_id=ctx.org.id,
        file_id=file.id,
        filename=data.filename,
        content_type=data.content_type,
        client_id=source.client_id,
    )
    file.storage_key = upload["storage_key"]
    await db.commit()
    return {"file_id": file.id, "version": file.version, **upload}


@router.post("/{file_id}/agent-write")
async def write_agent_draft(
    file_id: str,
    data: FileAgentWriteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.agent_doc_writer import agent_doc_writer

    file = await _org_file_or_404(file_id, ctx.org.id, db)
    if _enum_value(file.file_type) != FileType.document.value or not file.collab_room:
        raise HTTPException(status_code=409, detail="File is not a collaborative document")

    try:
        await agent_doc_writer.write_to_document(
            room=file.collab_room,
            content=data.content,
            agent_name=data.agent_name,
            org_id=ctx.org.id,
            auth_token=str(current_user.id),
        )
    except httpx.HTTPStatusError as exc:
        detail = "Collaborative document writer rejected the request."
        response = exc.response
        if response is not None:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict):
                detail = str(payload.get("detail") or payload.get("message") or detail)
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Collaborative document writer is unavailable.") from exc

    return {"file_id": file.id, "status": "streamed", "room": file.collab_room}


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    file = await _org_file_or_404(file_id, ctx.org.id, db)
    if file.storage_key:
        await storage_service.delete_object(file.storage_key)
    file.status = FileStatus.deleted
    file.is_latest = False
    file.updated_at = datetime.utcnow()
    await _refresh_quota(ctx.org.id, db)
    await db.commit()
    return {"file_id": file.id, "status": FileStatus.deleted.value}


@router.post("/document", status_code=201)
async def create_document(
    data: FileCreateDocumentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await _validate_client_access(data.client_id, ctx.org.id, db)
    file = OrgFile(
        org_id=ctx.org.id,
        client_id=data.client_id,
        name=data.name,
        description=data.description,
        file_type=FileType.document,
        status=FileStatus.ready,
        collab_room="",
        content_type="application/json",
        created_by=str(current_user.id),
    )
    db.add(file)
    await db.flush()
    file.collab_room = f"org-{ctx.org.id}-doc-{file.id}"
    initial_doc = b'{"type":"doc","content":[]}'
    file.storage_key = await storage_service.write_document(
        org_id=ctx.org.id,
        file_id=file.id,
        content=initial_doc,
        content_type="application/json",
        client_id=data.client_id,
        filename="document.json",
    )
    file.yjs_storage_key = file.storage_key
    file.size_bytes = len(initial_doc)
    file.extracted_text = ""
    await db.commit()
    return {
        "file_id": file.id,
        "collab_room": file.collab_room,
        "name": file.name,
        "download_url": await _resolve_download_url(file, request),
    }

import asyncio
import io
import json
from datetime import datetime

from sqlalchemy import select, text as text_q

from celery_app import celery_app


def _extract_tiptap_text(node: dict) -> str:
    """Recursively extract text from TipTap JSON document."""
    if node.get("type") == "text":
        return node.get("text", "")
    parts = []
    for child in node.get("content", []):
        parts.append(_extract_tiptap_text(child))
    return "\n".join(part for part in parts if part.strip())


async def _extract_text(storage_key: str, content_type: str | None) -> str | None:
    """Extract plain text from uploaded file for search indexing."""
    from services.storage_service import storage_service

    content = await storage_service.read_document(storage_key)
    normalized = (content_type or "").lower()

    if normalized in {"text/plain", "text/markdown"}:
        return content.decode("utf-8", errors="replace")

    if normalized == "application/pdf":
        try:
            import pymupdf

            doc = pymupdf.open(stream=content, filetype="pdf")
            return "\n".join(page.get_text() for page in doc)
        except Exception:
            return None

    if "wordprocessingml" in normalized:
        try:
            from docx import Document

            doc = Document(io.BytesIO(content))
            return "\n".join(paragraph.text for paragraph in doc.paragraphs)
        except Exception:
            return None

    if normalized == "application/json":
        try:
            data = json.loads(content)
            return _extract_tiptap_text(data)
        except Exception:
            return None

    return None


async def _update_quota(org_id: str, used_bytes_delta: int, db) -> None:
    from database.models import OrgStorageQuota
    from services.storage_service import storage_service

    quota = await db.scalar(select(OrgStorageQuota).where(OrgStorageQuota.org_id == org_id))
    if not quota:
        quota = OrgStorageQuota(org_id=org_id)
        db.add(quota)
        await db.flush()

    if used_bytes_delta >= 0:
        quota.used_bytes = int(quota.used_bytes or 0) + used_bytes_delta
    else:
        quota.used_bytes = await storage_service.get_org_usage_bytes(org_id)


async def activate_file(file_id: str, session_factory=None) -> None:
    from database.db import AsyncSessionLocal
    from database.models import Client, FileStatus, OrgFile
    from services.storage_service import storage_service
    from services.websocket_manager import ws_manager

    session_factory = session_factory or AsyncSessionLocal
    async with session_factory() as db:
        file = await db.scalar(select(OrgFile).where(OrgFile.id == file_id))
        if not file:
            return

        try:
            safe_key = await storage_service.move_to_safe(
                file.storage_key,
                file.org_id,
                file.id,
                file.name,
                file.client_id,
            )
            file.storage_key = safe_key
            file.status = FileStatus.ready

            extracted = await _extract_text(safe_key, file.content_type)
            if extracted:
                capped = extracted[:50_000]
                file.extracted_text = capped
                if "sqlite" in str(db.bind.url):
                    file.search_vector = capped
                else:
                    await db.execute(
                        text_q(
                            "UPDATE org_files SET search_vector = to_tsvector('english', :txt) "
                            "WHERE id = :id"
                        ),
                        {"txt": capped, "id": file_id},
                    )

            await _update_quota(file.org_id, int(file.size_bytes or 0), db)
            await db.commit()

            client_name = None
            if file.client_id:
                async with session_factory() as resolve_db:
                    client = await resolve_db.scalar(
                        select(Client).where(Client.id == file.client_id)
                    )
                    if client:
                        client_name = client.company_name or client.name

            await ws_manager.broadcast_to_channel(
                f"org:{file.org_id}",
                {
                    "event": "file_ready",
                    "file_id": str(file.id),
                    "name": file.name,
                    "file_type": file.file_type.value if file.file_type else "other",
                    "client_id": str(file.client_id) if file.client_id else None,
                    "client_name": client_name,
                    "agent_id": str(file.agent_id) if file.agent_id else None,
                    "size_bytes": int(file.size_bytes or 0),
                    "created_at": datetime.utcnow().isoformat(),
                    "navigate_to": f"/files/{file.id}",
                },
            )
        except Exception:
            file.status = FileStatus.error
            await db.commit()
            raise


@celery_app.task(name="validate_and_activate_file")
def validate_and_activate_file(file_id: str) -> None:
    asyncio.run(activate_file(file_id))

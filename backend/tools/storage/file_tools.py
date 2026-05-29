from __future__ import annotations

from datetime import datetime
import logging

from sqlalchemy import func, or_, select

from database.db import AsyncSessionLocal
from database.models import Client, FileStatus, OrgFile
from services.storage_service import storage_service
from tools.base import BaseTool, ToolCategory, ToolOutput


logger = logging.getLogger(__name__)


async def search_org_files(
    query: str,
    org_id: str,
    client_name: str | None = None,
    limit: int = 8,
) -> str:
    """
    Full-text search across org files.
    Returns a formatted list of matching files.
    Scoped to org_id — cannot access other orgs' files.
    """
    async with AsyncSessionLocal() as db:
        q = (
            select(OrgFile, Client.name.label("client_name"))
            .outerjoin(Client, OrgFile.client_id == Client.id)
            .where(
                OrgFile.org_id == org_id,
                OrgFile.status == FileStatus.ready,
            )
        )

        if client_name:
            q = q.where(func.lower(Client.name).contains(client_name.lower()))

        search_q = query.strip()
        if search_q:
            conditions = [
                OrgFile.name.ilike(f"%{search_q}%"),
                OrgFile.extracted_text.ilike(f"%{search_q}%"),
            ]
            bind = db.get_bind()
            if bind is not None and bind.dialect.name != "sqlite":
                conditions.append(
                    OrgFile.search_vector.op("@@")(
                        func.plainto_tsquery("english", search_q)
                    )
                )
            q = q.where(or_(*conditions))

        q = q.order_by(OrgFile.created_at.desc()).limit(limit)
        results = (await db.execute(q)).all()

        if not results:
            return f"No files found matching '{query}'. The organization may not have any stored files yet."

        lines = [f"Found {len(results)} file(s) matching '{query}':\n"]
        for row in results:
            org_file = row[0]
            client = row.client_name or "No client"
            preview = (org_file.extracted_text or "")[:150].replace("\n", " ")
            lines.append(
                f"- ID: {org_file.id}\n"
                f"  Name: {org_file.name}\n"
                f"  Client: {client}\n"
                f"  Created: {org_file.created_at.strftime('%Y-%m-%d') if org_file.created_at else 'unknown'}\n"
                f"  Preview: {preview}..."
            )

        return "\n".join(lines)


async def read_org_file(
    file_id: str,
    org_id: str,
) -> str:
    """
    Read the full content of a specific file.
    Returns the text content for the agent to use as context.
    Validates org_id to prevent cross-tenant access.
    """
    async with AsyncSessionLocal() as db:
        org_file = await db.scalar(
            select(OrgFile).where(
                OrgFile.id == file_id,
                OrgFile.org_id == org_id,
                OrgFile.status == FileStatus.ready,
            )
        )

        if not org_file:
            return (
                f"File {file_id} not found or not accessible. "
                "Use search_org_files to find valid file IDs."
            )

        if not org_file.storage_key:
            if org_file.extracted_text:
                return org_file.extracted_text
            return f"File '{org_file.name}' has no readable content."

        try:
            content = await storage_service.read_document(org_file.storage_key)
            text = content.decode("utf-8", errors="replace")

            org_file.last_accessed_at = datetime.utcnow()
            await db.commit()

            return (
                f"=== File: {org_file.name} ===\n"
                f"Created: {org_file.created_at.strftime('%Y-%m-%d') if org_file.created_at else 'unknown'}\n"
                "---\n"
                f"{text}"
            )
        except Exception as exc:
            logger.error("Failed to read file %s: %s", file_id, exc)
            if org_file.extracted_text:
                return f"=== File: {org_file.name} (cached text) ===\n{org_file.extracted_text}"
            return f"Could not read file '{org_file.name}': {exc}"


class SearchOrgFilesTool(BaseTool):
    name = "search_org_files"
    display_name = "Search Org Files"
    description = (
        "Search the organization's file storage for documents, research briefs, "
        "reports, and other files. Use this when you need to find previous work, "
        "research, or documents created by other agents."
    )
    category = ToolCategory.file

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        query = str(input_data.get("query", "") or "").strip()
        if not query:
            return ToolOutput(success=False, error="Query is required")

        result = await search_org_files(
            query=query,
            org_id=org_id,
            client_name=input_data.get("client_name"),
        )
        return ToolOutput(success=True, result=result)

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to search for. Be specific: e.g. 'Acme Corp competitor research Q2'",
                },
                "client_name": {
                    "type": "string",
                    "description": "Optional: filter results to a specific client name",
                },
            },
            "required": ["query"],
        }


class ReadOrgFileTool(BaseTool):
    name = "read_org_file"
    display_name = "Read Org File"
    description = (
        "Read the full content of a specific file from storage. "
        "Use the file_id returned by search_org_files."
    )
    category = ToolCategory.file

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        file_id = str(input_data.get("file_id", "") or "").strip()
        if not file_id:
            return ToolOutput(success=False, error="file_id is required")

        result = await read_org_file(
            file_id=file_id,
            org_id=org_id,
        )
        return ToolOutput(success=True, result=result)

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "description": "The file ID to read (from search_org_files results)",
                },
            },
            "required": ["file_id"],
        }


def register_tool(registry) -> None:
    registry.register(SearchOrgFilesTool())
    registry.register(ReadOrgFileTool())

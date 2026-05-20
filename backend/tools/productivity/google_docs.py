from __future__ import annotations

import httpx
import re

from sqlalchemy import select

from api.integrations import refresh_gmail_oauth_tokens
from database.db import AsyncSessionLocal
from database.models import IntegrationType, UserIntegration
from services.integration_crypto import decrypt_config
from tools.base import BaseTool, ToolCategory, ToolOutput


def _markdown_to_plain(md: str) -> str:
    """Strip markdown syntax for Google Docs plain text insertion."""
    text = md or ""
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*{1,3}(.*?)\*{1,3}", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^[-*_]{3,}$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class GoogleDocsTool(BaseTool):
    name = "google_docs"
    display_name = "Google Docs"
    description = "Create or update Google Docs content once provider auth is connected."
    category = ToolCategory.productivity
    requires_auth = True
    auth_type = "oauth"

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        async with AsyncSessionLocal() as db:
            result = await db.scalar(
                select(UserIntegration)
                .where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.integration_type == IntegrationType.gmail,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            return result is not None

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        title = str(input_data.get("title") or "Untitled Document").strip() or "Untitled Document"
        content = str(input_data.get("content") or "")

        async with AsyncSessionLocal() as db:
            integration = await db.scalar(
                select(UserIntegration).where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.user_id == user_id,
                    UserIntegration.integration_type == IntegrationType.gmail,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            if not integration:
                integration = await db.scalar(
                    select(UserIntegration).where(
                        UserIntegration.org_id == org_id,
                        UserIntegration.integration_type == IntegrationType.gmail,
                        UserIntegration.is_active == True,  # noqa: E712
                    )
                )
            if not integration:
                return ToolOutput(
                    success=False,
                    error="Google not connected. Visit /integrations to connect.",
                )

            try:
                if integration.user_id == user_id:
                    integration, config = await refresh_gmail_oauth_tokens(org_id, user_id, db)
                else:
                    config = decrypt_config(integration.config)
            except Exception:
                try:
                    config = decrypt_config(integration.config)
                except Exception:
                    return ToolOutput(
                        success=False,
                        error="Google token missing. Reconnect Gmail in /integrations.",
                    )

            access_token = config.get("access_token")
            if not access_token:
                return ToolOutput(
                    success=False,
                    error="Google token missing. Reconnect Gmail in /integrations.",
                )
            granted_scopes = config.get("granted_scopes")
            if granted_scopes is None:
                granted_scopes = config.get("scopes")
            if isinstance(granted_scopes, str):
                granted_scopes = granted_scopes.split()
            if not granted_scopes or "https://www.googleapis.com/auth/drive.file" not in granted_scopes:
                return ToolOutput(
                    success=False,
                    error="Google Docs requires updated permissions. Reconnect Gmail in /integrations.",
                )

        plain_content = _markdown_to_plain(content)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                create_resp = await client.post(
                    "https://docs.googleapis.com/v1/documents",
                    headers=headers,
                    json={"title": title},
                )
                if create_resp.status_code == 401:
                    return ToolOutput(
                        success=False,
                        error="Google token expired. Reconnect Gmail in /integrations.",
                    )
                create_resp.raise_for_status()
                doc = create_resp.json()
                doc_id = doc["documentId"]

                insert_resp = await client.post(
                    f"https://docs.googleapis.com/v1/documents/{doc_id}:batchUpdate",
                    headers=headers,
                    json={
                        "requests": [
                            {
                                "insertText": {
                                    "location": {"index": 1},
                                    "text": plain_content,
                                }
                            }
                        ]
                    },
                )
                if insert_resp.status_code == 401:
                    return ToolOutput(
                        success=False,
                        error="Google token expired. Reconnect Gmail in /integrations.",
                    )
                insert_resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            return ToolOutput(success=False, error=f"Google Docs error: {exc}")
        except Exception as exc:
            return ToolOutput(success=False, error=f"Google Docs error: {exc}")

        doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"
        return ToolOutput(
            success=True,
            result=doc_url,
            metadata={"doc_id": doc_id, "doc_url": doc_url, "title": title},
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Document title"},
                "content": {"type": "string", "description": "Document body content"},
            },
            "required": ["title", "content"],
        }


def register_tool(registry) -> None:
    registry.register(GoogleDocsTool())

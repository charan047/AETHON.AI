"""
Agent Document Writer
=====================

Streams agent output into collaborative documents through the Hocuspocus
service. The Hocuspocus server applies the write directly to the Yjs
document so connected editors receive the update in real time and the
state persists in Postgres.
"""

from __future__ import annotations

from typing import Any

import httpx

from config import settings


class AgentDocumentWriter:
    async def write_to_document(
        self,
        room: str,
        content: str,
        agent_name: str,
        org_id: str,
        auth_token: str,
    ) -> None:
        del org_id, auth_token
        if not room.strip() or not content.strip():
            return

        headers: dict[str, Any] = {}
        shared_secret = settings.hocuspocus_secret or settings.jwt_secret_key
        if shared_secret:
            headers["X-Hocuspocus-Secret"] = shared_secret

        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            response = await client.post(
                f"{settings.hocuspocus_http_url.rstrip('/')}/agent-write",
                json={
                    "room": room,
                    "content": content,
                    "agent_name": agent_name,
                },
                headers=headers,
            )
            response.raise_for_status()


agent_doc_writer = AgentDocumentWriter()

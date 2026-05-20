from __future__ import annotations

import logging
from typing import Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import AgentMemoryEntry


logger = logging.getLogger(__name__)


class AgentMemoryService:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if not settings.mem0_enabled or not settings.mem0_api_key:
            return None
        if self._client is None:
            try:
                from mem0 import MemoryClient

                self._client = MemoryClient(api_key=settings.mem0_api_key)
            except Exception as exc:
                logger.warning("mem0 init failed: %s", exc)
                return None
        return self._client

    async def store(
        self,
        agent_id,
        org_id,
        content,
        memory_type="general",
        tags=None,
        importance=0.5,
        db=None,
    ) -> Optional[str]:
        try:
            client = self.client
            if client is None:
                return None

            payload = {
                "messages": [{"role": "system", "content": content}],
                "user_id": f"{org_id}:{agent_id}",
                "metadata": {
                    "agent_id": agent_id,
                    "org_id": org_id,
                    "memory_type": memory_type,
                    "tags": tags or [],
                    "importance": importance,
                },
            }
            response = client.add(**payload)
            mem0_memory_id = self._extract_memory_id(response)
            if not mem0_memory_id:
                return None

            await self._store_local_index(
                agent_id=agent_id,
                org_id=org_id,
                mem0_memory_id=mem0_memory_id,
                content=content,
                memory_type=memory_type,
                tags=tags or [],
                importance=importance,
                db=db,
            )
            return mem0_memory_id
        except Exception as exc:
            logger.warning("mem0 store failed for %s:%s: %s", org_id, agent_id, exc)
            return None

    async def retrieve(
        self,
        agent_id,
        org_id,
        query,
        limit=5,
    ) -> list[dict]:
        try:
            client = self.client
            if client is None:
                return []
            response = client.search(
                query=query,
                user_id=f"{org_id}:{agent_id}",
                limit=limit,
            )
            return self._normalize_search_results(response)
        except Exception as exc:
            logger.warning("mem0 retrieve failed for %s:%s: %s", org_id, agent_id, exc)
            return []

    async def build_memory_context(
        self,
        agent_id,
        org_id,
        task,
        max_memories=5,
    ) -> str:
        try:
            memories = await self.retrieve(agent_id, org_id, task, limit=max_memories)
            if not memories:
                return ""
            lines = []
            for memory in memories:
                memory_type = memory.get("memory_type", "general")
                content = (memory.get("content") or "").strip()
                if not content:
                    continue
                lines.append(f"- [{memory_type}] {content}")
            if not lines:
                return ""
            return "## Relevant memories from past work:\n" + "\n".join(lines)
        except Exception as exc:
            logger.warning("mem0 context build failed for %s:%s: %s", org_id, agent_id, exc)
            return ""

    async def store_task_outcome(
        self,
        agent_id,
        org_id,
        task_input,
        task_result,
        success,
        tools_used,
        db,
    ) -> None:
        try:
            tool_summary = ", ".join(tools_used or []) or "no tools"
            content = (
                f"Task: {task_input}\n"
                f"Outcome: {task_result}\n"
                f"Tools used: {tool_summary}\n"
                f"Result: {'success' if success else 'failure'}"
            )
            await self.store(
                agent_id=agent_id,
                org_id=org_id,
                content=content[:3000],
                memory_type="skill" if success else "mistake",
                tags=["task_outcome", "success" if success else "failure"],
                importance=0.6 if success else 0.8,
                db=db,
            )
        except Exception as exc:
            logger.warning("mem0 task outcome store failed for %s:%s: %s", org_id, agent_id, exc)

    async def store_ceo_feedback(
        self,
        agent_id,
        org_id,
        feedback,
        feedback_type,
        db,
    ) -> None:
        try:
            await self.store(
                agent_id=agent_id,
                org_id=org_id,
                content=feedback,
                memory_type=feedback_type,
                tags=["ceo_feedback", feedback_type],
                importance=0.9,
                db=db,
            )
        except Exception as exc:
            logger.warning("mem0 CEO feedback store failed for %s:%s: %s", org_id, agent_id, exc)

    async def get_for_display(
        self,
        agent_id,
        org_id,
        db,
        limit=20,
    ) -> list:
        try:
            result = await db.execute(
                select(AgentMemoryEntry)
                .where(AgentMemoryEntry.agent_id == agent_id, AgentMemoryEntry.org_id == org_id)
                .order_by(AgentMemoryEntry.created_at.desc())
                .limit(limit)
            )
            return result.scalars().all()
        except Exception as exc:
            logger.warning("memory display retrieval failed for %s:%s: %s", org_id, agent_id, exc)
            return []

    async def _store_local_index(
        self,
        *,
        agent_id: str,
        org_id: str,
        mem0_memory_id: str,
        content: str,
        memory_type: str,
        tags: list[str],
        importance: float,
        always_inject: bool = False,
        source: str | None = None,
        db: AsyncSession | None,
    ) -> None:
        entry = AgentMemoryEntry(
            id=str(uuid4()),
            agent_id=agent_id,
            org_id=org_id,
            mem0_memory_id=mem0_memory_id,
            content_preview=content[:500],
            memory_type=memory_type,
            tags=tags,
            importance_score=importance,
            always_inject=always_inject,
            source=source,
        )
        if db is not None:
            db.add(entry)
            await db.flush()
            return
        async with AsyncSessionLocal() as session:
            session.add(entry)
            await session.commit()

    @staticmethod
    def _extract_memory_id(response) -> Optional[str]:
        if response is None:
            return None
        if isinstance(response, str):
            return response
        if isinstance(response, dict):
            for key in ("id", "memory_id"):
                value = response.get(key)
                if value:
                    return str(value)
            data = response.get("data")
            if isinstance(data, dict):
                return AgentMemoryService._extract_memory_id(data)
            if isinstance(data, list) and data:
                return AgentMemoryService._extract_memory_id(data[0])
        if isinstance(response, list) and response:
            return AgentMemoryService._extract_memory_id(response[0])
        return None

    @staticmethod
    def _normalize_search_results(response) -> list[dict]:
        items = []
        source = response.get("results") if isinstance(response, dict) else response
        if not isinstance(source, list):
            return items
        for item in source:
            if not isinstance(item, dict):
                continue
            metadata = item.get("metadata") or {}
            content = (
                item.get("memory")
                or item.get("text")
                or item.get("content")
                or item.get("document")
                or ""
            )
            items.append(
                {
                    "id": str(item.get("id") or item.get("memory_id") or ""),
                    "content": str(content),
                    "memory_type": metadata.get("memory_type") or item.get("memory_type") or "general",
                    "score": item.get("score") or item.get("similarity") or 0,
                }
            )
        return items


agent_memory_service = AgentMemoryService()

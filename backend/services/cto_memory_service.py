import re
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import CTOMemory, CTOMemoryType


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_]+", (text or "").lower()))


def _is_memory_query(text: str) -> bool:
    normalized = " ".join((text or "").lower().strip().split())
    return (
        normalized.endswith("?")
        or normalized.startswith("what do you remember")
        or normalized.startswith("do you remember")
        or normalized.startswith("tell me what you remember")
        or normalized.startswith("can you remember what")
    )


class CTOMemoryService:
    async def get_relevant(
        self,
        org_id: str,
        query: str,
        db: AsyncSession,
        limit: int = 8,
    ) -> list[CTOMemory]:
        memories = (
            await db.execute(
                select(CTOMemory)
                .where(CTOMemory.org_id == org_id)
                .order_by(
                    CTOMemory.confidence.desc(),
                    CTOMemory.last_seen_at.desc(),
                )
                .limit(50)
            )
        ).scalars().all()

        query_lower = (query or "").lower()
        query_words = _tokenize(query)
        scored: list[tuple[int, float, datetime, CTOMemory]] = []
        for memory in memories:
            score = 0
            if memory.entity_name and memory.entity_name.lower() in query_lower:
                score += 3
            overlap = len(_tokenize(memory.content) & query_words)
            score += min(overlap, 2)
            scored.append((score, float(memory.confidence or 0), memory.last_seen_at or datetime.min, memory))

        scored.sort(key=lambda item: (-item[0], -item[1], -item[2].timestamp()))
        return [memory for _, _, _, memory in scored[:limit]]

    async def add(
        self,
        org_id: str,
        memory_type: CTOMemoryType,
        content: str,
        entity_name: str | None = None,
        entity_type: str | None = None,
        source: str = "explicit",
        db: AsyncSession | None = None,
    ) -> CTOMemory:
        async def _add(session: AsyncSession) -> CTOMemory:
            query = select(CTOMemory).where(
                CTOMemory.org_id == org_id,
                CTOMemory.memory_type == memory_type,
            )
            if entity_name:
                query = query.where(CTOMemory.entity_name == entity_name)
            else:
                query = query.where(
                    CTOMemory.entity_name.is_(None),
                    CTOMemory.content == content,
                )

            existing = (await session.execute(query)).scalar_one_or_none()

            if existing:
                existing.content = content
                existing.observation_count += 1
                existing.confidence = min(0.95, float(existing.confidence or 0) + 0.10)
                existing.last_seen_at = datetime.utcnow()
                await session.commit()
                await session.refresh(existing)
                return existing

            memory = CTOMemory(
                id=str(uuid4()),
                org_id=org_id,
                memory_type=memory_type,
                content=content,
                entity_name=entity_name,
                entity_type=entity_type,
                source=source,
                confidence=0.5,
            )
            session.add(memory)
            await session.commit()
            await session.refresh(memory)
            return memory

        if db is not None:
            return await _add(db)
        async with AsyncSessionLocal() as session:
            return await _add(session)

    async def record_approval_pattern(
        self,
        org_id: str,
        action_type: str,
        context: str,
        was_approved: bool,
        db: AsyncSession,
    ) -> None:
        if was_approved:
            await self.add(
                org_id=org_id,
                memory_type=CTOMemoryType.approval_pattern,
                content=f"CEO approved: {action_type} — context: {context[:100]}",
                entity_name=action_type,
                entity_type="action_type",
                source="approval",
                db=db,
            )

    async def extract_from_message(
        self,
        org_id: str,
        user_message: str,
        db: AsyncSession,
    ) -> None:
        msg_lower = (user_message or "").lower()
        if _is_memory_query(user_message):
            return
        preference_signals = [
            "always ",
            "never ",
            "prefer ",
            "make sure ",
            "remember ",
            "from now on ",
        ]
        if any(signal in msg_lower for signal in preference_signals):
            await self.add(
                org_id=org_id,
                memory_type=CTOMemoryType.general,
                content=f"CEO preference: {user_message[:200]}",
                source="explicit",
                db=db,
            )

    async def get_all(self, org_id: str) -> list[CTOMemory]:
        async with AsyncSessionLocal() as db:
            memories = (
                await db.execute(
                    select(CTOMemory)
                    .where(CTOMemory.org_id == org_id)
                    .order_by(CTOMemory.last_seen_at.desc())
                )
            ).scalars().all()
            return list(memories)

    async def delete(self, memory_id: str, org_id: str) -> None:
        async with AsyncSessionLocal() as db:
            memory = await db.scalar(
                select(CTOMemory).where(
                    CTOMemory.id == memory_id,
                    CTOMemory.org_id == org_id,
                )
            )
            if memory:
                await db.delete(memory)
                await db.commit()


cto_memory_service = CTOMemoryService()

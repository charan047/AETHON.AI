from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import CTOMemory, CTOMemoryType


@pytest_asyncio.fixture
async def cto_memory_service_module():
    import services.cto_memory_service as cto_memory_service_module

    return cto_memory_service_module


@pytest.mark.asyncio
async def test_get_relevant_prioritizes_entity_and_keyword_overlap(
    db,
    test_org,
    cto_memory_service_module,
):
    now = datetime.utcnow()
    db.add_all(
        [
            CTOMemory(
                org_id=test_org.id,
                memory_type=CTOMemoryType.client_preference,
                content="Acme prefers bullet points and concise weekly briefs",
                entity_name="Acme",
                entity_type="client",
                confidence=0.8,
                last_seen_at=now,
            ),
            CTOMemory(
                org_id=test_org.id,
                memory_type=CTOMemoryType.general,
                content="Use bullet points for executive updates",
                confidence=0.9,
                last_seen_at=now - timedelta(hours=1),
            ),
            CTOMemory(
                org_id=test_org.id,
                memory_type=CTOMemoryType.general,
                content="Jordan is good at drafting portal summaries",
                confidence=0.95,
                last_seen_at=now - timedelta(days=1),
            ),
        ]
    )
    await db.commit()

    memories = await cto_memory_service_module.cto_memory_service.get_relevant(
        test_org.id,
        "Prepare Acme weekly brief with bullet points",
        db,
    )

    assert [memory.content for memory in memories[:2]] == [
        "Acme prefers bullet points and concise weekly briefs",
        "Use bullet points for executive updates",
    ]


@pytest.mark.asyncio
async def test_add_updates_existing_memory_and_increments_confidence(
    db,
    test_org,
    cto_memory_service_module,
):
    existing = CTOMemory(
        org_id=test_org.id,
        memory_type=CTOMemoryType.client_preference,
        content="Acme likes bullets",
        entity_name="Acme",
        entity_type="client",
        source="explicit",
        confidence=0.5,
        observation_count=1,
    )
    db.add(existing)
    await db.commit()
    await db.refresh(existing)

    memory = await cto_memory_service_module.cto_memory_service.add(
        org_id=test_org.id,
        memory_type=CTOMemoryType.client_preference,
        content="Acme always wants bullet points",
        entity_name="Acme",
        entity_type="client",
        source="explicit",
        db=db,
    )

    assert memory.id == existing.id
    assert memory.content == "Acme always wants bullet points"
    assert memory.observation_count == 2
    assert memory.confidence == 0.6


@pytest.mark.asyncio
async def test_record_approval_pattern_only_persists_approvals(
    db,
    test_org,
    cto_memory_service_module,
):
    await cto_memory_service_module.cto_memory_service.record_approval_pattern(
        org_id=test_org.id,
        action_type="deliver_portal",
        context="Acme weekly report",
        was_approved=True,
        db=db,
    )
    await cto_memory_service_module.cto_memory_service.record_approval_pattern(
        org_id=test_org.id,
        action_type="external_email",
        context="Cold outreach",
        was_approved=False,
        db=db,
    )

    memories = (
        await db.execute(select(CTOMemory).where(CTOMemory.org_id == test_org.id))
    ).scalars().all()

    assert len(memories) == 1
    assert memories[0].memory_type == CTOMemoryType.approval_pattern
    assert memories[0].entity_name == "deliver_portal"
    assert "CEO approved: deliver_portal" in memories[0].content


@pytest.mark.asyncio
async def test_extract_from_message_captures_explicit_preference(
    db,
    test_org,
    cto_memory_service_module,
):
    await cto_memory_service_module.cto_memory_service.extract_from_message(
        org_id=test_org.id,
        user_message="From now on always use bullet points for Acme updates.",
        db=db,
    )

    memories = (
        await db.execute(select(CTOMemory).where(CTOMemory.org_id == test_org.id))
    ).scalars().all()

    assert len(memories) == 1
    assert memories[0].memory_type == CTOMemoryType.general
    assert memories[0].source == "explicit"
    assert "CEO preference" in memories[0].content


@pytest.mark.asyncio
async def test_extract_from_message_does_not_treat_memory_questions_as_preferences(
    db,
    test_org,
    cto_memory_service_module,
):
    await cto_memory_service_module.cto_memory_service.extract_from_message(
        org_id=test_org.id,
        user_message="What do you remember about Acme preferences?",
        db=db,
    )

    memories = (
        await db.execute(select(CTOMemory).where(CTOMemory.org_id == test_org.id))
    ).scalars().all()

    assert memories == []


@pytest.mark.asyncio
async def test_general_memories_without_entity_name_do_not_overwrite_each_other(
    db,
    test_org,
    cto_memory_service_module,
):
    first = await cto_memory_service_module.cto_memory_service.add(
        org_id=test_org.id,
        memory_type=CTOMemoryType.general,
        content="CEO preference: Acme always wants bullet points.",
        source="explicit",
        db=db,
    )
    second = await cto_memory_service_module.cto_memory_service.add(
        org_id=test_org.id,
        memory_type=CTOMemoryType.general,
        content="CEO preference: Weekly reports should go through the portal.",
        source="explicit",
        db=db,
    )

    memories = (
        await db.execute(
            select(CTOMemory)
            .where(CTOMemory.org_id == test_org.id)
            .order_by(CTOMemory.created_at.asc())
        )
    ).scalars().all()

    assert first.id != second.id
    assert [memory.content for memory in memories] == [
        "CEO preference: Acme always wants bullet points.",
        "CEO preference: Weekly reports should go through the portal.",
    ]


@pytest.mark.asyncio
async def test_get_all_and_delete_use_session_factory_when_no_db_passed(
    db_engine,
    test_org,
    cto_memory_service_module,
    monkeypatch,
):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    monkeypatch.setattr(cto_memory_service_module, "AsyncSessionLocal", session_factory)

    created = await cto_memory_service_module.cto_memory_service.add(
        org_id=test_org.id,
        memory_type=CTOMemoryType.general,
        content="CEO preference: keep updates short",
        source="explicit",
        db=None,
    )

    all_memories = await cto_memory_service_module.cto_memory_service.get_all(test_org.id)
    assert [memory.id for memory in all_memories] == [created.id]

    await cto_memory_service_module.cto_memory_service.delete(created.id, test_org.id)

    async with session_factory() as verify_db:
        remaining = (
            await verify_db.execute(select(CTOMemory).where(CTOMemory.org_id == test_org.id))
        ).scalars().all()

    assert remaining == []

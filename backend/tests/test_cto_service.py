import pytest
from sqlalchemy import func, select

from api import company_chat as company_chat_module
from database.models import CTOAuthority
from services.cto_service import get_or_create_authority


@pytest.mark.asyncio
async def test_get_or_create_authority_returns_existing_row(db, test_org):
    existing = CTOAuthority(
        org_id=test_org.id,
        auto_approve_portal=False,
        auto_approve_patterns=True,
        auto_run_workflows=False,
        auto_create_missions=False,
        max_auto_spend_usd=25.0,
        auto_approve_action_types=["deliver_portal"],
    )
    db.add(existing)
    await db.commit()
    await db.refresh(existing)

    authority = await get_or_create_authority(db, test_org.id)

    assert authority.id == existing.id
    assert authority.org_id == test_org.id
    assert authority.auto_approve_portal is False
    assert authority.auto_approve_patterns is True
    assert authority.auto_run_workflows is False
    assert authority.auto_create_missions is False
    assert authority.max_auto_spend_usd == 25.0
    assert authority.auto_approve_action_types == ["deliver_portal"]


@pytest.mark.asyncio
async def test_get_or_create_authority_creates_default_row_when_missing(db, test_org):
    authority = await get_or_create_authority(db, test_org.id)

    assert authority.org_id == test_org.id
    assert authority.auto_approve_portal is True
    assert authority.auto_approve_patterns is False
    assert authority.auto_run_workflows is True
    assert authority.auto_create_missions is True
    assert authority.max_auto_spend_usd == 0.0
    assert authority.auto_approve_action_types == []

    count = await db.scalar(
        select(func.count()).select_from(CTOAuthority).where(CTOAuthority.org_id == test_org.id)
    )
    assert count == 1


@pytest.mark.asyncio
async def test_load_company_context_creates_authority_only_once(db, test_org, test_user):
    count_before = await db.scalar(
        select(func.count()).select_from(CTOAuthority).where(CTOAuthority.org_id == test_org.id)
    )
    assert count_before == 0

    first_context = await company_chat_module._load_company_context(test_user.id, db, test_org.id)
    first_authority = first_context["authority"]

    assert first_authority.org_id == test_org.id
    assert first_authority.auto_approve_portal is True
    assert first_authority.auto_approve_patterns is False
    assert first_authority.auto_run_workflows is True
    assert first_authority.auto_create_missions is True
    assert first_authority.max_auto_spend_usd == 0.0

    count_after_first = await db.scalar(
        select(func.count()).select_from(CTOAuthority).where(CTOAuthority.org_id == test_org.id)
    )
    assert count_after_first == 1

    second_context = await company_chat_module._load_company_context(test_user.id, db, test_org.id)
    second_authority = second_context["authority"]

    count_after_second = await db.scalar(
        select(func.count()).select_from(CTOAuthority).where(CTOAuthority.org_id == test_org.id)
    )
    assert count_after_second == 1
    assert second_authority.id == first_authority.id

from __future__ import annotations

import pytest
from sqlalchemy import select

from database.models import Agent, AgentTrustScore
from services.trust_score_service import trust_score_service


@pytest.mark.asyncio
async def test_new_agent_trust_score_starts_neutral(db, test_agent):
    score = await trust_score_service._get_or_create(test_agent.id, db)

    assert score.overall_score == 50.0
    assert score.total_tasks == 0


@pytest.mark.asyncio
async def test_five_successes_raise_score_into_visible_range(db, test_agent):
    for _ in range(5):
        await trust_score_service.record_task_completed(
            agent_id=test_agent.id,
            success=True,
            on_time=True,
            cost_cents=50,
            budget_cents=100,
            tools_used=[],
            db=db,
        )

    score = await db.scalar(select(AgentTrustScore).where(AgentTrustScore.agent_id == test_agent.id))
    assert score is not None
    assert 58.0 <= score.overall_score <= 62.5


@pytest.mark.asyncio
async def test_ten_runs_with_nine_successes_reach_semi_autonomous(db, test_agent):
    for _ in range(9):
        await trust_score_service.record_task_completed(
            agent_id=test_agent.id,
            success=True,
            on_time=True,
            cost_cents=50,
            budget_cents=100,
            tools_used=[],
            db=db,
        )

    await trust_score_service.record_task_completed(
        agent_id=test_agent.id,
        success=False,
        on_time=True,
        cost_cents=50,
        budget_cents=100,
        tools_used=[],
        db=db,
    )

    score = await db.scalar(select(AgentTrustScore).where(AgentTrustScore.agent_id == test_agent.id))
    agent = await db.scalar(select(Agent).where(Agent.id == test_agent.id))
    assert score is not None
    assert agent is not None
    assert score.overall_score >= 62.0
    assert agent.autonomy_level == "semi_autonomous"
    assert score.autonomy_history


@pytest.mark.asyncio
async def test_three_failures_drop_score_into_warning_range(db, test_agent):
    for _ in range(3):
        await trust_score_service.record_task_completed(
            agent_id=test_agent.id,
            success=False,
            on_time=True,
            cost_cents=50,
            budget_cents=100,
            tools_used=[],
            db=db,
        )

    score = await db.scalar(select(AgentTrustScore).where(AgentTrustScore.agent_id == test_agent.id))
    assert score is not None
    assert 40.0 <= score.overall_score <= 45.0


@pytest.mark.asyncio
async def test_additional_successes_continue_rising_for_proven_agent(db, test_agent):
    seeded = AgentTrustScore(
        agent_id=test_agent.id,
        overall_score=70.0,
        task_success_rate=82.0,
        review_pass_rate=85.0,
        eval_pass_rate=70.0,
        eval_runs_count=1,
        risky_action_rate=100.0,
        on_time_rate=100.0,
        cost_efficiency=100.0,
        total_tasks=12,
        successful_tasks=10,
        failed_tasks=2,
        total_reviews=4,
        passed_reviews=3,
        autonomy_history=[],
    )
    db.add(seeded)
    await db.commit()

    before = seeded.overall_score

    for _ in range(5):
        await trust_score_service.record_task_completed(
            agent_id=test_agent.id,
            success=True,
            on_time=True,
            cost_cents=50,
            budget_cents=100,
            tools_used=[],
            db=db,
        )

    await db.refresh(seeded)
    assert seeded.overall_score > before


@pytest.mark.asyncio
async def test_review_only_signal_does_not_move_score_before_any_tasks(db, test_agent):
    score = await trust_score_service._get_or_create(test_agent.id, db)
    assert score.total_tasks == 0
    assert score.overall_score == 50.0

    await trust_score_service.record_review_result(
        agent_id=test_agent.id,
        passed=True,
        db=db,
    )

    await db.refresh(score)
    assert score.total_tasks == 0
    assert score.total_reviews == 1
    assert score.review_pass_rate == 100.0
    assert score.overall_score == 50.0


@pytest.mark.asyncio
async def test_eval_only_signal_does_not_move_score_before_any_tasks(db, test_agent):
    score = await trust_score_service._get_or_create(test_agent.id, db)
    assert score.total_tasks == 0
    assert score.overall_score == 50.0

    await trust_score_service.record_eval_completed(
        agent_id=test_agent.id,
        pass_rate=100.0,
        total_cases=5,
        passed_cases=5,
        db=db,
    )

    await db.refresh(score)
    assert score.total_tasks == 0
    assert score.eval_runs_count == 1
    assert score.eval_pass_rate == 100.0
    assert score.overall_score == 50.0

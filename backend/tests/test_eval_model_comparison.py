from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import EvalCase, EvalRun, EvalSuite, ModelConfig, ScoringMethod
from services.eval_runner import EvalRunner


def _make_model_config(*, org_id: str, provider: str, model_id: str, display_name: str) -> ModelConfig:
    return ModelConfig(
        id=str(uuid.uuid4()),
        org_id=org_id,
        provider=provider,
        model_id=model_id,
        display_name=display_name,
        is_active=True,
        is_default=False,
    )


@pytest.mark.asyncio
async def test_run_suite_stores_model_override(monkeypatch, db, test_agent, test_user, test_org):
    suite = EvalSuite(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        agent_id=test_agent.id,
        name="Model Override Suite",
        description="Checks override persistence",
        pass_threshold=0.8,
    )
    case = EvalCase(
        id=str(uuid.uuid4()),
        suite_id=suite.id,
        name="Case 1",
        input="Say hello",
        expected_output="hello",
        scoring_method=ScoringMethod.exact_match,
        scoring_config="{}",
        weight=1.0,
    )
    model_cfg = _make_model_config(
        org_id=test_org.id,
        provider="openai",
        model_id="gpt-4o-mini",
        display_name="GPT-4o Mini",
    )
    db.add_all([suite, case, model_cfg])
    await db.commit()

    async def fake_run_case(self, suite_id, run_id, case_id, agent_id, user_id, model_config_id=None):
        return {
            "case_id": case_id,
            "score": 1.0,
            "passed": True,
            "error": None,
            "tokens_used": 42,
            "cost_usd": 0.0034,
        }

    async def noop_broadcast(*args, **kwargs):
        return None

    monkeypatch.setattr("services.eval_runner.EvalRunner._run_case", fake_run_case)
    monkeypatch.setattr("services.eval_runner.ws_manager.broadcast", noop_broadcast)

    run = await EvalRunner().run_suite(
        suite.id,
        test_user.id,
        triggered_by="manual",
        db=db,
        model_config_id=model_cfg.id,
    )

    await db.refresh(run)
    assert run.model_config_id == model_cfg.id
    assert run.duration_seconds is not None
    assert run.total_cost_usd == pytest.approx(0.0034)


@pytest.mark.asyncio
async def test_compare_endpoint_returns_winner_and_history(monkeypatch, authed_client, db, test_agent, test_user, test_org):
    suite = EvalSuite(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        agent_id=test_agent.id,
        name="Compare Suite",
        description="Runs the same suite across two models",
        pass_threshold=0.8,
    )
    case = EvalCase(
        id=str(uuid.uuid4()),
        suite_id=suite.id,
        name="Case 1",
        input="Research topic",
        expected_output="report",
        scoring_method=ScoringMethod.contains,
        scoring_config='{"needle":"report"}',
        weight=1.0,
    )
    model_a = _make_model_config(
        org_id=test_org.id,
        provider="openai",
        model_id="gpt-4o-mini",
        display_name="GPT-4o Mini",
    )
    model_b = _make_model_config(
        org_id=test_org.id,
        provider="anthropic",
        model_id="claude-3-5-haiku",
        display_name="Claude 3.5 Haiku",
    )
    db.add_all([suite, case, model_a, model_b])
    await db.commit()
    session_factory = async_sessionmaker(db.bind, expire_on_commit=False)

    async def fake_run_suite(self, suite_id, user_id, triggered_by="manual", git_commit=None, db=None, model_config_id=None, **kwargs):
        session = db
        owns_session = session is None
        if session is None:
            session = session_factory()
        model = model_a if model_config_id == model_a.id else model_b
        run = EvalRun(
            id=str(uuid.uuid4()),
            suite_id=suite_id,
            user_id=user_id,
            status="completed",
            triggered_by=triggered_by,
            total_cases=10,
            passed_cases=8 if model.id == model_a.id else 9,
            failed_cases=2 if model.id == model_a.id else 1,
            error_cases=0,
            suite_score=0.825 if model.id == model_a.id else 0.9,
            passed=True,
            duration_seconds=4 if model.id == model_a.id else 3,
            total_cost_usd=0.0034 if model.id == model_a.id else 0.0021,
            completed_at=datetime.now(timezone.utc),
            model_config_id=model.id,
            comparison_group_id=kwargs.get("comparison_group_id"),
            comparison_slot=kwargs.get("comparison_slot"),
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        if owns_session:
            await session.close()
        return run

    async def fake_reason(*args, **kwargs):
        return "Claude 3.5 Haiku: Higher pass rate at lower cost."

    monkeypatch.setattr("services.eval_runner.EvalRunner.run_suite", fake_run_suite)
    monkeypatch.setattr("api.evals._generate_comparison_reason", fake_reason)

    response = await authed_client.post(
        f"/api/evals/suites/{suite.id}/compare",
        json={"model_a_id": model_a.id, "model_b_id": model_b.id},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["winner"] == "model_b"
    assert payload["model_a"]["model_config_id"] == model_a.id
    assert payload["model_b"]["model_config_id"] == model_b.id
    assert payload["model_b"]["pass_rate"] == 90.0
    assert "winner_reason" in payload

    history = await authed_client.get(f"/api/evals/suites/{suite.id}/compare-history")
    assert history.status_code == 200
    history_payload = history.json()
    assert len(history_payload["comparisons"]) == 1
    assert history_payload["comparisons"][0]["winner"] == "model_b"


@pytest.mark.asyncio
async def test_quick_test_generates_suite_when_missing(monkeypatch, authed_client, db, test_agent, test_user, test_org):
    async def fake_generate(self, agent_id, suite_id, count=5, db=None):
        created = []
        for index in range(count):
            case = EvalCase(
                id=str(uuid.uuid4()),
                suite_id=suite_id,
                name=f"Generated {index + 1}",
                input=f"Prompt {index + 1}",
                expected_output="ok",
                scoring_method=ScoringMethod.contains,
                scoring_config='{"needle":"ok"}',
                weight=1.0,
            )
            db.add(case)
            created.append(case)
        await db.commit()
        return created

    async def fake_run_suite(self, suite_id, user_id, triggered_by="manual", git_commit=None, db=None, model_config_id=None, **kwargs):
        run = EvalRun(
            id=str(uuid.uuid4()),
            suite_id=suite_id,
            user_id=user_id,
            status="completed",
            triggered_by=triggered_by,
            total_cases=5,
            passed_cases=4,
            failed_cases=1,
            error_cases=0,
            suite_score=0.8,
            passed=True,
            duration_seconds=12,
            total_cost_usd=0.0042,
            completed_at=datetime.now(timezone.utc),
            model_config_id=model_config_id,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run

    monkeypatch.setattr("services.eval_generator.EvalGenerator.generate_cases_from_agent_prompt", fake_generate)
    monkeypatch.setattr("services.eval_runner.EvalRunner.run_suite", fake_run_suite)

    response = await authed_client.post(f"/api/evals/quick-test/{test_agent.id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["pass_rate"] == 80.0
    assert payload["passed"] == 4
    assert payload["total"] == 5

    suites = (await db.execute(select(EvalSuite).where(EvalSuite.agent_id == test_agent.id))).scalars().all()
    assert len(suites) == 1
    assert suites[0].name.startswith("Quick Eval")

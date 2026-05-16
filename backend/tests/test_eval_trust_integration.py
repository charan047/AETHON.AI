from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from database.models import AgentTrustScore, EvalCase, EvalSuite, ScoringMethod
from services.trust_score_service import trust_score_service


@pytest.mark.asyncio
async def test_record_eval_completed_updates_trust_score(db, test_agent, test_user, test_org):
    trust = AgentTrustScore(
        agent_id=test_agent.id,
        overall_score=60.0,
        task_success_rate=70.0,
        review_pass_rate=60.0,
        risky_action_rate=90.0,
        on_time_rate=80.0,
        cost_efficiency=75.0,
        autonomy_history=[],
    )
    db.add(trust)
    await db.commit()

    high = await trust_score_service.record_eval_completed(
        agent_id=test_agent.id,
        pass_rate=80.0,
        total_cases=10,
        passed_cases=8,
        db=db,
    )

    await db.refresh(trust)
    assert high["eval_pass_rate"] == 80.0
    assert high["eval_runs_count"] == 1
    assert trust.eval_pass_rate == 80.0
    assert trust.eval_runs_count == 1
    assert trust.overall_score > 60.0

    high_score = trust.overall_score

    low = await trust_score_service.record_eval_completed(
        agent_id=test_agent.id,
        pass_rate=20.0,
        total_cases=10,
        passed_cases=2,
        db=db,
    )

    await db.refresh(trust)
    assert low["eval_pass_rate"] == 20.0
    assert low["eval_runs_count"] == 2
    assert trust.eval_pass_rate == 20.0
    assert trust.eval_runs_count == 2
    assert trust.overall_score < high_score


@pytest.mark.asyncio
async def test_eval_run_updates_trust_score_api_payload(monkeypatch, authed_client, db, test_agent, test_user, test_org):
    trust = AgentTrustScore(
        agent_id=test_agent.id,
        overall_score=60.0,
        task_success_rate=70.0,
        review_pass_rate=60.0,
        risky_action_rate=90.0,
        on_time_rate=80.0,
        cost_efficiency=75.0,
        autonomy_history=[],
    )
    suite = EvalSuite(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        user_id=test_user.id,
        agent_id=test_agent.id,
        name="Regression Suite",
        description="Checks eval to trust wiring",
        pass_threshold=0.8,
    )
    case = EvalCase(
        id=str(uuid.uuid4()),
        suite_id=suite.id,
        name="Case 1",
        description="Simple passing case",
        input="Say hello",
        expected_output="hello",
        scoring_method=ScoringMethod.exact_match,
        scoring_config="{}",
        weight=1.0,
    )
    db.add_all([trust, suite, case])
    await db.commit()

    async def fake_run_case(self, suite_id, run_id, case_id, agent_id, user_id, model_config_id=None):
        return {
            "case_id": case_id,
            "score": 1.0,
            "passed": True,
            "error": None,
            "tokens_used": 0,
            "cost_usd": 0.0,
        }

    async def noop_broadcast(*args, **kwargs):
        return None

    monkeypatch.setattr("services.eval_runner.EvalRunner._run_case", fake_run_case)
    monkeypatch.setattr("services.eval_runner.ws_manager.broadcast", noop_broadcast)

    run_response = await authed_client.post(
        f"/api/evals/suites/{suite.id}/run",
        json={"triggered_by": "manual"},
    )
    assert run_response.status_code == 200
    assert run_response.json()["passed_cases"] == 1

    trust_response = await authed_client.get(f"/api/roles/agents/{test_agent.id}/trust-score")
    assert trust_response.status_code == 200
    payload = trust_response.json()
    assert payload["eval_pass_rate"] == 100.0
    assert payload["eval_runs_count"] == 1
    assert payload["overall_score"] > 60.0
    assert payload["components"]["eval_pass_rate"] == 100.0

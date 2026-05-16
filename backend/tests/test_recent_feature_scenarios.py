from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from config import settings
from database.models import EvalCase, EvalRun, EvalSuite, ModelConfig, ScoringMethod, Workflow


@pytest.mark.asyncio
async def test_agency_owner_operations_scenario(monkeypatch, authed_client, db, test_org, test_user, test_agent):
    import api.workflows as workflows_module

    # Tool health should expose the newly added provider status surface.
    monkeypatch.setattr(settings, "google_client_id", "", raising=False)
    tool_health = await authed_client.get("/api/tools/health")
    assert tool_health.status_code == 200
    tool_payload = tool_health.json()
    assert set(tool_payload.keys()) >= {"search", "gmail", "slack", "github"}
    assert tool_payload["search"]["provider"] in {"brave", "serper", "ddg", "none"}
    assert tool_payload["gmail"]["status"] == "not_configured"

    # Notification preferences should be created with defaults, then persist updates.
    defaults = await authed_client.get("/api/notifications/preferences")
    assert defaults.status_code == 200
    assert defaults.json()["daily_digest_enabled"] is True
    assert defaults.json()["daily_digest_time"] == "08:00"

    updated = await authed_client.put(
        "/api/notifications/preferences",
        json={
            "email_on_approval_needed": True,
            "email_on_execution_complete": True,
            "email_on_autonomy_change": False,
            "daily_digest_enabled": True,
            "daily_digest_time": "07:30",
            "notification_email": "ops@example.com",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["email_on_execution_complete"] is True
    assert updated.json()["daily_digest_time"] == "07:30"
    assert updated.json()["notification_email"] == "ops@example.com"

    # Enable a quick automation for a research-style agent and confirm it shows up as enabled.
    test_agent.role_slug = "research-analyst"
    test_agent.name = "Research Analyst"
    await db.commit()

    templates_before = await authed_client.get("/api/workflows/automation-templates")
    assert templates_before.status_code == 200
    assert any(item["id"] == "daily_research" and item["enabled"] is False for item in templates_before.json())

    enable = await authed_client.post("/api/workflows/automation-templates/daily_research/enable")
    assert enable.status_code == 200
    enabled_workflow = enable.json()["workflow"]
    assert enable.json()["enabled"] is True
    assert enabled_workflow["schedule_enabled"] is True
    assert enabled_workflow["template_id"] == "automation:daily_research"

    templates_after = await authed_client.get("/api/workflows/automation-templates")
    assert templates_after.status_code == 200
    assert any(item["id"] == "daily_research" and item["enabled"] is True for item in templates_after.json())

    scheduled = await authed_client.get("/api/workflows/scheduled")
    assert scheduled.status_code == 200
    assert any(item["workflow_id"] == enabled_workflow["id"] for item in scheduled.json())

    # The public webhook trigger should dispatch a real execution payload for the enabled workflow.
    captured: dict[str, str | None] = {}

    async def fake_run_workflow_background(
        execution_id,
        workflow_id,
        input_message,
        user_id=None,
        org_id=None,
        memory_service=None,
        hitl_service=None,
    ):
        captured["execution_id"] = execution_id
        captured["workflow_id"] = workflow_id
        captured["input_message"] = input_message
        captured["user_id"] = user_id
        captured["org_id"] = org_id

    monkeypatch.setattr(workflows_module, "run_workflow_background", fake_run_workflow_background)

    webhook_url = await authed_client.get(f"/api/workflows/{enabled_workflow['id']}/webhook-url")
    assert webhook_url.status_code == 200
    token = webhook_url.json()["webhook_url"].rsplit("/", 1)[-1]

    public_trigger = await authed_client.post(
        f"/api/webhooks/trigger/{token}",
        json={"input_message": "Run the morning research digest for Acme."},
    )
    assert public_trigger.status_code == 200
    assert public_trigger.json()["triggered"] is True
    assert captured["workflow_id"] == enabled_workflow["id"]
    assert "Acme" in str(captured["input_message"])
    assert captured["org_id"] == test_org.id
    assert captured["user_id"] == test_user.id


@pytest.mark.asyncio
async def test_agency_owner_agent_quality_scenario(monkeypatch, authed_client, db, test_agent, test_user, test_org):
    session_factory = async_sessionmaker(db.bind, expire_on_commit=False)

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
        session = db
        owns_session = session is None
        if session is None:
            session = session_factory()

        suite = await session.scalar(select(EvalSuite).where(EvalSuite.id == suite_id))
        run = EvalRun(
            id=str(uuid.uuid4()),
            suite_id=suite_id,
            user_id=user_id,
            status="completed",
            triggered_by=triggered_by,
            total_cases=5,
            passed_cases=4 if triggered_by != "compare" or kwargs.get("comparison_slot") == "model_b" else 3,
            failed_cases=1 if triggered_by != "compare" or kwargs.get("comparison_slot") == "model_b" else 2,
            error_cases=0,
            suite_score=0.8 if triggered_by != "compare" or kwargs.get("comparison_slot") == "model_b" else 0.6,
            passed=True,
            duration_seconds=3.1 if kwargs.get("comparison_slot") == "model_b" else 4.2,
            total_cost_usd=0.0021 if kwargs.get("comparison_slot") == "model_b" else 0.0034,
            completed_at=datetime.now(timezone.utc),
            model_config_id=model_config_id,
            comparison_group_id=kwargs.get("comparison_group_id"),
            comparison_slot=kwargs.get("comparison_slot"),
        )
        session.add(run)
        suite.last_run_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(run)
        if owns_session:
            await session.close()
        return run

    async def fake_reason(*args, **kwargs):
        return "Model B wins on pass rate and cost."

    monkeypatch.setattr("services.eval_generator.EvalGenerator.generate_cases_from_agent_prompt", fake_generate)
    monkeypatch.setattr("services.eval_runner.EvalRunner.run_suite", fake_run_suite)
    monkeypatch.setattr("api.evals._generate_comparison_reason", fake_reason)

    model_a = ModelConfig(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        provider="openai",
        model_id="gpt-4o-mini",
        display_name="GPT-4o Mini",
        is_active=True,
        is_default=False,
    )
    model_b = ModelConfig(
        id=str(uuid.uuid4()),
        org_id=test_org.id,
        provider="anthropic",
        model_id="claude-3-5-haiku",
        display_name="Claude 3.5 Haiku",
        is_active=True,
        is_default=False,
    )
    db.add_all([model_a, model_b])
    await db.commit()

    quick_test = await authed_client.post(f"/api/evals/quick-test/{test_agent.id}")
    assert quick_test.status_code == 200
    quick_payload = quick_test.json()
    assert quick_payload["pass_rate"] == 80.0
    assert quick_payload["passed"] == 4
    assert quick_payload["total"] == 5
    assert quick_payload["suite_id"]

    suite = await db.scalar(select(EvalSuite).where(EvalSuite.id == quick_payload["suite_id"]))
    assert suite is not None
    assert suite.agent_id == test_agent.id

    compare = await authed_client.post(
        f"/api/evals/suites/{suite.id}/compare",
        json={"model_a_id": model_a.id, "model_b_id": model_b.id},
    )
    assert compare.status_code == 200
    compare_payload = compare.json()
    assert compare_payload["winner"] == "model_b"
    assert compare_payload["model_a"]["model_name"] == "gpt-4o-mini"
    assert compare_payload["model_b"]["model_name"] == "claude-3-5-haiku"
    assert compare_payload["model_a"]["pass_rate"] == 60.0
    assert compare_payload["model_b"]["pass_rate"] == 80.0
    assert compare_payload["winner_reason"] == "Model B wins on pass rate and cost."

    history = await authed_client.get(f"/api/evals/suites/{suite.id}/compare-history")
    assert history.status_code == 200
    history_payload = history.json()
    assert len(history_payload["comparisons"]) == 1
    assert history_payload["comparisons"][0]["winner"] == "model_b"
    assert history_payload["comparisons"][0]["model_a"]["model_config_id"] == model_a.id
    assert history_payload["comparisons"][0]["model_b"]["model_config_id"] == model_b.id

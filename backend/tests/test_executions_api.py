from datetime import datetime

import pytest
from sqlalchemy import select

import api.executions as executions_api
from database.models import (
    Agent,
    AgentMemoryEntry,
    AgentTrustScore,
    Client,
    ClientKnowledge,
    Execution,
    ExecutionStatus,
    IntegrationType,
    Organization,
    UserIntegration,
    Workflow,
)
from runtime.workflow_engine import WorkflowEngine
from services.integration_crypto import encrypt_config


@pytest.mark.asyncio
async def test_run_workflow_creates_execution_record(authed_client, db, test_workflow, monkeypatch):
    async def fake_background(*args, **kwargs):
        return None

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={"input_message": "Run this workflow", "trigger": "manual"},
    )

    assert response.status_code == 202
    payload = response.json()
    execution = await db.scalar(select(Execution).where(Execution.id == payload["id"]))
    assert execution is not None
    assert execution.workflow_id == test_workflow.id
    assert execution.status in {ExecutionStatus.pending, ExecutionStatus.running}


@pytest.mark.asyncio
async def test_execution_status_updates_correctly(authed_client, db, test_workflow, monkeypatch):
    async def fake_background(execution_id, *args, **kwargs):
        execution = await db.scalar(select(Execution).where(Execution.id == execution_id))
        execution.status = ExecutionStatus.completed
        execution.output_message = "Completed successfully"
        execution.completed_at = datetime.utcnow()
        await db.commit()

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={"input_message": "Complete it", "trigger": "manual"},
    )

    assert response.status_code == 202
    execution = await db.scalar(select(Execution).where(Execution.id == response.json()["id"]))
    assert execution.status == ExecutionStatus.completed
    assert execution.completed_at is not None


@pytest.mark.asyncio
async def test_execution_has_no_monthly_limit(authed_client, db, test_org, test_workflow):
    for index in range(100):
        db.add(
            Execution(
                org_id=test_org.id,
                workflow_id=test_workflow.id,
                trigger="manual",
                status=ExecutionStatus.completed,
                input_message=f"Existing execution {index}",
                started_at=datetime.utcnow(),
                completed_at=datetime.utcnow(),
            )
        )
    await db.commit()

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={"input_message": "Should still run", "trigger": "manual"},
    )

    assert response.status_code == 202


@pytest.mark.asyncio
async def test_execution_result_is_stored(authed_client, db, test_workflow, monkeypatch):
    async def fake_background(execution_id, *args, **kwargs):
        execution = await db.scalar(select(Execution).where(Execution.id == execution_id))
        execution.status = ExecutionStatus.completed
        execution.output_message = "Final generated result"
        execution.completed_at = datetime.utcnow()
        await db.commit()

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={"input_message": "Store result", "trigger": "manual"},
    )

    execution_id = response.json()["id"]
    detail_response = await authed_client.get(f"/api/executions/{execution_id}")

    assert response.status_code == 202
    assert detail_response.status_code == 200
    assert detail_response.json()["output_message"] == "Final generated result"
    assert detail_response.json()["output"] == "Final generated result"


@pytest.mark.asyncio
async def test_run_workflow_builds_input_message_from_variables(authed_client, db, test_workflow, monkeypatch):
    test_workflow.input_variables = [
        {
            "name": "client_name",
            "label": "Client Name",
            "type": "text",
            "required": True,
            "default": "",
        },
        {
            "name": "topic",
            "label": "Research Topic",
            "type": "text",
            "required": True,
            "default": "",
        },
        {
            "name": "tone",
            "label": "Tone",
            "type": "select",
            "options": ["formal", "casual", "friendly"],
            "required": False,
            "default": "casual",
        },
    ]
    await db.commit()

    captured: dict[str, object] = {}

    async def fake_background(execution_id, workflow_id, input_message, *args, **kwargs):
        captured["execution_id"] = execution_id
        captured["workflow_id"] = workflow_id
        captured["input_message"] = input_message

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={
            "input_values": {
                "client_name": "Acme Corp",
                "topic": "Amazon pricing trends",
                "tone": "friendly",
            },
            "trigger": "manual",
        },
    )

    assert response.status_code == 202
    execution = await db.scalar(select(Execution).where(Execution.id == response.json()["id"]))
    assert execution is not None
    assert execution.input_message == (
        "Client Name: Acme Corp\n"
        "Research Topic: Amazon pricing trends\n"
        "Tone: friendly"
    )
    assert captured["input_message"] == execution.input_message


@pytest.mark.asyncio
async def test_run_workflow_rejects_missing_required_variable(authed_client, db, test_workflow):
    test_workflow.input_variables = [
        {
            "name": "client_name",
            "label": "Client Name",
            "type": "text",
            "required": True,
            "default": "",
        },
        {
            "name": "tone",
            "label": "Tone",
            "type": "select",
            "options": ["formal", "casual"],
            "required": False,
            "default": "casual",
        },
    ]
    await db.commit()

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={"input_values": {"tone": "formal"}, "trigger": "manual"},
    )

    assert response.status_code == 422
    assert "Client Name" in response.json()["detail"]


@pytest.mark.asyncio
async def test_run_workflow_assigns_explicit_client_id(authed_client, db, test_org, test_workflow, monkeypatch):
    client = Client(
        org_id=test_org.id,
        name="Acme Corp",
        company_name="Acme Corp",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    async def fake_background(*args, **kwargs):
        return None

    monkeypatch.setattr(executions_api, "run_workflow_background", fake_background)

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={
            "input_message": "Run for Acme",
            "client_id": client.id,
            "trigger": "manual",
        },
    )

    assert response.status_code == 202
    execution = await db.scalar(select(Execution).where(Execution.id == response.json()["id"]))
    assert execution is not None
    assert execution.client_id == client.id


@pytest.mark.asyncio
async def test_approve_execution_extracts_client_knowledge(
    authed_client,
    db,
    test_org,
    test_workflow,
    monkeypatch,
):
    client = Client(
        org_id=test_org.id,
        name="Acme Corp",
        company_name="Acme Corp",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        client_id=client.id,
        status=ExecutionStatus.pending_review,
        input_message="Research Acme positioning",
        output_message=(
            "Acme prefers short executive summaries, focuses on mid-market buyers, "
            "and consistently compares itself to Nimbus."
        ),
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    async def fake_extract_preferences(*_args, **_kwargs):
        return None

    async def fake_extract_client_learnings(*_args, **_kwargs):
        return [
            {"content": "Prefers short executive summaries.", "category": "preference", "confidence": 0.94},
            {"content": "Targets mid-market buyers.", "category": "product", "confidence": 0.86},
        ]

    monkeypatch.setattr(executions_api, "_extract_preferences", fake_extract_preferences)
    monkeypatch.setattr(executions_api, "_extract_client_learnings", fake_extract_client_learnings)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/approve",
        json={"note": "Looks right"},
    )

    assert response.status_code == 200
    facts = (
        await db.execute(
            select(ClientKnowledge)
            .where(
                ClientKnowledge.org_id == test_org.id,
                ClientKnowledge.client_id == client.id,
            )
            .order_by(ClientKnowledge.created_at.asc())
        )
    ).scalars().all()
    assert [fact.content for fact in facts] == [
        "Prefers short executive summaries.",
        "Targets mid-market buyers.",
    ]


@pytest.mark.asyncio
async def test_run_workflow_rejects_client_from_another_org(authed_client, db, test_workflow, test_user):
    other_org = Organization(
        id="foreign-org",
        name="Foreign Org",
        slug="foreign-org",
        plan="open_source",
        owner_user_id=test_user.id,
    )
    foreign_client = Client(
        org_id=other_org.id,
        name="Foreign Client",
        company_name="Foreign Client",
    )
    db.add_all([other_org, foreign_client])
    await db.commit()
    await db.refresh(foreign_client)

    response = await authed_client.post(
        f"/api/executions/workflows/{test_workflow.id}/run",
        json={
            "input_message": "Run for wrong org client",
            "client_id": foreign_client.id,
            "trigger": "manual",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Client not found"


@pytest.mark.asyncio
async def test_cancel_execution_marks_status_cancelled(authed_client, db, test_org, test_workflow):
    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.running,
        input_message="Cancel me",
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.delete(f"/api/executions/{execution.id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["cancelled"] is True

    refreshed = await db.scalar(select(Execution).where(Execution.id == execution.id))
    assert refreshed is not None
    assert refreshed.status == ExecutionStatus.cancelled
    assert refreshed.completed_at is not None
    assert refreshed.error is not None
    assert "Cancelled by" in refreshed.error


@pytest.mark.asyncio
async def test_approve_execution_marks_pending_review_completed(authed_client, db, test_org, test_workflow, test_user, monkeypatch):
    captured: dict[str, object] = {}
    review_calls: list[tuple[str, bool]] = []

    async def fake_record_task_completed(**kwargs):
        captured.update(kwargs)

    async def fake_record_review_result(*, agent_id: str, passed: bool, db):
        review_calls.append((agent_id, passed))

    async def fake_extract_preferences(*_args, **_kwargs):
        return "Keep responses under 300 words. Use informal tone."

    monkeypatch.setattr(
        "services.trust_score_service.trust_score_service.record_task_completed",
        fake_record_task_completed,
    )
    monkeypatch.setattr(
        "services.trust_score_service.trust_score_service.record_review_result",
        fake_record_review_result,
    )
    monkeypatch.setattr(
        executions_api,
        "_extract_preferences",
        fake_extract_preferences,
    )

    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status="pending_review",
        input_message="Review me",
        output_message="Looks good",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/approve",
        json={"note": "Approved by CEO"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["execution_id"] == execution.id

    refreshed = await db.scalar(select(Execution).where(Execution.id == execution.id))
    assert refreshed is not None
    assert refreshed.status == ExecutionStatus.completed
    assert refreshed.approved_by == test_user.id
    assert refreshed.approved_at is not None
    assert refreshed.approval_note == "Approved by CEO"
    assert captured["agent_id"] == test_workflow.nodes[0]["data"]["agent_id"]
    assert captured["success"] is True
    assert review_calls == [(test_workflow.nodes[0]["data"]["agent_id"], True)]
    pref = await db.scalar(
        select(AgentMemoryEntry).where(
            AgentMemoryEntry.agent_id == test_workflow.nodes[0]["data"]["agent_id"],
            AgentMemoryEntry.org_id == test_org.id,
            AgentMemoryEntry.memory_type == "ceo_preference",
        )
    )
    assert pref is not None
    assert pref.always_inject is True
    assert pref.source == "ceo_feedback"
    assert pref.content_preview == "Keep responses under 300 words. Use informal tone."


@pytest.mark.asyncio
async def test_execution_api_exposes_normalized_review_state(authed_client, db, test_org, test_workflow):
    pending_review_execution = Execution(
        id="exec-review-state-final",
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="Review the final output",
        started_at=datetime.utcnow(),
    )
    waiting_approval_execution = Execution(
        id="exec-review-state-step",
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.waiting_approval,
        input_message="Review the approval step",
        started_at=datetime.utcnow(),
    )
    db.add_all([pending_review_execution, waiting_approval_execution])
    await db.commit()

    list_response = await authed_client.get("/api/executions")
    assert list_response.status_code == 200
    payload_by_id = {item["id"]: item for item in list_response.json()}

    assert payload_by_id["exec-review-state-final"]["review_state"] == "needs_review"
    assert payload_by_id["exec-review-state-final"]["review_stage"] == "final_review"
    assert payload_by_id["exec-review-state-final"]["requires_ceo_action"] is True
    assert payload_by_id["exec-review-state-final"]["status_label"] == "needs review"

    assert payload_by_id["exec-review-state-step"]["review_state"] == "needs_review"
    assert payload_by_id["exec-review-state-step"]["review_stage"] == "workflow_pause"
    assert payload_by_id["exec-review-state-step"]["requires_ceo_action"] is True
    assert payload_by_id["exec-review-state-step"]["status_label"] == "needs review"

    detail_response = await authed_client.get("/api/executions/exec-review-state-step")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["review_state"] == "needs_review"
    assert detail["review_stage"] == "workflow_pause"
    assert detail["status_label"] == "needs review"


@pytest.mark.asyncio
async def test_workflow_engine_marks_execution_pending_review_when_required(db, test_workflow, monkeypatch):
    test_workflow.requires_review = True
    execution = Execution(
        org_id=test_workflow.org_id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending,
        input_message="Review required run",
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(test_workflow)
    await db.refresh(execution)

    async def fake_execute(self, input_message, execution_id):
        return "Needs review", 42

    async def fake_broadcast(*args, **kwargs):
        return None

    monkeypatch.setattr("runtime.workflow_engine.WorkflowExecutor.execute", fake_execute)
    monkeypatch.setattr("runtime.workflow_engine.ws_manager.broadcast_to_channel", fake_broadcast)

    engine = WorkflowEngine(db)
    output, tokens = await engine.run(test_workflow.id, "Review required run", None, execution.id)

    refreshed = await db.scalar(select(Execution).where(Execution.id == execution.id))
    assert output == "Needs review"
    assert tokens == 42
    assert refreshed is not None
    assert refreshed.status == ExecutionStatus.pending_review
    assert refreshed.output_message == "Needs review"
    assert refreshed.completed_at is not None


@pytest.mark.asyncio
async def test_regenerate_execution_creates_follow_up_run(authed_client, db, test_org, test_workflow, monkeypatch):
    captured: dict[str, object] = {}
    review_calls: list[tuple[str, bool]] = []

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **kwargs):
        captured["execution_id"] = execution_id
        captured["workflow_id"] = workflow_id
        captured["input_message"] = input_message
        captured["user_id"] = user_id
        captured["org_id"] = org_id
        return "background"

    async def fake_extract_preferences(*_args, **_kwargs):
        return "Keep responses shorter and more casual."

    monkeypatch.setattr(executions_api, "enqueue_workflow_execution", fake_enqueue)
    async def fake_record_review_result(*, agent_id: str, passed: bool, db):
        review_calls.append((agent_id, passed))

    monkeypatch.setattr(
        "services.trust_score_service.trust_score_service.record_review_result",
        fake_record_review_result,
    )
    monkeypatch.setattr(
        executions_api,
        "_extract_preferences",
        fake_extract_preferences,
    )

    original = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="Write a summary",
        output_message="Original output",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(original)
    await db.commit()
    await db.refresh(original)

    response = await authed_client.post(
        f"/api/executions/{original.id}/regenerate",
        json={"feedback": "Make it shorter and more casual."},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["revision_id"] != original.id
    assert payload["revision_number"] == 2
    assert payload["status"] == "running"

    await db.refresh(original)
    follow_up = await db.scalar(select(Execution).where(Execution.id == payload["revision_id"]))
    assert follow_up is not None
    assert follow_up.workflow_id == test_workflow.id
    assert follow_up.status == ExecutionStatus.pending
    assert follow_up.parent_execution_id == original.id
    assert follow_up.revision_number == 2
    assert follow_up.ceo_feedback == "Make it shorter and more casual."
    assert "CEO FEEDBACK ON PREVIOUS VERSION:" in follow_up.input_message
    assert "Make it shorter and more casual." in follow_up.input_message
    assert "Please revise your response addressing all feedback above." in follow_up.input_message
    assert original.status == ExecutionStatus.cancelled
    assert review_calls == [(test_workflow.nodes[0]["data"]["agent_id"], False)]
    assert follow_up.id in (original.error or "")
    assert captured["workflow_id"] == test_workflow.id
    assert captured["execution_id"] == follow_up.id
    pref = await db.scalar(
        select(AgentMemoryEntry).where(
            AgentMemoryEntry.agent_id == test_workflow.nodes[0]["data"]["agent_id"],
            AgentMemoryEntry.org_id == test_org.id,
            AgentMemoryEntry.memory_type == "ceo_preference",
        )
    )
    assert pref is not None
    assert pref.always_inject is True
    assert pref.source == "ceo_feedback"
    assert pref.content_preview == "Keep responses shorter and more casual."


@pytest.mark.asyncio
async def test_get_execution_revisions_returns_full_revision_chain(authed_client, db, test_org, test_workflow, test_user):
    root = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.cancelled,
        input_message="Draft a client update",
        output_message="Version 1 output",
        revision_number=1,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        error="Superseded by revision v2",
    )
    db.add(root)
    await db.flush()

    revision_two = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="revision",
        status=ExecutionStatus.cancelled,
        input_message="Draft a client update\n\n---\nCEO FEEDBACK ON PREVIOUS VERSION:\nMake it shorter.",
        output_message="Version 2 output",
        parent_execution_id=root.id,
        revision_number=2,
        ceo_feedback="Make it shorter.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        error="Superseded by revision v3",
    )
    db.add(revision_two)
    await db.flush()

    revision_three = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="revision",
        status=ExecutionStatus.completed,
        input_message="Draft a client update\n\n---\nCEO FEEDBACK ON PREVIOUS VERSION:\nRemove the pricing table.",
        output_message="Version 3 output",
        parent_execution_id=revision_two.id,
        revision_number=3,
        ceo_feedback="Remove the pricing table.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        approved_by=test_user.id,
        approved_at=datetime.utcnow(),
    )
    db.add(revision_three)
    await db.commit()

    response = await authed_client.get(f"/api/executions/{revision_three.id}/revisions")

    assert response.status_code == 200
    payload = response.json()
    assert [item["revision_number"] for item in payload] == [1, 2, 3]
    assert [item["id"] for item in payload] == [root.id, revision_two.id, revision_three.id]
    assert payload[0]["output"] == "Version 1 output"
    assert payload[1]["ceo_feedback"] == "Make it shorter."
    assert payload[2]["ceo_feedback"] == "Remove the pricing table."
    assert payload[2]["approved_by"] == test_user.id
    assert payload[2]["approved_at"] is not None


@pytest.mark.asyncio
async def test_extract_preferences_falls_back_to_heuristics(monkeypatch):
    class _BrokenModel:
        async def ainvoke(self, _prompt):
            raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        "services.model_service.model_service._build_from_settings",
        lambda **_kwargs: _BrokenModel(),
    )

    result = await executions_api._extract_preferences(
        "keep it under 300 words and informal",
        "agent-1",
    )

    assert result == "Keep responses under 300 words. Use informal tone."


@pytest.mark.asyncio
async def test_export_requires_approved_execution(authed_client, db, test_org, test_workflow):
    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Draft a report",
        output_message="## Findings\n\nPricing is clear.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.get(f"/api/executions/{execution.id}/export?format=pdf")

    assert response.status_code == 400
    assert "approved before export" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_export_returns_pdf_attachment_for_approved_execution(authed_client, db, test_org, test_workflow, test_user, monkeypatch):
    async def fake_render_pdf(**kwargs):
        assert kwargs["agency_name"] == test_org.name
        assert kwargs["workflow_name"] == test_workflow.name
        return b"%PDF-test"

    monkeypatch.setattr(executions_api, "_render_execution_pdf", fake_render_pdf)

    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Draft a report",
        output_message="## Findings\n\nPricing is clear.",
        started_at=datetime.utcnow(),
        completed_at=datetime(2026, 5, 18, 14, 30),
        approved_by=test_user.id,
        approved_at=datetime(2026, 5, 18, 15, 0),
        approval_note="Looks good",
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.get(f"/api/executions/{execution.id}/export?format=pdf")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert "attachment;" in response.headers["content-disposition"]
    assert "test-workflow-2026-05-18.pdf" in response.headers["content-disposition"]
    assert response.content == b"%PDF-test"


@pytest.mark.asyncio
async def test_export_returns_docx_attachment_for_approved_execution(authed_client, db, test_org, test_workflow, test_user, monkeypatch):
    async def fake_render_docx(**kwargs):
        assert kwargs["agency_name"] == test_org.name
        assert kwargs["workflow_name"] == test_workflow.name
        return b"PK-docx-test"

    monkeypatch.setattr(executions_api, "_render_execution_docx", fake_render_docx)

    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Draft a report",
        output_message="## Findings\n\nPricing is clear.",
        started_at=datetime.utcnow(),
        completed_at=datetime(2026, 5, 18, 14, 30),
        approved_by=test_user.id,
        approved_at=datetime(2026, 5, 18, 15, 0),
        approval_note="Looks good",
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.get(f"/api/executions/{execution.id}/export?format=docx")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert "attachment;" in response.headers["content-disposition"]
    assert "test-workflow-2026-05-18.docx" in response.headers["content-disposition"]
    assert response.content == b"PK-docx-test"


@pytest.mark.asyncio
async def test_deliver_portal_enables_client_portal_and_persists_delivery(
    authed_client,
    db,
    test_org,
    test_workflow,
    test_user,
):
    client = Client(
        org_id=test_org.id,
        name="Amazon",
        company_name="Amazon",
        contact_email="client@amazon.com",
        portal_enabled=False,
    )
    db.add(client)
    await db.flush()

    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        client_id=client.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Deliver this report",
        output_message="## Findings\n\nReady for the client.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        approved_by=test_user.id,
        approved_at=datetime.utcnow(),
        approval_note="Ship it",
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/deliver",
        json={"method": "portal"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["delivered"] is True
    assert payload["method"] == "portal"
    assert "/portal/" in payload["target"]

    await db.refresh(execution)
    await db.refresh(client)
    assert execution.delivered_at is not None
    assert execution.delivery_method == "portal"
    assert execution.delivery_target == payload["target"]
    assert client.portal_enabled is True
    assert client.portal_token is not None


@pytest.mark.asyncio
async def test_deliver_requires_approved_execution(authed_client, db, test_org, test_workflow):
    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Deliver this draft",
        output_message="## Findings\n\nStill pending review.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/deliver",
        json={"method": "portal"},
    )

    assert response.status_code == 400
    assert "approved before delivery" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_deliver_email_without_gmail_returns_helpful_error(
    authed_client,
    db,
    test_org,
    test_workflow,
    test_user,
):
    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Email this",
        output_message="## Findings\n\nSend me to the client.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        approved_by=test_user.id,
        approved_at=datetime.utcnow(),
        approval_note="Looks good",
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/deliver",
        json={"method": "email", "email_to": "client@example.com"},
    )

    assert response.status_code == 422
    assert "not connected" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_deliver_google_doc_returns_doc_url_and_persists_delivery(
    authed_client,
    db,
    test_org,
    test_workflow,
    test_user,
    monkeypatch,
):
    async def fake_create_google_doc(**kwargs):
        assert kwargs["org_id"] == test_org.id
        assert kwargs["user_id"] == test_user.id
        assert kwargs["title"] == "Client Report"
        assert "Findings" in kwargs["content"]
        return "https://docs.google.com/document/d/doc-123/edit"

    monkeypatch.setattr(executions_api, "_create_google_doc", fake_create_google_doc)

    integration = UserIntegration(
        org_id=test_org.id,
        user_id=test_user.id,
        integration_type=IntegrationType.gmail,
        name="hello@example.com",
        config=encrypt_config(
            {
                "access_token": "google-access",
                "refresh_token": "google-refresh",
                "email": "hello@example.com",
                "scopes": [
                    "https://www.googleapis.com/auth/gmail.send",
                    "https://www.googleapis.com/auth/drive.file",
                ],
            }
        ),
        is_active=True,
    )
    db.add(integration)

    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.completed,
        input_message="Save this to Docs",
        output_message="## Findings\n\nStore this in Drive.",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        approved_by=test_user.id,
        approved_at=datetime.utcnow(),
        approval_note="Looks good",
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    response = await authed_client.post(
        f"/api/executions/{execution.id}/deliver",
        json={"method": "google_doc", "doc_title": "Client Report"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["delivered"] is True
    assert payload["method"] == "google_doc"
    assert payload["target"] == "https://docs.google.com/document/d/doc-123/edit"

    await db.refresh(execution)
    assert execution.delivered_at is not None
    assert execution.delivery_method == "google_doc"
    assert execution.delivery_target == payload["target"]


@pytest.mark.asyncio
async def test_approval_after_revisions_increases_trust_less_than_first_draft(
    authed_client,
    db,
    test_org,
    test_workflow,
    monkeypatch,
):
    async def fake_enqueue(*_args, **_kwargs):
        return "background"

    async def fake_extract_preferences(*_args, **_kwargs):
        return "Keep responses concise."

    monkeypatch.setattr(executions_api, "enqueue_workflow_execution", fake_enqueue)
    monkeypatch.setattr(executions_api, "_extract_preferences", fake_extract_preferences)

    first_draft_execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="First draft",
        output_message="First output",
        revision_number=1,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(first_draft_execution)
    await db.commit()
    await db.refresh(first_draft_execution)

    approve_first = await authed_client.post(
        f"/api/executions/{first_draft_execution.id}/approve",
        json={"note": "Looks good"},
    )
    assert approve_first.status_code == 200

    agent_one_score = await db.scalar(
        select(AgentTrustScore).where(
            AgentTrustScore.agent_id == test_workflow.nodes[0]["data"]["agent_id"]
        )
    )
    assert agent_one_score is not None
    first_draft_delta = agent_one_score.overall_score - 50.0

    revision_agent = Agent(
        name="Revision Agent",
        role="tester",
        description="A revision-heavy agent",
        system_prompt="You revise copy.",
        model="llama-3.3-70b-versatile",
        org_id=test_org.id,
        tools=[],
        max_retries=3,
    )
    db.add(revision_agent)
    await db.commit()
    await db.refresh(revision_agent)

    revision_workflow = Workflow(
        name="Revision Workflow",
        description="Workflow for revision trust test",
        nodes=[
            {
                "id": "node_revision",
                "type": "agent",
                "data": {"agent_id": revision_agent.id},
            }
        ],
        edges=[],
        execution_mode="sequential",
        org_id=test_org.id,
        trigger="manual",
        status="draft",
        requires_review=True,
    )
    db.add(revision_workflow)
    await db.commit()
    await db.refresh(revision_workflow)

    root = Execution(
        org_id=test_org.id,
        workflow_id=revision_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="Version 1",
        output_message="Version 1 output",
        revision_number=1,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(root)
    await db.commit()
    await db.refresh(root)

    regen_one = await authed_client.post(
        f"/api/executions/{root.id}/regenerate",
        json={"feedback": "Make it shorter."},
    )
    assert regen_one.status_code == 202
    revision_two_id = regen_one.json()["revision_id"]
    revision_two = await db.scalar(select(Execution).where(Execution.id == revision_two_id))
    assert revision_two is not None
    revision_two.status = ExecutionStatus.pending_review
    revision_two.output_message = "Version 2 output"
    revision_two.completed_at = datetime.utcnow()
    await db.commit()

    regen_two = await authed_client.post(
        f"/api/executions/{revision_two.id}/regenerate",
        json={"feedback": "Still too long."},
    )
    assert regen_two.status_code == 202
    revision_three_id = regen_two.json()["revision_id"]
    revision_three = await db.scalar(select(Execution).where(Execution.id == revision_three_id))
    assert revision_three is not None
    revision_three.status = ExecutionStatus.pending_review
    revision_three.output_message = "Version 3 output"
    revision_three.completed_at = datetime.utcnow()
    await db.commit()

    approve_third = await authed_client.post(
        f"/api/executions/{revision_three.id}/approve",
        json={"note": "Approved on v3"},
    )
    assert approve_third.status_code == 200

    revision_score = await db.scalar(
        select(AgentTrustScore).where(AgentTrustScore.agent_id == revision_agent.id)
    )
    assert revision_score is not None
    revision_delta = revision_score.overall_score - 50.0

    assert revision_score.total_reviews == 3
    assert revision_score.passed_reviews == 1
    assert revision_delta < first_draft_delta


@pytest.mark.asyncio
async def test_review_required_workflow_updates_trust_exactly_once_after_approval(
    authed_client,
    db,
    test_workflow,
):
    test_workflow.requires_review = True
    await db.commit()
    await db.refresh(test_workflow)

    agent_id = test_workflow.nodes[0]["data"]["agent_id"]

    execution = Execution(
        org_id=test_workflow.org_id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending_review,
        input_message="Need human review",
        output_message="Approved output",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    before = await db.scalar(
        select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id)
    )
    before_score = before.overall_score if before else 50.0
    before_tasks = before.total_tasks if before else 0

    approve_response = await authed_client.post(
        f"/api/executions/{execution.id}/approve",
        json={"note": "Looks good"},
    )

    assert approve_response.status_code == 200

    after = await db.scalar(
        select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id)
    )
    assert after is not None
    assert after.overall_score > before_score
    assert after.total_tasks == before_tasks + 1

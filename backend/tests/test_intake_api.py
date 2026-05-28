from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

import api.intake as intake_api
from database.models import Client, ClientIntakeForm, ClientIntakeSubmission, Execution, Workflow


@pytest.mark.asyncio
async def test_public_intake_submission_creates_execution(
    authed_client,
    client,
    db,
    test_org,
    test_workflow,
    monkeypatch,
):
    created_executions: list[str] = []

    async def fake_background(execution_id, *_args, **_kwargs):
        created_executions.append(execution_id)
        return None

    monkeypatch.setattr(intake_api, "run_workflow_background", fake_background)

    intake_client = Client(
        org_id=test_org.id,
        name="Acme Intake",
        company_name="Acme Intake",
    )
    db.add(intake_client)
    await db.commit()
    await db.refresh(intake_client)

    create_form = await authed_client.post(
        "/api/intake/forms",
        json={
            "client_id": intake_client.id,
            "title": "Content brief intake",
            "workflow_id": test_workflow.id,
            "fields": [
                {"name": "topic", "label": "Topic", "type": "text", "required": True},
                {"name": "deadline", "label": "Deadline", "type": "text", "required": False},
            ],
        },
    )
    assert create_form.status_code == 201
    form = create_form.json()

    public_submit = await client.post(
        f"/api/intake/{form['token']}",
        json={
            "topic": "Competitor teardown",
            "deadline": "Friday",
        },
    )
    assert public_submit.status_code == 201
    payload = public_submit.json()
    assert payload["status"] == "submitted"
    assert payload["execution_id"]

    execution = await db.scalar(select(Execution).where(Execution.id == payload["execution_id"]))
    assert execution is not None
    assert execution.client_id == intake_client.id
    assert "Topic: Competitor teardown" in execution.input_message
    assert "Deadline: Friday" in execution.input_message
    assert execution.id in created_executions

    submission = await db.scalar(
        select(ClientIntakeSubmission).where(ClientIntakeSubmission.execution_id == execution.id)
    )
    assert submission is not None


@pytest.mark.asyncio
async def test_list_intake_forms_and_submissions(
    authed_client,
    db,
    test_org,
):
    workflow = Workflow(
        id=str(uuid4()),
        org_id=test_org.id,
        name="Intake Workflow",
        description="Workflow for intake",
        nodes=[],
        edges=[],
        status="draft",
        trigger="manual",
    )
    intake_client = Client(
        org_id=test_org.id,
        name="Submission Client",
        company_name="Submission Client",
    )
    db.add_all([workflow, intake_client])
    await db.commit()
    await db.refresh(intake_client)

    form = ClientIntakeForm(
        org_id=test_org.id,
        client_id=intake_client.id,
        title="Research Intake",
        workflow_id=workflow.id,
        fields=[{"name": "topic", "label": "Topic", "type": "text"}],
        token="public-token",
        is_active=True,
    )
    db.add(form)
    await db.commit()
    await db.refresh(form)

    submission = ClientIntakeSubmission(
        form_id=form.id,
        org_id=test_org.id,
        submitted_data={"topic": "Launch strategy"},
        execution_id="exec-1",
    )
    db.add(submission)
    await db.commit()

    forms_response = await authed_client.get("/api/intake/forms")
    assert forms_response.status_code == 200
    assert len(forms_response.json()) == 1
    assert forms_response.json()[0]["title"] == "Research Intake"

    submissions_response = await authed_client.get(f"/api/intake/forms/{form.id}/submissions")
    assert submissions_response.status_code == 200
    assert len(submissions_response.json()) == 1
    assert submissions_response.json()[0]["submitted_data"]["topic"] == "Launch strategy"

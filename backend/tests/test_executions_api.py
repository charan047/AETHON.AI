from datetime import datetime

import pytest
from sqlalchemy import select

from database.models import Execution, ExecutionStatus
import api.executions as executions_api


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

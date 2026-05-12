import asyncio
from datetime import datetime

import pytest
from sqlalchemy import select

from database.models import Execution, ExecutionStatus
from runtime.graph_builder import WorkflowExecutor
import runtime.workflow_engine as workflow_engine_module
from runtime.workflow_engine import WorkflowEngine


@pytest.mark.asyncio
async def test_cancel_sets_cancelled_not_failed(authed_client, db, test_org, test_workflow):
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
    updated = await db.scalar(select(Execution).where(Execution.id == execution.id))
    assert updated is not None
    assert updated.status == ExecutionStatus.cancelled
    assert updated.status != ExecutionStatus.failed


@pytest.mark.asyncio
async def test_workflow_timeout_marks_execution_timed_out(db, test_org, test_workflow, monkeypatch):
    execution = Execution(
        org_id=test_org.id,
        workflow_id=test_workflow.id,
        trigger="manual",
        status=ExecutionStatus.pending,
        input_message="Run slowly",
        started_at=datetime.utcnow(),
        max_runtime_seconds=1,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    async def slow_execute(self, input_message: str, execution_id: str):
        await asyncio.sleep(1.2)
        return "Too late", 0

    class BoundSession:
        async def __aenter__(self):
            return db

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(WorkflowExecutor, "execute", slow_execute)
    monkeypatch.setattr(workflow_engine_module, "AsyncSessionLocal", lambda: BoundSession())

    engine = WorkflowEngine(db)

    with pytest.raises(asyncio.TimeoutError):
        await engine.run(test_workflow.id, "Run slowly", None, execution.id)

    await db.refresh(execution)
    assert execution.status == ExecutionStatus.timed_out
    assert execution.error == "Exceeded max runtime of 1s"
    assert execution.completed_at is not None

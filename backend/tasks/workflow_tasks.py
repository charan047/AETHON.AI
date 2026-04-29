from celery_app import celery_app


@celery_app.task(
    name="tasks.workflow_tasks.run_workflow_task",
    bind=True,
    max_retries=0,
    track_started=True,
)
def run_workflow_task(self, workflow_id: str, input_message: str, user_id: str, execution_id: str):
    """
    Celery task wrapper for workflow execution.
    Allows long-running workflows to execute without blocking the API.
    Self-healing: if worker dies, Celery can restart the task.
    """
    import asyncio

    from database.db import AsyncSessionLocal
    from runtime.workflow_engine import WorkflowEngine

    async def _run():
        async with AsyncSessionLocal() as db:
            engine = WorkflowEngine(db)
            await engine.run(workflow_id, input_message, user_id, execution_id)

    asyncio.run(_run())
    return {"execution_id": execution_id, "status": "completed"}

import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

from celery_app import celery_app
from config import settings
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from tasks.async_runtime import run_async


logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent


def _ensure_import_path() -> None:
    for path in (BACKEND_DIR, PROJECT_ROOT):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


_ensure_import_path()


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
    _ensure_import_path()

    from database.models import Execution, ExecutionStatus
    from runtime.workflow_engine import WorkflowEngine
    from services.websocket_manager import ws_manager

    async def _run_task():
        task_engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_recycle=1800,
            pool_timeout=30,
            echo=settings.environment == "development",
        )
        session_factory = async_sessionmaker(task_engine, expire_on_commit=False, class_=AsyncSession)

        try:
            async with session_factory() as db:
                engine = WorkflowEngine(db)
                await engine.run(workflow_id, input_message, user_id, execution_id)
            return {"execution_id": execution_id, "status": "completed"}
        except Exception as exc:
            logger.exception("Workflow task failed for execution %s", execution_id)
            async with session_factory() as db:
                execution = await db.get(Execution, execution_id)
                if execution:
                    execution.status = ExecutionStatus.failed
                    execution.error = str(exc)[:1000]
                    execution.completed_at = datetime.utcnow()
                    await db.commit()

            try:
                await ws_manager.broadcast_to_channel(
                    f"execution:{execution_id}",
                    {
                        "event": "execution_failed",
                        "execution_id": execution_id,
                        "error": str(exc)[:500],
                    },
                )
            except Exception:
                logger.exception("Failed to broadcast workflow task error for %s", execution_id)
            raise
        finally:
            await task_engine.dispose()

    return run_async(_run_task())

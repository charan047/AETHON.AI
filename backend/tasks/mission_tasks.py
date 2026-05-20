import sys
from pathlib import Path

from celery_app import celery_app
from tasks.async_runtime import run_async


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent


def _ensure_import_path() -> None:
    for path in (BACKEND_DIR, PROJECT_ROOT):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


_ensure_import_path()


@celery_app.task(
    name="tasks.mission_tasks.run_mission_task",
    bind=True,
    max_retries=0,
    track_started=True,
    time_limit=7200,
)
def run_mission_task(self, mission_id: str):
    _ensure_import_path()

    from database.db import AsyncSessionLocal
    from services.mission_orchestrator import mission_orchestrator

    async def _run():
        async with AsyncSessionLocal() as db:
            await mission_orchestrator.run(mission_id, db)
        return {"mission_id": mission_id, "status": "completed"}

    return run_async(_run())

import sys
from pathlib import Path

from celery import Celery

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import settings


celery_app = Celery(
    "platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["tasks.hitl_tasks", "tasks.workflow_tasks", "tasks.eval_tasks", "tasks.long_running_tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)

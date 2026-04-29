import logging
import uuid
from datetime import datetime
from urllib.parse import urlparse

from apscheduler.jobstores.redis import RedisJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from config import settings
from database.db import AsyncSessionLocal
from database.models import Execution, ExecutionStatus, Workflow
from services.websocket_manager import ws_manager


def _redis_jobstore_config() -> dict:
    parsed = urlparse(settings.redis_url)
    config = {
        "jobs_key": "platform:scheduler:jobs",
        "run_times_key": "platform:scheduler:run_times",
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 6379,
        "db": int((parsed.path or "/0").lstrip("/") or "0"),
    }
    if parsed.password:
        config["password"] = parsed.password
    return config


async def trigger_scheduled_workflow_job(workflow_id: str, user_id: str):
    """Serializable APScheduler target for Redis-backed scheduled jobs."""
    from runtime.workflow_engine import WorkflowEngine

    execution_id = str(uuid.uuid4())
    current_date = datetime.utcnow().date().isoformat()
    standup_prompt = (
        f"MORNING STANDUP - {current_date}\n"
        "Report the following in your response:\n"
        "1. What you completed since the last standup\n"
        "2. What you are working on today\n"
        "3. Any blockers or things needing the founder's attention\n"
        "Use your memory to recall past work. Be specific and concise.\n"
        "Do NOT search the web. Report on actual work only."
    )
    logger = logging.getLogger("scheduler")
    logger.info("Scheduled trigger: workflow %s", workflow_id)

    await ws_manager.broadcast(
        {
            "type": "workflow_scheduled_trigger",
            "workflow_id": workflow_id,
            "execution_id": execution_id,
        }
    )

    async with AsyncSessionLocal() as db:
        workflow = await db.get(Workflow, workflow_id)
        if not workflow:
            logger.warning("Scheduled workflow %s no longer exists", workflow_id)
            return
        execution = Execution(
            id=execution_id,
            org_id=workflow.org_id,
            workflow_id=workflow_id,
            trigger="schedule",
            status=ExecutionStatus.running,
            input_message=standup_prompt,
            started_at=datetime.utcnow(),
        )
        db.add(execution)
        await db.commit()

        engine = WorkflowEngine(db)
        await engine.run(
            workflow_id=workflow_id,
            input_message=standup_prompt,
            user_id=user_id,
            execution_id=execution_id,
        )


class SchedulerService:
    """
    Manages all scheduled workflow executions.
    Uses Redis as job store so schedules survive restarts
    and work across multiple backend processes.
    """

    def __init__(self):
        jobstores = {
            "default": RedisJobStore(**_redis_jobstore_config()),
        }
        self.scheduler = AsyncIOScheduler(jobstores=jobstores, timezone="UTC")
        self.logger = logging.getLogger("scheduler")

    async def start(self):
        if not self.scheduler.running:
            self.scheduler.start()
        await self._sync_schedules_from_db()
        self.logger.info("Scheduler started")

    async def stop(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    async def _sync_schedules_from_db(self):
        """On startup: load all scheduled workflows from DB and register them."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Workflow).where(Workflow.schedule.isnot(None)))
            workflows = result.scalars().all()
            for workflow in workflows:
                if self.scheduler.get_job(f"workflow:{workflow.id}"):
                    continue
                await self.schedule_workflow(workflow.id, workflow.schedule, user_id="system")
        self.logger.info("Loaded %s scheduled workflows", len(workflows))

    async def schedule_workflow(self, workflow_id: str, cron_expression: str, user_id: str):
        """Add or update a workflow schedule."""
        job_id = f"workflow:{workflow_id}"

        try:
            trigger = CronTrigger.from_crontab(cron_expression, timezone="UTC")
        except Exception as exc:
            raise ValueError(f"Invalid cron expression: {cron_expression}") from exc

        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

        self.scheduler.add_job(
            func=trigger_scheduled_workflow_job,
            trigger=trigger,
            id=job_id,
            kwargs={"workflow_id": workflow_id, "user_id": user_id},
            replace_existing=True,
            misfire_grace_time=300,
        )
        self.logger.info("Scheduled workflow %s: %s", workflow_id, cron_expression)

    async def unschedule_workflow(self, workflow_id: str):
        job_id = f"workflow:{workflow_id}"
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

    async def _trigger_scheduled_workflow(self, workflow_id: str, user_id: str):
        """Called by APScheduler when a cron fires."""
        await trigger_scheduled_workflow_job(workflow_id, user_id)

    def get_scheduled_jobs(self) -> list[dict]:
        """Returns all scheduled jobs with next run time."""
        jobs = []
        for job in self.scheduler.get_jobs():
            if job.id.startswith("workflow:"):
                jobs.append(
                    {
                        "workflow_id": job.id.replace("workflow:", ""),
                        "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                        "cron": str(job.trigger),
                    }
                )
        return jobs

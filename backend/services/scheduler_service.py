import asyncio
import logging
import uuid
from datetime import datetime
from urllib.parse import urlparse

from apscheduler.jobstores.redis import RedisJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import redis.asyncio as redis
from sqlalchemy import select

from config import settings
from database.db import AsyncSessionLocal
from database.models import Execution, ExecutionStatus, Workflow
from services.distributed_lock import DistributedLock
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

    async def _run_workflow():
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

    redis_client = None
    try:
        redis_client = redis.from_url(settings.redis_url, decode_responses=True)
        await redis_client.ping()
        async with DistributedLock(redis_client, f"scheduled:{workflow_id}", ttl=3600):
            await _run_workflow()
    except RuntimeError:
        logger.info("Skipping scheduled workflow %s because another process holds the lock", workflow_id)
    except Exception as exc:
        logger.warning("Running scheduled workflow %s without distributed lock: %s", workflow_id, exc)
        await _run_workflow()
    finally:
        if redis_client:
            await redis_client.aclose()


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
        self._redis = None
        self._leadership_task = None
        self._is_leader = False

    async def start(self):
        self._redis = redis.from_url(settings.redis_url, decode_responses=True)
        try:
            await self._redis.ping()
        except Exception as exc:
            self.logger.warning("Redis unavailable for scheduler leadership, starting local scheduler only: %s", exc)
            if not self.scheduler.running:
                self.scheduler.start()
            loaded = await self._sync_schedules_from_db()
            print(f"Scheduler started, loaded {loaded} scheduled workflows", flush=True)
            self.logger.info("Scheduler started without leader election, loaded %s scheduled workflows", loaded)
            return

        if await self._elect_leader():
            await self._become_leader()
        else:
            self.logger.info("Scheduler running in follower mode on %s", settings.pod_id)
        self._leadership_task = asyncio.create_task(self._leadership_loop())
        self._leadership_task.add_done_callback(self._log_leadership_task_result)

    async def stop(self):
        if self._leadership_task:
            self._leadership_task.cancel()
            try:
                await self._leadership_task
            except asyncio.CancelledError:
                pass
            self._leadership_task = None
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
        if self._redis:
            if self._is_leader:
                await self._release_leadership()
            await self._redis.aclose()
            self._redis = None
        self._is_leader = False

    async def _elect_leader(self) -> bool:
        acquired = await self._redis.set(
            "platform:scheduler:leader",
            settings.pod_id,
            nx=True,
            ex=30,
        )
        self._is_leader = bool(acquired)
        return self._is_leader

    async def _become_leader(self):
        if not self.scheduler.running:
            self.scheduler.start()
        loaded = await self._sync_schedules_from_db()
        print(f"Scheduler started, loaded {loaded} scheduled workflows", flush=True)
        self.logger.info("Scheduler leader %s started, loaded %s scheduled workflows", settings.pod_id, loaded)

    async def _leadership_loop(self):
        while True:
            await asyncio.sleep(10)
            if self._is_leader:
                renewed = await self._renew_leadership()
                if not renewed:
                    self._is_leader = False
                    await self._stop_scheduler()
                    self.logger.warning("Scheduler leadership lost on %s", settings.pod_id)
                continue

            if await self._elect_leader():
                await self._become_leader()

    async def _renew_leadership(self) -> bool:
        script = """
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('expire', KEYS[1], ARGV[2])
        else
            return 0
        end
        """
        result = await self._redis.eval(script, 1, "platform:scheduler:leader", settings.pod_id, 30)
        return bool(result)

    async def _stop_scheduler(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    def _log_leadership_task_result(self, task):
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            self.logger.exception("Scheduler leadership loop crashed", exc_info=exc)

    async def _release_leadership(self):
        script = """
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        else
            return 0
        end
        """
        await self._redis.eval(script, 1, "platform:scheduler:leader", settings.pod_id)

    async def _sync_schedules_from_db(self) -> int:
        """On startup: load all scheduled workflows from DB and register them."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Workflow).where(Workflow.schedule.isnot(None)))
            workflows = result.scalars().all()
            for workflow in workflows:
                if self.scheduler.get_job(f"workflow:{workflow.id}"):
                    continue
                await self.schedule_workflow(workflow.id, workflow.schedule, user_id="system")
        return len(workflows)

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

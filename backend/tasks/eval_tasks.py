from celery_app import celery_app


@celery_app.task(
    name="tasks.eval_tasks.run_eval_suite",
    bind=True,
    max_retries=1,
    track_started=True,
    time_limit=3600,
)
def run_eval_suite_task(
    self,
    suite_id: str,
    user_id: str,
    triggered_by: str = "manual",
    git_commit: str = None,
):
    import asyncio

    from database.db import AsyncSessionLocal
    from services.eval_runner import EvalRunner

    async def _run():
        async with AsyncSessionLocal() as db:
            runner = EvalRunner()
            return await runner.run_suite(
                suite_id,
                user_id,
                triggered_by,
                git_commit,
                db,
            )

    result = asyncio.run(_run())
    return {
        "run_id": result.id,
        "suite_score": result.suite_score,
        "passed": result.passed,
    }

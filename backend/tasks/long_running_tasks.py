import asyncio
import json
import sys
import time
from pathlib import Path

import redis
from celery.exceptions import SoftTimeLimitExceeded

from celery_app import celery_app
from config import settings
from tasks.async_runtime import run_async


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent


def _ensure_import_path() -> None:
    for path in (BACKEND_DIR, PROJECT_ROOT):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


_ensure_import_path()


def _key(task_id: str) -> str:
    return f"platform:long_tasks:{task_id}"


def _client():
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def _save_checkpoint(task_id: str, **updates) -> dict:
    client = _client()
    try:
        raw = client.get(_key(task_id))
        payload = json.loads(raw) if raw else {"task_id": task_id, "intermediate_outputs": []}
        payload.update(updates)
        payload["updated_at"] = time.time()
        client.set(_key(task_id), json.dumps(payload), ex=60 * 60 * 24)
        return payload
    finally:
        client.close()


def _load_checkpoint(task_id: str) -> dict:
    client = _client()
    try:
        raw = client.get(_key(task_id))
        return json.loads(raw) if raw else {}
    finally:
        client.close()


def _broadcast(event: dict):
    from services.websocket_manager import ws_manager

    run_async(ws_manager.broadcast(event))


@celery_app.task(
    name="tasks.long_running_tasks.long_agent_task",
    bind=True,
    time_limit=14400,
    soft_time_limit=14100,
    track_started=True,
)
def long_agent_task(
    self,
    agent_id: str,
    task: str,
    user_id: str,
    org_id: str,
):
    """
    Run one agent through a checkpointed multi-step task.
    The task intentionally decomposes work into steps so progress can be saved
    and streamed while the worker continues in the background.
    """
    _ensure_import_path()

    from database.db import AsyncSessionLocal
    from database.models import Agent, AgentMemoryConfig, CustomTool
    from runtime.agent_runner import AgentRunner
    from runtime.tools import BUILTIN_TOOL_IDS

    task_id = self.request.id
    steps = [
        "Understanding the task",
        "Building an execution plan",
        "Gathering relevant context",
        "Drafting the first pass",
        "Checking assumptions",
        "Deepening the implementation",
        "Writing supporting details",
        "Reviewing quality",
        "Resolving gaps",
        "Preparing final output",
        "Final verification",
    ]
    outputs: list[str] = []
    started_at = time.time()

    async def _run_step(step_number: int, step_name: str, prior_outputs: list[str]) -> str:
        async with AsyncSessionLocal() as db:
            agent = await db.get(Agent, agent_id)
            if not agent or agent.org_id != org_id:
                raise RuntimeError("Agent not found for long-running task")
            custom_ids = [tool_id for tool_id in (agent.tools or []) if tool_id not in BUILTIN_TOOL_IDS]
            custom_tools = []
            if custom_ids:
                from sqlalchemy import select

                result = await db.execute(
                    select(CustomTool).where(
                        CustomTool.id.in_(custom_ids),
                        CustomTool.org_id == org_id,
                        CustomTool.is_active == True,  # noqa: E712
                    )
                )
                custom_tools = result.scalars().all()
            from sqlalchemy import select

            memory_config = await db.scalar(select(AgentMemoryConfig).where(AgentMemoryConfig.agent_id == agent.id))
            runner = AgentRunner(agent, custom_tool_defs=custom_tools, memory_config=memory_config)
            prompt = (
                f"You are working on a long-running task. Overall task:\n{task}\n\n"
                f"Current step {step_number}/{len(steps)}: {step_name}\n\n"
                "Prior intermediate outputs:\n"
                f"{chr(10).join(prior_outputs[-3:]) if prior_outputs else 'None yet.'}\n\n"
                "Complete only this step. Return a concise but useful checkpoint output."
            )
            response, _tokens = await runner.run(
                prompt,
                user_id=user_id,
                thread_id=f"long-task-{task_id}",
                execution_id=task_id,
            )
            return response

    try:
        _save_checkpoint(
            task_id,
            task_id=task_id,
            agent_id=agent_id,
            user_id=user_id,
            org_id=org_id,
            task=task,
            status="running",
            progress=1,
            current_step=steps[0],
            intermediate_outputs=outputs,
            started_at=started_at,
        )

        for index, step_name in enumerate(steps, start=1):
            checkpoint = _load_checkpoint(task_id)
            if checkpoint.get("status") in {"pausing", "cancelled"}:
                status = "paused" if checkpoint.get("status") == "pausing" else "cancelled"
                _save_checkpoint(task_id, status=status, current_step=f"{status.title()} at step {index}")
                _broadcast(
                    {
                        "type": "long_task_paused" if status == "paused" else "long_task_cancelled",
                        "task_id": task_id,
                        "agent_id": agent_id,
                        "progress": checkpoint.get("progress", 0),
                        "current_step": f"{status.title()} at step {index}",
                    }
                )
                return {"task_id": task_id, "status": status}

            progress = int(((index - 1) / len(steps)) * 100)
            _save_checkpoint(
                task_id,
                status="running",
                progress=progress,
                current_step=f"Step {index}/{len(steps)}: {step_name}",
                intermediate_outputs=outputs,
            )
            _broadcast(
                {
                    "type": "long_task_progress",
                    "task_id": task_id,
                    "agent_id": agent_id,
                    "task_preview": task[:160],
                    "progress": progress,
                    "current_step": f"Step {index}/{len(steps)}: {step_name}",
                    "elapsed_seconds": int(time.time() - started_at),
                    "intermediate_outputs": outputs[-3:],
                }
            )

            output = run_async(_run_step(index, step_name, outputs))
            outputs.append(f"{step_name}: {output}")
            _save_checkpoint(
                task_id,
                status="running",
                progress=int((index / len(steps)) * 100),
                current_step=f"Completed step {index}/{len(steps)}: {step_name}",
                intermediate_outputs=outputs,
            )

        _save_checkpoint(
            task_id,
            status="completed",
            progress=100,
            current_step="Completed",
            intermediate_outputs=outputs,
            elapsed_seconds=int(time.time() - started_at),
        )
        _broadcast(
            {
                "type": "long_task_completed",
                "task_id": task_id,
                "agent_id": agent_id,
                "task_preview": task[:160],
                "progress": 100,
                "current_step": "Completed",
                "elapsed_seconds": int(time.time() - started_at),
                "intermediate_outputs": outputs[-5:],
            }
        )
        return {"task_id": task_id, "status": "completed"}
    except SoftTimeLimitExceeded:
        _save_checkpoint(
            task_id,
            status="paused",
            current_step="Paused at soft time limit",
            intermediate_outputs=outputs,
            elapsed_seconds=int(time.time() - started_at),
        )
        _broadcast(
            {
                "type": "long_task_paused",
                "task_id": task_id,
                "agent_id": agent_id,
                "progress": _load_checkpoint(task_id).get("progress", 0),
                "current_step": "Paused at soft time limit",
                "intermediate_outputs": outputs[-5:],
            }
        )
        return {"task_id": task_id, "status": "paused"}
    except Exception as exc:
        _save_checkpoint(
            task_id,
            status="failed",
            current_step=f"Failed: {exc}",
            intermediate_outputs=outputs,
            error=str(exc),
            elapsed_seconds=int(time.time() - started_at),
        )
        _broadcast(
            {
                "type": "long_task_failed",
                "task_id": task_id,
                "agent_id": agent_id,
                "progress": _load_checkpoint(task_id).get("progress", 0),
                "current_step": f"Failed: {exc}",
                "error": str(exc),
            }
        )
        raise

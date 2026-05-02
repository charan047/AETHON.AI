import json
import time

import redis.asyncio as redis

from celery_app import celery_app
from config import settings
from services.websocket_manager import ws_manager
from tasks.long_running_tasks import long_agent_task


class LongRunningAgentService:
    def __init__(self):
        self.redis_url = settings.redis_url

    def _key(self, task_id: str) -> str:
        return f"platform:long_tasks:{task_id}"

    async def _redis(self):
        return redis.from_url(self.redis_url, decode_responses=True)

    async def start_long_task(
        self,
        agent_id: str,
        task: str,
        user_id: str,
        org_id: str,
        max_duration_hours: int = 4,
    ) -> str:
        celery_task = long_agent_task.apply_async(
            args=[agent_id, task, user_id, org_id],
            time_limit=max_duration_hours * 3600,
            soft_time_limit=max(60, max_duration_hours * 3600 - 300),
        )
        task_id = celery_task.id
        payload = {
            "task_id": task_id,
            "agent_id": agent_id,
            "user_id": user_id,
            "org_id": org_id,
            "task": task,
            "status": "queued",
            "progress": 0,
            "current_step": "Queued",
            "intermediate_outputs": [],
            "started_at": time.time(),
            "updated_at": time.time(),
            "max_duration_hours": max_duration_hours,
        }
        client = await self._redis()
        try:
            await client.set(self._key(task_id), json.dumps(payload), ex=max_duration_hours * 3600 + 86400)
        finally:
            await client.aclose()

        await ws_manager.broadcast(
            {
                "type": "long_task_started",
                "task_id": task_id,
                "agent_id": agent_id,
                "task_preview": task[:160],
                "progress": 0,
                "current_step": "Queued",
            }
        )
        return task_id

    async def get_task_status(self, task_id: str) -> dict:
        client = await self._redis()
        try:
            raw = await client.get(self._key(task_id))
        finally:
            await client.aclose()
        if not raw:
            async_result = celery_app.AsyncResult(task_id)
            return {
                "task_id": task_id,
                "status": async_result.status.lower(),
                "progress": 0,
                "current_step": "No checkpoint available",
                "intermediate_outputs": [],
                "elapsed_seconds": 0,
            }
        payload = json.loads(raw)
        payload["elapsed_seconds"] = int(time.time() - float(payload.get("started_at") or time.time()))
        return payload

    async def cancel_task(self, task_id: str) -> bool:
        celery_app.control.revoke(task_id, terminate=True)
        client = await self._redis()
        try:
            raw = await client.get(self._key(task_id))
            payload = json.loads(raw) if raw else {"task_id": task_id, "intermediate_outputs": []}
            payload.update(
                {
                    "status": "cancelled",
                    "progress": payload.get("progress", 0),
                    "current_step": "Cancelled by user",
                    "updated_at": time.time(),
                    "elapsed_seconds": int(time.time() - float(payload.get("started_at") or time.time())),
                }
            )
            await client.set(self._key(task_id), json.dumps(payload), ex=86400)
        finally:
            await client.aclose()

        await ws_manager.broadcast(
            {
                "type": "long_task_cancelled",
                "task_id": task_id,
                "progress": payload.get("progress", 0),
                "current_step": "Cancelled by user",
            }
        )
        return True

    async def pause_task(self, task_id: str) -> bool:
        client = await self._redis()
        try:
            raw = await client.get(self._key(task_id))
            payload = json.loads(raw) if raw else {"task_id": task_id, "intermediate_outputs": []}
            payload.update(
                {
                    "status": "pausing",
                    "current_step": "Pause requested",
                    "updated_at": time.time(),
                }
            )
            await client.set(self._key(task_id), json.dumps(payload), ex=86400)
        finally:
            await client.aclose()

        await ws_manager.broadcast(
            {
                "type": "long_task_paused",
                "task_id": task_id,
                "agent_id": payload.get("agent_id"),
                "progress": payload.get("progress", 0),
                "current_step": "Pause requested",
            }
        )
        return True

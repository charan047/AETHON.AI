import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import WebSocket

from config import settings


REDIS_CHANNEL = "ws:events"

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.log_buffer: deque = deque(maxlen=500)
        self._redis = None
        self._pubsub_task = None

    async def startup(self):
        try:
            self._redis = redis.from_url(settings.redis_url, decode_responses=True)
            await self._redis.ping()
            self._pubsub_task = asyncio.create_task(self._redis_listener())
        except Exception as exc:
            logger.warning("Redis unavailable for WebSocket pub/sub, using local broadcast: %s", exc)
            if self._redis:
                await self._redis.aclose()
            self._redis = None
            self._pubsub_task = None

    async def shutdown(self):
        if self._pubsub_task:
            self._pubsub_task.cancel()
            try:
                await self._pubsub_task
            except asyncio.CancelledError:
                pass
            self._pubsub_task = None

        if self._redis:
            await self._redis.aclose()
            self._redis = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        for log in self.log_buffer:
            try:
                await websocket.send_json(log)
            except Exception:
                pass
        await self.broadcast(
            {
                "type": "ws_connected",
                "connection_count": len(self.active_connections),
            }
        )

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            try:
                asyncio.create_task(
                    self.broadcast(
                        {
                            "type": "ws_disconnected",
                            "connection_count": len(self.active_connections),
                        }
                    )
                )
            except RuntimeError:
                pass

    async def broadcast(self, message: dict):
        event = {**message, "timestamp": datetime.now(timezone.utc).isoformat()}

        if self._redis:
            try:
                await self._redis.publish(REDIS_CHANNEL, json.dumps(event))
                return
            except Exception as exc:
                logger.warning("Redis publish failed, falling back to local broadcast: %s", exc)

        self.log_buffer.append(event)
        await self._local_broadcast(event)

    async def _redis_listener(self):
        while True:
            pubsub = None
            try:
                pubsub = self._redis.pubsub()
                await pubsub.subscribe(REDIS_CHANNEL)

                async for msg in pubsub.listen():
                    if msg["type"] != "message":
                        continue

                    event = json.loads(msg["data"])
                    self.log_buffer.append(event)
                    await self._local_broadcast(event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Redis listener error, retrying: %s", exc)
                await asyncio.sleep(2)
            finally:
                if pubsub:
                    try:
                        await pubsub.aclose()
                    except Exception:
                        pass

    async def _local_broadcast(self, message: dict):
        dead = []
        payload = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead.append(connection)

        for connection in dead:
            self.disconnect(connection)

    async def send_personal(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)


ws_manager = ConnectionManager()

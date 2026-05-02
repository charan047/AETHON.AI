import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import WebSocket

from config import settings


REDIS_CHANNEL = "ws:events"
REDIS_LOG_KEY = "platform:ws:events"
REDIS_CONNECTION_PREFIX = "platform:ws:connections:"
MAX_LOG_EVENTS = 500

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.channel_subscriptions: dict[str, set[WebSocket]] = {}
        self.connection_orgs: dict[WebSocket, str | None] = {}
        self.log_buffer: deque = deque(maxlen=500)
        self._redis = None
        self._pubsub_task = None

    async def startup(self):
        try:
            await self._ensure_redis_client()
            await self._sync_connection_count()
            self._pubsub_task = asyncio.create_task(self._redis_listener())
        except Exception as exc:
            logger.warning("Redis unavailable for WebSocket pub/sub, using local broadcast: %s", exc)
            if self._redis:
                await self._redis.aclose()
            self._redis = None
            self._pubsub_task = None

    async def _ensure_redis_client(self):
        if self._redis is not None:
            return self._redis
        client = redis.from_url(settings.redis_url, decode_responses=True)
        await client.ping()
        self._redis = client
        return client

    async def shutdown(self):
        if self._pubsub_task:
            self._pubsub_task.cancel()
            try:
                await self._pubsub_task
            except asyncio.CancelledError:
                pass
            self._pubsub_task = None

        if self._redis:
            await self._redis.delete(self._connection_key())
            await self._redis.aclose()
            self._redis = None

    async def connect(
        self,
        websocket: WebSocket,
        *,
        org_id: str | None = None,
        initial_logs: list[dict] | None = None,
    ):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_orgs[websocket] = org_id
        await self._sync_connection_count()
        logs = initial_logs if initial_logs is not None else await self.get_recent_logs()
        for log in logs:
            try:
                await websocket.send_json(log)
            except Exception:
                pass
        if org_id:
            await self.broadcast(
                {
                    "type": "ws_connected",
                    "org_id": org_id,
                    "connection_count": self._org_connection_count_local(org_id),
                }
            )

    async def disconnect(self, websocket: WebSocket):
        self._remove_from_all_channels(websocket)
        org_id = self.connection_orgs.pop(websocket, None)
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            await self._sync_connection_count()
            if org_id:
                try:
                    await self.broadcast(
                        {
                            "type": "ws_disconnected",
                            "org_id": org_id,
                            "connection_count": self._org_connection_count_local(org_id),
                        }
                    )
                except RuntimeError:
                    pass

    async def broadcast(self, message: dict):
        event = {**message, "timestamp": datetime.now(timezone.utc).isoformat()}

        if self._redis is None:
            try:
                await self._ensure_redis_client()
            except Exception:
                pass

        if self._redis:
            try:
                await self._append_log(event)
                await self._redis.publish(REDIS_CHANNEL, json.dumps(event))
                return
            except Exception as exc:
                logger.warning("Redis publish failed, falling back to local broadcast: %s", exc)

        self.log_buffer.append(event)
        await self._local_broadcast(event)

    async def broadcast_to_channel(self, channel: str, message: dict) -> None:
        event = {**message, "timestamp": message.get("timestamp") or datetime.now(timezone.utc).isoformat()}

        if self._redis is None:
            try:
                await self._ensure_redis_client()
            except Exception:
                pass

        if self._redis:
            try:
                await self._redis.publish(
                    REDIS_CHANNEL,
                    json.dumps(
                        {
                            "__channel__": channel,
                            "message": event,
                        }
                    ),
                )
                return
            except Exception as exc:
                logger.warning("Redis channel publish failed, falling back to local broadcast: %s", exc)

        await self._channel_broadcast(channel, event)

    async def subscribe_to_channel(self, websocket: WebSocket, channel: str) -> None:
        self.channel_subscriptions.setdefault(channel, set()).add(websocket)

    async def unsubscribe_from_channel(self, websocket: WebSocket, channel: str) -> None:
        subscribers = self.channel_subscriptions.get(channel)
        if not subscribers:
            return
        subscribers.discard(websocket)
        if not subscribers:
            self.channel_subscriptions.pop(channel, None)

    async def _redis_listener(self):
        while True:
            pubsub = None
            try:
                pubsub = self._redis.pubsub()
                await pubsub.subscribe(REDIS_CHANNEL)

                async for msg in pubsub.listen():
                    if msg["type"] != "message":
                        continue

                    payload = json.loads(msg["data"])
                    if "__channel__" in payload:
                        channel = payload.get("__channel__")
                        event = payload.get("message") or {}
                        if channel:
                            await self._channel_broadcast(channel, event)
                        continue

                    event = payload
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
            if not self._should_deliver(connection, message):
                continue
            try:
                await connection.send_text(payload)
            except Exception:
                dead.append(connection)

        for connection in dead:
            await self.disconnect(connection)

    async def _channel_broadcast(self, channel: str, message: dict):
        subscribers = self.channel_subscriptions.get(channel, set())
        if not subscribers:
            return

        dead_connections: set[WebSocket] = set()
        payload = json.dumps(message)
        for websocket in list(subscribers):
            try:
                await websocket.send_text(payload)
            except Exception:
                dead_connections.add(websocket)

        for websocket in dead_connections:
            subscribers.discard(websocket)
            await self.disconnect(websocket)

        if channel in self.channel_subscriptions and not self.channel_subscriptions[channel]:
            self.channel_subscriptions.pop(channel, None)

    async def send_personal(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            await self.disconnect(websocket)

    def _should_deliver(self, websocket: WebSocket, message: dict) -> bool:
        org_id = self.connection_orgs.get(websocket)
        if not org_id:
            return True
        event_org_id = message.get("org_id")
        return event_org_id == org_id

    def _remove_from_all_channels(self, websocket: WebSocket):
        empty_channels = []
        for channel, subscribers in self.channel_subscriptions.items():
            subscribers.discard(websocket)
            if not subscribers:
                empty_channels.append(channel)
        for channel in empty_channels:
            self.channel_subscriptions.pop(channel, None)

    def _connection_key(self) -> str:
        return f"{REDIS_CONNECTION_PREFIX}{settings.pod_id}"

    def _org_connection_count_local(self, org_id: str) -> int:
        return sum(1 for connection_org_id in self.connection_orgs.values() if connection_org_id == org_id)

    async def _sync_connection_count(self):
        if not self._redis:
            return
        await self._redis.setex(self._connection_key(), 30, str(len(self.active_connections)))

    async def _append_log(self, event: dict):
        if not self._redis:
            return
        payload = json.dumps(event)
        pipeline = self._redis.pipeline()
        pipeline.rpush(REDIS_LOG_KEY, payload)
        pipeline.ltrim(REDIS_LOG_KEY, -MAX_LOG_EVENTS, -1)
        await pipeline.execute()

    async def get_recent_logs(self, limit: int = MAX_LOG_EVENTS) -> list[dict]:
        if self._redis is None:
            try:
                await self._ensure_redis_client()
            except Exception:
                return list(self.log_buffer)[-limit:]
        if not self._redis:
            return list(self.log_buffer)[-limit:]
        raw_events = await self._redis.lrange(REDIS_LOG_KEY, -limit, -1)
        logs = []
        for raw_event in raw_events:
            try:
                logs.append(json.loads(raw_event))
            except (TypeError, json.JSONDecodeError):
                continue
        return logs

    async def get_recent_logs_for_org(self, org_id: str, limit: int = MAX_LOG_EVENTS) -> list[dict]:
        logs = await self.get_recent_logs(limit)
        return [event for event in logs if event.get("org_id") == org_id]

    async def get_connection_count(self) -> int:
        if self._redis is None:
            try:
                await self._ensure_redis_client()
            except Exception:
                return len(self.active_connections)
        if not self._redis:
            return len(self.active_connections)
        total = 0
        async for key in self._redis.scan_iter(match=f"{REDIS_CONNECTION_PREFIX}*"):
            value = await self._redis.get(key)
            if value is None:
                continue
            try:
                total += int(value)
            except (TypeError, ValueError):
                continue
        return total


ws_manager = ConnectionManager()

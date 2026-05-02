import json


class SessionStore:
    """
    Redis-backed session storage.
    Works across any number of backend processes.
    """

    def __init__(self, redis_client):
        self.redis = redis_client
        self.prefix = "platform:session:"
        self.default_ttl = 3600

    async def set(self, session_id: str, data: dict | list, ttl: int = None):
        key = f"{self.prefix}{session_id}"
        await self.redis.setex(
            key,
            ttl or self.default_ttl,
            json.dumps(data),
        )

    async def get(self, session_id: str) -> dict | list | None:
        key = f"{self.prefix}{session_id}"
        value = await self.redis.get(key)
        return json.loads(value) if value else None

    async def delete(self, session_id: str):
        await self.redis.delete(f"{self.prefix}{session_id}")

    async def extend(self, session_id: str, ttl: int = None):
        await self.redis.expire(
            f"{self.prefix}{session_id}",
            ttl or self.default_ttl,
        )

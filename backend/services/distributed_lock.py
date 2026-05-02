import asyncio
import secrets


class DistributedLock:
    """
    Redis-based distributed lock using SET NX EX.
    Prevents race conditions across multiple backend processes.
    """

    def __init__(self, redis_client, key: str, ttl: int = 30, retry_count: int = 3):
        self.redis = redis_client
        self.key = f"platform:lock:{key}"
        self.ttl = ttl
        self.retry_count = retry_count
        self.lock_value = secrets.token_hex(16)

    async def __aenter__(self):
        for attempt in range(self.retry_count):
            acquired = await self.redis.set(
                self.key,
                self.lock_value,
                nx=True,
                ex=self.ttl,
            )
            if acquired:
                return self
            if attempt < self.retry_count - 1:
                await asyncio.sleep(0.1 * (2 ** attempt))
        raise RuntimeError(f"Could not acquire lock: {self.key}")

    async def __aexit__(self, *args):
        script = """
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        else
            return 0
        end
        """
        await self.redis.eval(script, 1, self.key, self.lock_value)

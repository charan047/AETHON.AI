import time

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import settings


def get_user_id_or_ip(request: Request) -> str:
    if settings.enable_testing_api and request.url.path.startswith("/api/auth/"):
        return f"test-auth:{get_remote_address(request)}:{time.time_ns()}"
    if hasattr(request.state, "user") and request.state.user:
        return f"user:{request.state.user.id}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=get_user_id_or_ip,
    storage_uri=settings.redis_url,
    default_limits=["200/minute"],
    headers_enabled=True,
    in_memory_fallback_enabled=True,
)

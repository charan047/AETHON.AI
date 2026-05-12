from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class PlanLimitMiddleware(BaseHTTPMiddleware):
    """Open-source: all features available, no limits enforced."""
    async def dispatch(self, request: Request, call_next):
        return await call_next(request)

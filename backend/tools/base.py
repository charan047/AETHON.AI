from abc import ABC, abstractmethod
from enum import Enum
from pydantic import BaseModel
from typing import Any
import time
import logging


class ToolCategory(str, Enum):
    code_execution = "code_execution"
    communication = "communication"
    version_control = "version_control"
    web = "web"
    data = "data"
    finance = "finance"
    productivity = "productivity"
    ai = "ai"
    custom = "custom"


class ToolHealth(str, Enum):
    healthy = "healthy"
    degraded = "degraded"
    unhealthy = "unhealthy"
    unchecked = "unchecked"


class ToolCallResult(BaseModel):
    success: bool
    result: Any = None
    error: str | None = None
    duration_ms: int = 0
    tokens_used: int = 0
    cached: bool = False
    tool_name: str = ""
    function_name: str = ""


class BaseTool(ABC):
    """
    Every tool in the platform inherits from this.
    Provides: automatic timing, error handling, usage tracking,
    rate limit awareness, health checks, and consistent interface.
    """

    name: str = ""
    description: str = ""
    category: ToolCategory = ToolCategory.custom
    requires_auth: bool = False
    rate_limit_per_minute: int = 60
    supports_health_check: bool = True

    def __init__(self, user_id: str, config: dict | None = None):
        self.user_id = user_id
        self.config = config or {}
        self._call_times: list[float] = []
        self.logger = logging.getLogger(f"tool.{self.name}")

    @abstractmethod
    async def get_langchain_tools(self) -> list:
        """Return list of @tool decorated functions for LangGraph."""
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> tuple[ToolHealth, str]:
        """Return (health_status, message). Called every 5 minutes."""
        raise NotImplementedError

    async def execute_with_tracking(
        self,
        function_name: str,
        function: callable,
        *args,
        **kwargs,
    ) -> ToolCallResult:
        """
        Wrapper that adds timing, error handling, rate limiting.
        All tool functions should call this instead of running directly.
        """
        now = time.time()
        self._call_times = [t for t in self._call_times if now - t < 60]
        if len(self._call_times) >= self.rate_limit_per_minute:
            return ToolCallResult(
                success=False,
                error=f"Rate limit exceeded: {self.rate_limit_per_minute} calls/minute",
                tool_name=self.name,
                function_name=function_name,
            )
        self._call_times.append(now)

        start = time.time()
        try:
            result = await function(*args, **kwargs)
            duration = int((time.time() - start) * 1000)

            await self._emit_usage_event(
                function_name=function_name,
                duration_ms=duration,
                success=True,
            )

            return ToolCallResult(
                success=True,
                result=result,
                duration_ms=duration,
                tool_name=self.name,
                function_name=function_name,
            )
        except Exception as exc:
            duration = int((time.time() - start) * 1000)
            self.logger.error("Tool call failed: %s.%s: %s", self.name, function_name, exc)

            await self._emit_usage_event(
                function_name=function_name,
                duration_ms=duration,
                success=False,
                error=str(exc),
            )

            return ToolCallResult(
                success=False,
                error=str(exc),
                duration_ms=duration,
                tool_name=self.name,
                function_name=function_name,
            )

    async def _emit_usage_event(
        self,
        function_name: str,
        duration_ms: int,
        success: bool,
        error: str | None = None,
    ):
        """Emit to ws_manager for real-time monitoring."""
        from services.websocket_manager import ws_manager
        from services.telemetry_service import telemetry_service

        context = self.config.get("_context", {})
        telemetry_service.record_tool_call(
            tool_name=self.name,
            function_name=function_name,
            status="success" if success else "error",
            duration_seconds=duration_ms / 1000,
        )
        await ws_manager.broadcast(
            {
                "type": "tool_call",
                "tool": self.name,
                "function": function_name,
                "user_id": self.user_id,
                "agent_id": context.get("agent_id"),
                "agent_name": context.get("agent_name") or "Unknown agent",
                "execution_id": context.get("execution_id"),
                "duration_ms": duration_ms,
                "success": success,
                "error": error,
            }
        )

        if self.user_id == "system":
            return

        try:
            from uuid import uuid4

            from database.db import AsyncSessionLocal
            from database.models import ToolCallLog

            async with AsyncSessionLocal() as db:
                db.add(
                    ToolCallLog(
                        id=str(uuid4()),
                        user_id=self.user_id,
                        agent_id=context.get("agent_id"),
                        execution_id=context.get("execution_id"),
                        tool_name=self.name,
                        function_name=function_name,
                        duration_ms=duration_ms,
                        success=success,
                        error_message=error,
                    )
                )
                await db.commit()
        except Exception as exc:
            self.logger.warning("Failed to persist tool call log: %s", exc)

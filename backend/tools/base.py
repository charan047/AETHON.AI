from __future__ import annotations

from abc import ABC
from enum import Enum
import json
import logging
import time
from typing import Any, Optional

from pydantic import BaseModel, Field, create_model


logger = logging.getLogger(__name__)


class ToolInput(BaseModel):
    """Base input model for all tools."""

    pass


class ToolOutput(BaseModel):
    success: bool
    result: Any = None
    error: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class ToolCategory(str, Enum):
    research = "research"
    communication = "communication"
    file = "file"
    code = "code"
    code_execution = "code_execution"
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


class ToolCallResult(ToolOutput):
    duration_ms: int = 0
    tokens_used: int = 0
    cached: bool = False
    tool_name: str = ""
    function_name: str = ""


def _schema_type_to_python(field_schema: dict | None) -> type:
    schema_type = (field_schema or {}).get("type", "string")
    if schema_type == "string":
        return str
    if schema_type == "integer":
        return int
    if schema_type == "number":
        return float
    if schema_type == "boolean":
        return bool
    if schema_type == "array":
        return list
    if schema_type == "object":
        return dict
    return str


def _model_from_json_schema(tool_name: str, schema: dict) -> type[BaseModel]:
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    fields: dict[str, tuple[type, Any]] = {}

    for field_name, field_schema in properties.items():
        python_type = _schema_type_to_python(field_schema)
        description = field_schema.get("description")
        default_value = ... if field_name in required else field_schema.get("default", None)
        fields[field_name] = (
            python_type,
            Field(default=default_value, description=description),
        )

    model_name = "".join(part.capitalize() for part in tool_name.split("_")) + "Input"
    return create_model(model_name, **fields) if fields else ToolInput


class BaseTool(ABC):
    """
    Shared base for both the existing LangChain-oriented tools and the Phase 8
    registry tools that expose explicit execute/schema contracts.
    """

    name: str = ""
    display_name: str = ""
    description: str = ""
    category: str | ToolCategory = ToolCategory.custom
    requires_auth: bool = False
    auth_type: Optional[str] = None
    rate_limit_per_minute: int = 60
    supports_health_check: bool = True

    def __init__(self, user_id: str = "system", config: dict | None = None):
        self.user_id = user_id
        self.config = config or {}
        self._call_times: list[float] = []
        self.logger = logging.getLogger(f"tool.{self.name or self.__class__.__name__}")
        if not self.display_name:
            self.display_name = self.name.replace("_", " ").title() if self.name else self.__class__.__name__

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        """Execute the tool and return structured output."""
        raise NotImplementedError(f"{self.__class__.__name__} must implement execute()")

    def get_schema(self) -> dict:
        """Return JSON schema for LLM function calling."""
        return {"type": "object", "properties": {}, "required": []}

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        """Check if required auth is available."""
        return True

    def to_openai_function(self) -> dict:
        """Convert tool to OpenAI function calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.get_schema(),
            },
        }

    async def get_langchain_tools(self) -> list:
        """
        Default LangChain bridge for Phase 8 tools.
        Existing richer tool implementations can still override this.
        """
        from langchain_core.tools import StructuredTool

        executor = self
        args_schema = _model_from_json_schema(self.name or self.__class__.__name__, self.get_schema())

        async def run_tool(**kwargs):
            context = executor.config.get("_context", {})
            org_id = context.get("org_id") or ""
            active_user_id = context.get("user_id") or executor.user_id

            if executor.requires_auth and not await executor.validate_auth(org_id, active_user_id):
                return f"{executor.display_name} requires authentication before it can run."

            async def invoke():
                outcome = await executor.execute(kwargs, org_id, active_user_id)
                if isinstance(outcome, ToolOutput):
                    if outcome.success:
                        return outcome.result
                    raise RuntimeError(outcome.error or f"{executor.display_name} failed")
                return outcome

            result = await executor.execute_with_tracking("execute", invoke)
            return result.result if result.success else f"{executor.display_name} failed: {result.error}"

        run_tool.__name__ = self.name or self.__class__.__name__
        run_tool.__doc__ = self.description
        return [
            StructuredTool.from_function(
                coroutine=run_tool,
                name=self.name,
                description=self.description,
                args_schema=args_schema,
            )
        ]

    async def health_check(self) -> tuple[ToolHealth, str]:
        return ToolHealth.unchecked, "No health check implemented"

    async def execute_with_tracking(
        self,
        function_name: str,
        function: callable,
        *args,
        **kwargs,
    ) -> ToolCallResult:
        """
        Wrapper that adds timing, error handling, rate limiting.
        Existing tool functions call this instead of running directly.
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
        input_preview = None
        if args or kwargs:
            input_preview = json.dumps({"args": args, "kwargs": kwargs}, default=str)[:500]

        try:
            result = await function(*args, **kwargs)
            duration = int((time.time() - start) * 1000)
            output_preview = str(result)[:500] if result is not None else None

            await self._emit_usage_event(
                function_name=function_name,
                duration_ms=duration,
                success=True,
                input_preview=input_preview,
                output_preview=output_preview,
            )

            if isinstance(result, ToolOutput):
                return ToolCallResult(
                    success=result.success,
                    result=result.result,
                    error=result.error,
                    metadata=result.metadata,
                    duration_ms=duration,
                    tool_name=self.name,
                    function_name=function_name,
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
                input_preview=input_preview,
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
        input_preview: str | None = None,
        output_preview: str | None = None,
    ):
        """Emit tool usage for monitoring and persistence when those services are available."""
        try:
            from services.websocket_manager import ws_manager
            from services.telemetry_service import telemetry_service
            from utils.secret_scanner import redact_secrets
        except Exception:
            return

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
                "org_id": context.get("org_id"),
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
                        org_id=context.get("org_id"),
                        agent_id=context.get("agent_id"),
                        execution_id=context.get("execution_id"),
                        tool_name=self.name,
                        function_name=function_name,
                        duration_ms=duration_ms,
                        success=success,
                        error_message=error,
                        input_preview=redact_secrets(input_preview),
                        output_preview=redact_secrets(output_preview),
                    )
                )
                await db.commit()
        except Exception as exc:
            self.logger.warning("Failed to persist tool call log: %s", exc)

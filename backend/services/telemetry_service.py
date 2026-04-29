import logging
import time
from collections import deque

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import Counter, Gauge, Histogram, generate_latest

from config import settings


WORKFLOW_RUNS = Counter(
    "platform_workflow_runs_total",
    "Total workflow runs",
    ["workflow_id", "status", "user_id"],
)
WORKFLOW_DURATION = Histogram(
    "platform_workflow_duration_seconds",
    "Workflow execution duration",
    ["workflow_id"],
    buckets=[1, 5, 10, 30, 60, 120, 300, 600],
)
AGENT_CALLS = Counter(
    "platform_agent_calls_total",
    "Total agent LLM calls",
    ["agent_id", "model", "status"],
)
LLM_TOKENS = Counter(
    "platform_llm_tokens_total",
    "Total LLM tokens used",
    ["agent_id", "model", "token_type"],
)
TOOL_CALLS = Counter(
    "platform_tool_calls_total",
    "Total tool calls",
    ["tool_name", "function_name", "status"],
)
TOOL_DURATION = Histogram(
    "platform_tool_duration_seconds",
    "Tool call duration",
    ["tool_name"],
    buckets=[0.1, 0.5, 1, 2, 5, 10, 30],
)
ACTIVE_EXECUTIONS = Gauge(
    "platform_active_executions",
    "Currently running workflow executions",
)
HITL_PENDING = Gauge(
    "platform_hitl_pending_approvals",
    "Pending human approval requests",
)
API_REQUESTS = Counter(
    "platform_api_requests_total",
    "Total FastAPI HTTP requests",
    ["method", "path", "status"],
)
API_DURATION = Histogram(
    "platform_api_request_duration_seconds",
    "FastAPI HTTP request duration",
    ["method", "path"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
)
API_CALLS_LAST_MINUTE = Gauge(
    "platform_api_calls_last_minute",
    "FastAPI HTTP requests observed in the last rolling minute",
)


class TelemetryService:
    def __init__(self):
        self.logger = logging.getLogger("telemetry")
        self._api_request_times = deque()
        self.tracer = self._setup_tracing()

    def _setup_tracing(self):
        try:
            provider = TracerProvider()
            if settings.otlp_endpoint:
                exporter = OTLPSpanExporter(endpoint=settings.otlp_endpoint)
                provider.add_span_processor(BatchSpanProcessor(exporter))
            trace.set_tracer_provider(provider)
        except Exception as exc:
            self.logger.debug("Tracer provider already configured or unavailable: %s", exc)
        return trace.get_tracer("platform")

    def record_workflow_run(
        self,
        workflow_id: str,
        user_id: str,
        status: str,
        duration_seconds: float,
    ):
        WORKFLOW_RUNS.labels(workflow_id=workflow_id, status=status, user_id=user_id or "unknown").inc()
        WORKFLOW_DURATION.labels(workflow_id=workflow_id).observe(duration_seconds)

    def record_agent_call(
        self,
        agent_id: str,
        model: str,
        status: str,
        input_tokens: int,
        output_tokens: int,
    ):
        AGENT_CALLS.labels(agent_id=agent_id, model=model, status=status).inc()
        LLM_TOKENS.labels(agent_id=agent_id, model=model, token_type="input").inc(input_tokens or 0)
        LLM_TOKENS.labels(agent_id=agent_id, model=model, token_type="output").inc(output_tokens or 0)

    def record_tool_call(
        self,
        tool_name: str,
        function_name: str,
        status: str,
        duration_seconds: float,
    ):
        TOOL_CALLS.labels(
            tool_name=tool_name,
            function_name=function_name,
            status=status,
        ).inc()
        TOOL_DURATION.labels(tool_name=tool_name).observe(duration_seconds)

    def set_active_executions(self, count: int):
        ACTIVE_EXECUTIONS.set(count)

    def set_hitl_pending(self, count: int):
        HITL_PENDING.set(count)

    def record_api_request(self, method: str, path: str, status: int, duration_seconds: float):
        normalized_path = path or "unknown"
        API_REQUESTS.labels(method=method, path=normalized_path, status=str(status)).inc()
        API_DURATION.labels(method=method, path=normalized_path).observe(duration_seconds)
        now = time.time()
        self._api_request_times.append(now)
        self._prune_api_request_times(now)
        API_CALLS_LAST_MINUTE.set(len(self._api_request_times))

    def get_api_calls_last_minute(self) -> int:
        now = time.time()
        self._prune_api_request_times(now)
        API_CALLS_LAST_MINUTE.set(len(self._api_request_times))
        return len(self._api_request_times)

    def _prune_api_request_times(self, now: float):
        while self._api_request_times and now - self._api_request_times[0] > 60:
            self._api_request_times.popleft()

    def start_span(self, name: str, attributes: dict | None = None):
        return self.tracer.start_as_current_span(name, attributes=attributes or {})


telemetry_service = TelemetryService()

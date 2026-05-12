from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from contextlib import asynccontextmanager
from datetime import datetime
import logging

import asyncio
import os
import subprocess
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings(
    "ignore",
    message="Mixing V1 models and V2 models.*",
    category=UserWarning,
)

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from config import settings, AVAILABLE_MODELS
from database import init_db
from api import api_router
from api.tools_registry import router as public_tools_registry_router
from api.triggers import public_router as public_webhook_router
from channels.telegram import TelegramChannel
from middleware.plan_limits import PlanLimitMiddleware
from middleware.rate_limit import limiter
from middleware.request_id import RequestIDMiddleware
from middleware.security import SecurityHeadersMiddleware
from marketplace.seed import seed_marketplace_templates
from database.seed_roles import seed_system_roles
from services.hitl_service import HITLService
from services.memory_service import MemoryService
from services.scheduler_service import SchedulerService
from services.telemetry_service import generate_latest, telemetry_service
from services.websocket_manager import ws_manager
from runtime.agent_runner import AgentRunner
from tools.registry import tool_registry
from database.db import AsyncSessionLocal
from database.models import Agent, Execution, ExecutionStatus
from sqlalchemy import select, update

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

telegram_bot = TelegramChannel()


def run_migrations():
    # Uvicorn runs the FastAPI lifespan inside an event loop.
    # Alembic's command API is sync, so we run it in a thread.
    alembic_cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(alembic_cfg, "head")


async def telegram_runner_factory(message: str, user_id: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Agent).where(Agent.telegram_enabled == True, Agent.is_active == True))
        agents = result.scalars().all()
        if not agents:
            return None, None

        agent = agents[0]
        if len(agents) > 1:
            try:
                from langchain_core.messages import HumanMessage, SystemMessage
                from runtime.agent_runner import _extract_text, build_llm

                agent_context = "\n".join(
                    f"- {candidate.name}: {candidate.role} — {candidate.description or 'No description'}"
                    for candidate in agents
                )
                llm = build_llm(settings.default_model, temperature=0.1, max_tokens=80)
                response = await llm.ainvoke(
                    [
                        SystemMessage(
                            content=(
                                "Choose the best Telegram-enabled agent for the user's message. "
                                "Return only the exact agent name from the list."
                            )
                        ),
                        HumanMessage(content=f"Message: {message}\n\nAvailable agents:\n{agent_context}"),
                    ]
                )
                chosen_name = _extract_text(response.content).strip().lower()
                agent = next((candidate for candidate in agents if candidate.name.lower() in chosen_name), agents[0])
            except Exception:
                logger.exception("Telegram orchestrator routing failed; falling back to first enabled agent")

        from uuid import uuid4
        execution_id = str(uuid4())
        runner = AgentRunner(agent)
        return runner, execution_id


KNOWN_MODEL_IDS = {m["id"] for m in AVAILABLE_MODELS}


async def migrate_agent_models():
    """Migrate any agent using an unknown/old model (Gemini, Claude, etc.) to the platform default."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Agent))
        agents = result.scalars().all()
        fixed = 0
        for agent in agents:
            if agent.model not in KNOWN_MODEL_IDS:
                logger.info(f"Migrating agent '{agent.name}': {agent.model!r} → {settings.default_model!r}")
                agent.model = settings.default_model
                fixed += 1
        if fixed:
            await db.commit()
            logger.info(f"Migrated {fixed} agent(s) to '{settings.default_model}'")


async def approval_expiration_loop(hitl_service: HITLService):
    while True:
        try:
            await hitl_service.check_expired_approvals()
        except Exception:
            logger.exception("Failed to check expired approval requests")
        await asyncio.sleep(300)


async def tool_health_check_loop():
    print("Tool health checks starting", flush=True)
    logger.info("Tool health checks starting")
    await tool_registry.run_health_checks()
    while True:
        await asyncio.sleep(300)
        await tool_registry.run_health_checks()


async def ensure_playwright_chromium():
    if os.getenv("PLAYWRIGHT_INSTALL_ON_STARTUP", "").lower() not in {"1", "true", "yes"}:
        logger.info("Skipping Playwright Chromium install on startup.")
        return
    try:
        cache_dir = Path.home() / "Library" / "Caches" / "ms-playwright"
        if cache_dir.exists() and any(path.name.startswith("chromium-") for path in cache_dir.iterdir()):
            logger.info("Playwright Chromium cache detected, skipping browser install.")
            return
        result = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, "-m", "playwright", "install", "chromium"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            logger.info("Playwright Chromium browser is installed.")
        else:
            logger.warning("Playwright browser install failed: %s", result.stderr[-1000:])
    except FileNotFoundError:
        logger.warning("Playwright CLI not found. Run pip install -r requirements.txt.")
    except Exception as exc:
        logger.warning("Playwright browser install skipped/failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_playwright_chromium()
    if settings.run_migrations_on_startup:
        await asyncio.to_thread(run_migrations)
        print("Database migrations applied successfully", flush=True)
        logger.info("Database migrations applied successfully")
    else:
        logger.info("Skipping automatic database migrations on startup.")

    def _has_config_value(name: str) -> bool:
        if name in os.environ:
            return bool(os.getenv(name))
        env_file = Path(".env")
        if not env_file.exists():
            return False
        try:
            for line in env_file.read_text().splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                if key.strip() == name and value.strip():
                    return True
        except Exception:
            return False
        return False

    validation_errors = []
    if not settings.database_url or not _has_config_value("DATABASE_URL"):
        validation_errors.append("DATABASE_URL is not set")
    if not settings.redis_url or not _has_config_value("REDIS_URL"):
        validation_errors.append("REDIS_URL is not set")
    if len(settings.jwt_secret_key) < 32:
        validation_errors.append("JWT_SECRET_KEY must be at least 32 characters")
    if not settings.openai_api_key and not settings.anthropic_api_key and not settings.openai_compatible_api_key:
        logger.warning(
            "No OpenAI, Anthropic, or OpenAI-compatible API key is set. "
            "Agents will not be able to run without an LLM provider."
        )

    if validation_errors:
        for error in validation_errors:
            logger.critical("STARTUP VALIDATION FAILED: %s", error)
        raise SystemExit(
            f"Startup failed: {len(validation_errors)} config error(s). "
            "Check the logs above."
        )

    logger.info("Initializing database...")
    await init_db()
    # Reset any executions stuck in "running" from a previous crash
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(Execution)
            .where(Execution.status == ExecutionStatus.running)
            .values(
                status=ExecutionStatus.failed,
                error="Server restarted while execution was running",
                completed_at=datetime.utcnow(),
            )
            .returning(Execution.id)
        )
        stuck_ids = result.all()
        await db.commit()
        if stuck_ids:
            logger.warning(
                f"Reset {len(stuck_ids)} orphaned 'running' execution(s) to failed on startup"
            )
    logger.info("Database initialized.")
    tool_registry.load_all_tools()
    logger.info("Loaded %s tools", len(tool_registry.get_all()))
    async with AsyncSessionLocal() as db:
        await seed_marketplace_templates(db)
        await seed_system_roles(db)
    memory_service = MemoryService()
    app.state.memory_service = memory_service
    hitl_service = HITLService()
    app.state.hitl_service = hitl_service
    scheduler_service = SchedulerService()
    app.state.scheduler = scheduler_service
    hitl_expiration_task = asyncio.create_task(approval_expiration_loop(hitl_service))
    tool_health_task = asyncio.create_task(tool_health_check_loop())
    await scheduler_service.start()
    await ws_manager.startup()

    await migrate_agent_models()

    telegram_bot.agent_runner_factory = telegram_runner_factory
    telegram_bot.ws_manager = ws_manager

    if settings.telegram_bot_token and settings.telegram_bot_token != "your-telegram-bot-token-here":
        logger.info("Starting Telegram bot...")
        await telegram_bot.start(settings.telegram_bot_token)
    else:
        logger.info("Telegram bot token not configured, skipping.")

    print("INFO:     Application startup complete.", flush=True)
    print("INFO:     Uvicorn running on http://0.0.0.0:8000", flush=True)

    yield

    logger.info("Shutting down...")
    hitl_expiration_task.cancel()
    tool_health_task.cancel()
    try:
        await hitl_expiration_task
    except asyncio.CancelledError:
        pass
    try:
        await tool_health_task
    except asyncio.CancelledError:
        pass
    scheduler_service = getattr(app.state, "scheduler", None)
    if scheduler_service:
        await scheduler_service.stop()
    await ws_manager.shutdown()
    await telegram_bot.stop()


app = FastAPI(
    title="Aethon API",
    description=(
        "Aethon — The operating system for AI companies. "
        "Run your company with AI teammates that have roles, "
        "trust scores, and real tools."
    ),
    version="2.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(PlanLimitMiddleware)

allowed_origins = settings.cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-Org-Id", "X-Api-Key"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-Request-ID"],
    max_age=600,
)
app.add_middleware(SecurityHeadersMiddleware)


@app.middleware("http")
async def api_request_metrics_middleware(request, call_next):
    start = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
        return response
    finally:
        duration = time.perf_counter() - start
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        status = response.status_code if response is not None else 500
        telemetry_service.record_api_request(
            method=request.method,
            path=path,
            status=status,
            duration_seconds=duration,
        )


app.include_router(api_router, prefix="/api")
app.include_router(public_tools_registry_router, prefix="/tools", tags=["tools-registry"])
app.include_router(public_webhook_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/metrics", include_in_schema=False)
async def metrics():
    """Prometheus metrics endpoint. Scraped by Grafana."""
    return PlainTextResponse(generate_latest().decode("utf-8"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        server_header=False,
    )

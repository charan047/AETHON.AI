from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

import asyncio

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from config import settings, AVAILABLE_MODELS
from database import init_db
from api import api_router
from channels.telegram import TelegramChannel
from services.websocket_manager import ws_manager
from runtime.agent_runner import AgentRunner
from database.db import AsyncSessionLocal
from database.models import Agent
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
        agent = result.scalars().first()
        if not agent:
            return None, None
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(run_migrations)
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized.")

    await migrate_agent_models()

    telegram_bot.agent_runner_factory = telegram_runner_factory
    telegram_bot.ws_manager = ws_manager

    if settings.telegram_bot_token and settings.telegram_bot_token != "your-telegram-bot-token-here":
        logger.info("Starting Telegram bot...")
        await telegram_bot.start(settings.telegram_bot_token)
    else:
        logger.info("Telegram bot token not configured, skipping.")

    yield

    logger.info("Shutting down...")
    await telegram_bot.stop()


app = FastAPI(
    title="AI Agent Orchestration Platform",
    description="Build, configure, and orchestrate AI agents with LangGraph",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

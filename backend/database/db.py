import logging

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings


logger = logging.getLogger(__name__)


engine = create_async_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=30,
    echo=settings.environment == "development",
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    if "sqlite" not in settings.database_url.lower():
        logger.info("Skipping Base.metadata.create_all for non-SQLite database; Alembic is the source of truth.")
        return

    from database.models import Agent, Workflow, WorkflowVersion, WebhookEndpoint, WebhookEventLog, Execution, ExecutionCostLog, ExecutionStep, Message, CompanyProfile, UserIntegration, AgentFeedback, AgentReputation, ModelConfig  # noqa
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Legacy SQLite-only migration. With Alembic + Postgres, schema changes
        # should be handled via migrations rather than ad-hoc ALTER TABLE.
        if "sqlite" in settings.database_url.lower():
            from sqlalchemy import text

            for stmt in [
                "ALTER TABLE workflows ADD COLUMN execution_mode VARCHAR DEFAULT 'sequential'",
                "ALTER TABLE workflows ADD COLUMN orchestration_prompt TEXT DEFAULT ''",
            ]:
                try:
                    await conn.execute(text(stmt))
                except Exception:
                    pass

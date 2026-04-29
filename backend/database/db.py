from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings


engine = create_async_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=settings.environment == "development",
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    from database.models import Agent, Workflow, WorkflowVersion, WebhookEndpoint, Execution, ExecutionCostLog, Message, CompanyProfile, UserIntegration, AgentFeedback, AgentReputation  # noqa
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

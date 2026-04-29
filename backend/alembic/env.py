import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import settings
from database.db import Base
from database.models import Agent, AgentFeedback, AgentMemoryConfig, AgentReputation, ApprovalStatus, CompanyProfile, ExecutionCostLog, ExecutionStatus, FeedbackType, HumanApprovalRequest, InAppNotification, IntegrationType, ListingStatus, ListingType, MarketplaceCategory, MarketplaceInstall, MarketplaceListing, MarketplaceReview, NotificationPriority, OrgInvite, OrgMember, Organization, ToolCallLog, UserIntegration, WebhookEndpoint, WorkflowVersion, Workflow, Execution, Message, CustomTool, User  # noqa: F401

config = context.config

sync_database_url = settings.database_url.replace(
    "postgresql+asyncpg://",
    "postgresql+psycopg2://",
)
config.set_main_option("sqlalchemy.url", sync_database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    # The alembic CLI itself expects a synchronous driver URL; however the online
    # migration runner must use an async driver. We keep the config's
    # sqlalchemy.url set to psycopg2 for offline/CLI compatibility, and override
    # it here for the async engine.
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = settings.database_url

    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

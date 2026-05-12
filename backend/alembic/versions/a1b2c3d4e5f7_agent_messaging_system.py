"""agent_messaging_system

Revision ID: a1b2c3d4e5f7
Revises: e6a1c2d3f4b5
Create Date: 2026-05-06 00:00:00.000000

Adds sender_type, scheduled_reply_at, scheduled_reply_job_id to agent_messages.
Adds ix_agent_messages_org_sender and ix_agent_messages_org_ceo_inbox indexes.
Organization.agent_message_retention_days already exists (added in e6a1c2d3f4b5).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "e6a1c2d3f4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("agent_messages")}
    indexes = {index["name"] for index in inspector.get_indexes("agent_messages")}

    # --- agent_messages new columns ---
    if "sender_type" not in columns:
        op.add_column(
            "agent_messages",
            sa.Column("sender_type", sa.String(length=10), nullable=True, server_default="agent"),
        )
    if "scheduled_reply_at" not in columns:
        op.add_column(
            "agent_messages",
            sa.Column("scheduled_reply_at", sa.DateTime(), nullable=True),
        )
    if "scheduled_reply_job_id" not in columns:
        op.add_column(
            "agent_messages",
            sa.Column("scheduled_reply_job_id", sa.String(), nullable=True),
        )

    # Backfill sender_type for existing rows:
    # from_agent_id IS NULL means CEO sent it; otherwise agent sent it.
    op.execute(
        "UPDATE agent_messages SET sender_type = 'ceo' WHERE from_agent_id IS NULL AND sender_type IS NULL"
    )
    op.execute(
        "UPDATE agent_messages SET sender_type = 'agent' WHERE from_agent_id IS NOT NULL AND sender_type IS NULL"
    )

    # --- new composite indexes ---
    if "ix_agent_messages_org_sender" not in indexes:
        op.create_index(
            "ix_agent_messages_org_sender",
            "agent_messages",
            ["org_id", "sender_type"],
            unique=False,
        )
    if "ix_agent_messages_org_ceo_inbox" not in indexes:
        op.create_index(
            "ix_agent_messages_org_ceo_inbox",
            "agent_messages",
            ["org_id", "requires_human", "is_resolved"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index("ix_agent_messages_org_ceo_inbox", table_name="agent_messages")
    op.drop_index("ix_agent_messages_org_sender", table_name="agent_messages")
    op.drop_column("agent_messages", "scheduled_reply_job_id")
    op.drop_column("agent_messages", "scheduled_reply_at")
    op.drop_column("agent_messages", "sender_type")

"""add_agent_messages

Revision ID: c9e2a1f4b6d8
Revises: 8f2d4b6c9a10
Create Date: 2026-04-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c9e2a1f4b6d8"
down_revision: Union[str, None] = "8f2d4b6c9a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("from_agent_id", sa.String(), nullable=False),
        sa.Column("to_agent_id", sa.String(), nullable=False),
        sa.Column("execution_id", sa.String(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("responded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["from_agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_messages_to_created", "agent_messages", ["to_agent_id", "created_at"])
    op.create_index("ix_agent_messages_execution", "agent_messages", ["execution_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_messages_execution", table_name="agent_messages")
    op.drop_index("ix_agent_messages_to_created", table_name="agent_messages")
    op.drop_table("agent_messages")

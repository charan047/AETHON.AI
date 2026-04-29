"""add_agent_memory_config

Revision ID: 2c8b1f4a6d9e
Revises: 9f4a7c2b8d1e
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2c8b1f4a6d9e"
down_revision: Union[str, None] = "9f4a7c2b8d1e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_memory_configs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=True),
        sa.Column("memory_enabled", sa.Boolean(), nullable=True),
        sa.Column("max_memories_per_query", sa.Integer(), nullable=True),
        sa.Column("memory_window_days", sa.Integer(), nullable=True),
        sa.Column("auto_summarize", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id"),
    )


def downgrade() -> None:
    op.drop_table("agent_memory_configs")

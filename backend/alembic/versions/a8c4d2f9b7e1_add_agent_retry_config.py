"""add_agent_retry_config

Revision ID: a8c4d2f9b7e1
Revises: 9b6d2f8c1a3e
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a8c4d2f9b7e1"
down_revision: Union[str, None] = "9b6d2f8c1a3e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("max_retries", sa.Integer(), server_default="3", nullable=False),
    )
    op.add_column(
        "agents",
        sa.Column("retry_delay_seconds", sa.Integer(), server_default="5", nullable=False),
    )
    op.add_column(
        "agents",
        sa.Column("retry_backoff_multiplier", sa.Float(), server_default="2.0", nullable=False),
    )
    op.add_column(
        "agents",
        sa.Column("retry_on_timeout", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.alter_column("agents", "max_retries", server_default=None)
    op.alter_column("agents", "retry_delay_seconds", server_default=None)
    op.alter_column("agents", "retry_backoff_multiplier", server_default=None)
    op.alter_column("agents", "retry_on_timeout", server_default=None)


def downgrade() -> None:
    op.drop_column("agents", "retry_on_timeout")
    op.drop_column("agents", "retry_backoff_multiplier")
    op.drop_column("agents", "retry_delay_seconds")
    op.drop_column("agents", "max_retries")

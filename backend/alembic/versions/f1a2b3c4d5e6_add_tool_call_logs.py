"""add_tool_call_logs

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tool_call_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=True),
        sa.Column("execution_id", sa.String(), nullable=True),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column("function_name", sa.String(length=100), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("input_preview", sa.String(length=500), nullable=True),
        sa.Column("output_preview", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["execution_id"], ["executions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tool_call_logs_execution_id", "tool_call_logs", ["execution_id"], unique=False)
    op.create_index("ix_tool_call_logs_tool_created", "tool_call_logs", ["tool_name", "created_at"], unique=False)
    op.create_index("ix_tool_call_logs_user_created", "tool_call_logs", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_tool_call_logs_user_created", table_name="tool_call_logs")
    op.drop_index("ix_tool_call_logs_tool_created", table_name="tool_call_logs")
    op.drop_index("ix_tool_call_logs_execution_id", table_name="tool_call_logs")
    op.drop_table("tool_call_logs")

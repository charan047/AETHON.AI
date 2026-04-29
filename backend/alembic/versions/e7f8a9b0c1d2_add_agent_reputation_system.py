"""add_agent_reputation_system

Revision ID: e7f8a9b0c1d2
Revises: d4e5f6a7b8c9
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


feedback_type = postgresql.ENUM(
    "approved",
    "rejected",
    "edited",
    "flagged",
    name="feedbacktype",
    create_type=False,
)


def upgrade() -> None:
    feedback_type.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "agent_feedback",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("execution_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("feedback_type", feedback_type, nullable=False),
        sa.Column("original_output", sa.Text(), nullable=False),
        sa.Column("edited_output", sa.Text(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("task_description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["execution_id"], ["executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "agent_reputation",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=True),
        sa.Column("total_tasks", sa.Integer(), nullable=True),
        sa.Column("approved_count", sa.Integer(), nullable=True),
        sa.Column("rejected_count", sa.Integer(), nullable=True),
        sa.Column("edited_count", sa.Integer(), nullable=True),
        sa.Column("approval_rate", sa.Float(), nullable=True),
        sa.Column("avg_edit_distance", sa.Float(), nullable=True),
        sa.Column("specializations", sa.Text(), nullable=True),
        sa.Column("learning_notes", sa.Text(), nullable=True),
        sa.Column("last_updated", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id"),
    )


def downgrade() -> None:
    op.drop_table("agent_reputation")
    op.drop_table("agent_feedback")
    feedback_type.drop(op.get_bind(), checkfirst=True)

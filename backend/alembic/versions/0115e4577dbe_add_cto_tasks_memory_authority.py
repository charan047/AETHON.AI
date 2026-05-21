"""add_cto_tasks_memory_authority

Revision ID: 0115e4577dbe
Revises: a7b8c9d0e1f2
Create Date: 2026-05-20 20:05:29.490563

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0115e4577dbe"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cto_authority",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("auto_approve_portal", sa.Boolean(), nullable=False),
        sa.Column("auto_approve_patterns", sa.Boolean(), nullable=False),
        sa.Column("auto_run_workflows", sa.Boolean(), nullable=False),
        sa.Column("auto_create_missions", sa.Boolean(), nullable=False),
        sa.Column("max_auto_spend_usd", sa.Float(), nullable=False),
        sa.Column("auto_approve_action_types", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id"),
    )
    op.create_table(
        "cto_memories",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column(
            "memory_type",
            sa.Enum(
                "client_preference",
                "agent_capability",
                "approval_pattern",
                "delivery_preference",
                "workflow_learning",
                "general",
                name="ctomemorytype",
            ),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("entity_name", sa.String(length=255), nullable=True),
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cto_memories_org_type", "cto_memories", ["org_id", "memory_type"], unique=False)
    op.create_table(
        "cto_tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("original_request", sa.Text(), nullable=False),
        sa.Column("plan", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "monitoring",
                "waiting_ceo",
                "complete",
                "failed",
                name="ctotaskstatus",
            ),
            nullable=False,
        ),
        sa.Column("mission_id", sa.String(), nullable=True),
        sa.Column("execution_ids", sa.JSON(), nullable=True),
        sa.Column("conversation_id", sa.String(), nullable=True),
        sa.Column("outcome_summary", sa.Text(), nullable=True),
        sa.Column("ceo_action_needed", sa.Text(), nullable=True),
        sa.Column("completion_notified", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["mission_id"], ["missions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cto_tasks_org_status", "cto_tasks", ["org_id", "status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_cto_tasks_org_status", table_name="cto_tasks")
    op.drop_table("cto_tasks")
    op.drop_index("ix_cto_memories_org_type", table_name="cto_memories")
    op.drop_table("cto_memories")
    op.drop_table("cto_authority")

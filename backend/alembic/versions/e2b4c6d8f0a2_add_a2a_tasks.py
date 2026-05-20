"""add a2a tasks

Revision ID: e2b4c6d8f0a2
Revises: c4d5e6f7a8b9
Create Date: 2026-05-17 20:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e2b4c6d8f0a2"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


a2a_status_enum = postgresql.ENUM(
    "submitted",
    "working",
    "input-required",
    "completed",
    "failed",
    name="a2ataskstatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    a2a_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "a2a_tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("execution_id", sa.String(), nullable=True),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("status", a2a_status_enum, nullable=False, server_default="submitted"),
        sa.Column("caller_identity", sa.String(length=255), nullable=True),
        sa.Column("payment_amount", sa.Float(), nullable=True),
        sa.Column("payment_currency", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["execution_id"], ["executions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_a2a_tasks_org_created", "a2a_tasks", ["org_id", "created_at"], unique=False)
    op.create_index("ix_a2a_tasks_agent_status", "a2a_tasks", ["agent_id", "status"], unique=False)
    op.alter_column("a2a_tasks", "status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_a2a_tasks_agent_status", table_name="a2a_tasks")
    op.drop_index("ix_a2a_tasks_org_created", table_name="a2a_tasks")
    op.drop_table("a2a_tasks")
    bind = op.get_bind()
    a2a_status_enum.drop(bind, checkfirst=True)

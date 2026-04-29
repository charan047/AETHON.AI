"""add_execution_hitl_statuses

Revision ID: 9b6d2f8c1a3e
Revises: 7a1e3c9b5d2f
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b6d2f8c1a3e"
down_revision: Union[str, None] = "7a1e3c9b5d2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


execution_status = sa.Enum(
    "pending",
    "running",
    "completed",
    "failed",
    "waiting_approval",
    "rejected",
    "timed_out",
    name="executionstatus",
)


def upgrade() -> None:
    execution_status.create(op.get_bind(), checkfirst=True)
    op.alter_column(
        "executions",
        "status",
        existing_type=sa.String(),
        type_=execution_status,
        postgresql_using="status::executionstatus",
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "executions",
        "status",
        existing_type=execution_status,
        type_=sa.String(),
        postgresql_using="status::text",
        existing_nullable=True,
    )
    execution_status.drop(op.get_bind(), checkfirst=True)

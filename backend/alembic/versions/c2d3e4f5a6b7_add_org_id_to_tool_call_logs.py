"""add_org_id_to_tool_call_logs

Revision ID: c2d3e4f5a6b7
Revises: b5c6d7e8f9a0
Create Date: 2026-05-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tool_call_logs", sa.Column("org_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_tool_call_logs_org_id_organizations",
        "tool_call_logs",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_tool_call_logs_org_created",
        "tool_call_logs",
        ["org_id", "created_at"],
        unique=False,
    )
    op.execute(
        """
        UPDATE tool_call_logs AS t
        SET org_id = e.org_id
        FROM executions AS e
        WHERE t.execution_id = e.id
          AND t.org_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_tool_call_logs_org_created", table_name="tool_call_logs")
    op.drop_constraint("fk_tool_call_logs_org_id_organizations", "tool_call_logs", type_="foreignkey")
    op.drop_column("tool_call_logs", "org_id")

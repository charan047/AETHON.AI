"""add execution revision fields

Revision ID: b1c2d3e4f5a6
Revises: a6b7c8d9e0f1
Create Date: 2026-05-18 18:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("executions", sa.Column("parent_execution_id", sa.String(), nullable=True))
    op.add_column(
        "executions",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("executions", sa.Column("ceo_feedback", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_executions_parent_execution_id",
        "executions",
        "executions",
        ["parent_execution_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.alter_column("executions", "revision_number", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_executions_parent_execution_id", "executions", type_="foreignkey")
    op.drop_column("executions", "ceo_feedback")
    op.drop_column("executions", "revision_number")
    op.drop_column("executions", "parent_execution_id")

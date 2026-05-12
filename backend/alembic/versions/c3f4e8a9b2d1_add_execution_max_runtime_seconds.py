"""add execution max runtime seconds

Revision ID: c3f4e8a9b2d1
Revises: b7c2d9e4f1a3
Create Date: 2026-05-06 20:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c3f4e8a9b2d1"
down_revision = "b7c2d9e4f1a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "executions",
        sa.Column("max_runtime_seconds", sa.Integer(), nullable=False, server_default="3600"),
    )
    op.alter_column("executions", "max_runtime_seconds", server_default=None)


def downgrade() -> None:
    op.drop_column("executions", "max_runtime_seconds")

"""add execution warning

Revision ID: a7b8c9d0e1f2
Revises: d6e7f8a9b0c1
Create Date: 2026-05-19 17:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a7b8c9d0e1f2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("executions", sa.Column("warning", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("executions", "warning")

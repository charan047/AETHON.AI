"""add requires review to workflow

Revision ID: a6b7c8d9e0f1
Revises: f1c7d9e2a4b6
Create Date: 2026-05-18 13:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, None] = "f1c7d9e2a4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE executionstatus ADD VALUE IF NOT EXISTS 'pending_review'")

    op.add_column(
        "workflows",
        sa.Column("requires_review", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("executions", sa.Column("approved_by", sa.String(), nullable=True))
    op.add_column("executions", sa.Column("approved_at", sa.DateTime(), nullable=True))
    op.add_column("executions", sa.Column("approval_note", sa.Text(), nullable=True))
    op.alter_column("workflows", "requires_review", server_default=None)


def downgrade() -> None:
    op.drop_column("executions", "approval_note")
    op.drop_column("executions", "approved_at")
    op.drop_column("executions", "approved_by")
    op.drop_column("workflows", "requires_review")
    # Enum value removal is intentionally omitted because PostgreSQL does not
    # support dropping enum values safely in-place.


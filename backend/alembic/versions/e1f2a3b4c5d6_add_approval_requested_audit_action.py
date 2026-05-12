"""add approval_requested audit action

Revision ID: e1f2a3b4c5d6
Revises: c3f4e8a9b2d1
Create Date: 2026-05-07 01:20:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "e1f2a3b4c5d6"
down_revision = "c3f4e8a9b2d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'approval_requested'")


def downgrade() -> None:
    pass

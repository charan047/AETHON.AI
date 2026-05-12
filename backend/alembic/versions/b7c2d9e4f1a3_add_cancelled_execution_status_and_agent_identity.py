"""add cancelled execution status and agent identity

Revision ID: b7c2d9e4f1a3
Revises: a1b2c3d4e5f8
Create Date: 2026-05-06 14:10:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "b7c2d9e4f1a3"
down_revision = "a1b2c3d4e5f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE executionstatus ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # Enum value removal is intentionally omitted because PostgreSQL does not
    # support dropping enum values safely in-place.
    pass

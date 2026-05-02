"""add gmail integration type

Revision ID: 1f2e3d4c5b6a
Revises: f2c4b6d8e0a1
Create Date: 2026-04-30 17:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1f2e3d4c5b6a"
down_revision = "f2c4b6d8e0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'gmail'")


def downgrade() -> None:
    # Enum value removal is intentionally omitted because PostgreSQL does not
    # support dropping enum values safely in-place.
    pass

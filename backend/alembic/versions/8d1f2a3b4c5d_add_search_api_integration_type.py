"""add search api integration type

Revision ID: 8d1f2a3b4c5d
Revises: 6b2f1a9c3d4e
Create Date: 2026-05-22 12:30:00.000000
"""

from typing import Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8d1f2a3b4c5d"
down_revision: Union[str, None] = "6b2f1a9c3d4e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'search_api'")


def downgrade() -> None:
    # Enum value removal is intentionally omitted because PostgreSQL does not
    # support dropping enum values safely in-place.
    pass

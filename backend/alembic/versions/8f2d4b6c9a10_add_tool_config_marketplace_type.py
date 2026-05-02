"""add_tool_config_marketplace_type

Revision ID: 8f2d4b6c9a10
Revises: 6f2a9c8d1e4b
Create Date: 2026-04-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "8f2d4b6c9a10"
down_revision: Union[str, None] = "6f2a9c8d1e4b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE listingtype ADD VALUE IF NOT EXISTS 'tool_config'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding the type.
    # Keeping the value is non-breaking for downgraded application code.
    pass

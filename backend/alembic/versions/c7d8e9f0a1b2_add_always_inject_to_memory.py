"""add always inject to memory

Revision ID: c7d8e9f0a1b2
Revises: b1c2d3e4f5a6
Create Date: 2026-05-18 13:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_memory_entries",
        sa.Column("always_inject", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "agent_memory_entries",
        sa.Column("source", sa.String(length=50), nullable=True),
    )
    op.alter_column("agent_memory_entries", "always_inject", server_default=None)


def downgrade() -> None:
    op.drop_column("agent_memory_entries", "source")
    op.drop_column("agent_memory_entries", "always_inject")

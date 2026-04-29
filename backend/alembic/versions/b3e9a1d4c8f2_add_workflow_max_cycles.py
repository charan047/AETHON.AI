"""add_workflow_max_cycles

Revision ID: b3e9a1d4c8f2
Revises: a8c4d2f9b7e1
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3e9a1d4c8f2"
down_revision: Union[str, None] = "a8c4d2f9b7e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workflows",
        sa.Column("max_cycles", sa.Integer(), server_default="10", nullable=False),
    )
    op.alter_column("workflows", "max_cycles", server_default=None)


def downgrade() -> None:
    op.drop_column("workflows", "max_cycles")

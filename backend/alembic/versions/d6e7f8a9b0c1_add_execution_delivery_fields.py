"""add execution delivery fields

Revision ID: d6e7f8a9b0c1
Revises: c7d8e9f0a1b2
Create Date: 2026-05-19 18:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("executions", sa.Column("delivered_at", sa.DateTime(), nullable=True))
    op.add_column("executions", sa.Column("delivery_method", sa.String(length=50), nullable=True))
    op.add_column("executions", sa.Column("delivery_target", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("executions", "delivery_target")
    op.drop_column("executions", "delivery_method")
    op.drop_column("executions", "delivered_at")

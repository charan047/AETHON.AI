"""add_user_integrations

Revision ID: d4e5f6a7b8c9
Revises: c6f1a9d3e4b2
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c6f1a9d3e4b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


integration_type = postgresql.ENUM(
    "github",
    "email_smtp",
    "slack",
    "notion",
    "linear",
    name="integrationtype",
    create_type=False,
)


def upgrade() -> None:
    integration_type.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "user_integrations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("integration_type", integration_type, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_test_result", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "integration_type", "name", name="uq_user_integration_name"),
    )


def downgrade() -> None:
    op.drop_table("user_integrations")
    integration_type.drop(op.get_bind(), checkfirst=True)

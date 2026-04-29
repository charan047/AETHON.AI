"""add_company_profile

Revision ID: c6f1a9d3e4b2
Revises: b3e9a1d4c8f2
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c6f1a9d3e4b2"
down_revision: Union[str, None] = "b3e9a1d4c8f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_profiles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=False),
        sa.Column("mission", sa.Text(), nullable=True),
        sa.Column("industry", sa.String(length=100), nullable=True),
        sa.Column("stage", sa.String(length=50), nullable=True),
        sa.Column("monthly_revenue", sa.Integer(), nullable=False),
        sa.Column("runway_months", sa.Integer(), nullable=True),
        sa.Column("primary_tech_stack", sa.Text(), nullable=True),
        sa.Column("goals", sa.Text(), nullable=True),
        sa.Column("onboarding_complete", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.alter_column("company_profiles", "onboarding_complete", server_default=None)


def downgrade() -> None:
    op.drop_table("company_profiles")

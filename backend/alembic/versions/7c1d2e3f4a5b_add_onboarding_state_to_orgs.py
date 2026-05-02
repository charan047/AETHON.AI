"""add onboarding state to organizations and demo flag to executions

Revision ID: 7c1d2e3f4a5b
Revises: 3a5d7f9b1c2e
Create Date: 2026-05-01 14:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7c1d2e3f4a5b"
down_revision: Union[str, None] = "3a5d7f9b1c2e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("onboarding_completed", sa.Boolean(), nullable=True))
    op.add_column("organizations", sa.Column("onboarding_step", sa.String(length=64), nullable=True))
    op.add_column("organizations", sa.Column("company_description", sa.Text(), nullable=True))
    op.add_column("organizations", sa.Column("primary_challenge", sa.String(length=100), nullable=True))
    op.add_column("organizations", sa.Column("competitors", sa.JSON(), nullable=True))
    op.execute("UPDATE organizations SET onboarding_completed = false WHERE onboarding_completed IS NULL")
    op.execute("UPDATE organizations SET onboarding_step = 'company_identity' WHERE onboarding_step IS NULL")
    op.execute("UPDATE organizations SET competitors = '[]'::json WHERE competitors IS NULL")
    op.alter_column("organizations", "onboarding_completed", nullable=False)
    op.alter_column("organizations", "onboarding_step", nullable=False)

    op.add_column("executions", sa.Column("is_demo", sa.Boolean(), nullable=True))
    op.execute("UPDATE executions SET is_demo = false WHERE is_demo IS NULL")
    op.alter_column("executions", "is_demo", nullable=False)


def downgrade() -> None:
    op.drop_column("executions", "is_demo")
    op.drop_column("organizations", "competitors")
    op.drop_column("organizations", "primary_challenge")
    op.drop_column("organizations", "company_description")
    op.drop_column("organizations", "onboarding_step")
    op.drop_column("organizations", "onboarding_completed")

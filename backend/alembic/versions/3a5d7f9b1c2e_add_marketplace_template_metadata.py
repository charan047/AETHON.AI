"""add marketplace template metadata

Revision ID: 3a5d7f9b1c2e
Revises: 2b7c4d6e8f90
Create Date: 2026-05-01 10:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3a5d7f9b1c2e"
down_revision: Union[str, None] = "2b7c4d6e8f90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("role_slug", sa.String(length=100), nullable=True))
    op.add_column("agents", sa.Column("seniority_level", sa.Integer(), nullable=True))
    op.add_column("agents", sa.Column("autonomy_level", sa.String(length=50), nullable=True))
    op.add_column("agents", sa.Column("trust_score", sa.Float(), nullable=True))
    op.add_column("agents", sa.Column("installed_from_listing_id", sa.String(), nullable=True))
    op.add_column("agents", sa.Column("created_by_user_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_agents_installed_from_listing_id_marketplace_listings",
        "agents",
        "marketplace_listings",
        ["installed_from_listing_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_agents_created_by_user_id_users",
        "agents",
        "users",
        ["created_by_user_id"],
        ["id"],
    )
    op.execute("UPDATE agents SET seniority_level = 1 WHERE seniority_level IS NULL")
    op.execute("UPDATE agents SET autonomy_level = 'supervised' WHERE autonomy_level IS NULL")
    op.execute("UPDATE agents SET trust_score = 50.0 WHERE trust_score IS NULL")

    op.add_column("workflows", sa.Column("input_template", sa.Text(), nullable=True))
    op.add_column("workflows", sa.Column("input_variables", sa.JSON(), nullable=True))
    op.add_column("workflows", sa.Column("configured_inputs", sa.JSON(), nullable=True))
    op.add_column("workflows", sa.Column("installed_from_listing_id", sa.String(), nullable=True))
    op.add_column("workflows", sa.Column("created_by_user_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_workflows_installed_from_listing_id_marketplace_listings",
        "workflows",
        "marketplace_listings",
        ["installed_from_listing_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_workflows_created_by_user_id_users",
        "workflows",
        "users",
        ["created_by_user_id"],
        ["id"],
    )

    op.add_column("marketplace_listings", sa.Column("short_description", sa.String(length=500), nullable=True))
    op.add_column("marketplace_listings", sa.Column("icon", sa.String(length=16), nullable=True))
    op.add_column("marketplace_listings", sa.Column("required_tools", sa.JSON(), nullable=True))
    op.add_column("marketplace_listings", sa.Column("optional_tools", sa.JSON(), nullable=True))
    op.add_column("marketplace_listings", sa.Column("required_integrations", sa.JSON(), nullable=True))
    op.add_column("marketplace_listings", sa.Column("recommended_integrations", sa.JSON(), nullable=True))
    op.add_column("marketplace_listings", sa.Column("is_featured", sa.Boolean(), nullable=True))
    op.add_column("marketplace_listings", sa.Column("author", sa.String(length=255), nullable=True))
    op.add_column("marketplace_listings", sa.Column("role_slug", sa.String(length=100), nullable=True))
    op.add_column("marketplace_listings", sa.Column("department_type", sa.String(length=100), nullable=True))
    op.add_column("marketplace_listings", sa.Column("hiring_tagline", sa.String(length=500), nullable=True))
    op.add_column("marketplace_listings", sa.Column("estimated_minutes_saved_per_week", sa.Integer(), nullable=True))
    op.add_column("marketplace_listings", sa.Column("difficulty", sa.String(length=32), nullable=True))
    op.execute("UPDATE marketplace_listings SET short_description = COALESCE(tagline, '') WHERE short_description IS NULL")
    op.execute("UPDATE marketplace_listings SET icon = '🤖' WHERE icon IS NULL")
    op.execute("UPDATE marketplace_listings SET required_tools = '[]'::json WHERE required_tools IS NULL")
    op.execute("UPDATE marketplace_listings SET optional_tools = '[]'::json WHERE optional_tools IS NULL")
    op.execute("UPDATE marketplace_listings SET required_integrations = '[]'::json WHERE required_integrations IS NULL")
    op.execute("UPDATE marketplace_listings SET recommended_integrations = '[]'::json WHERE recommended_integrations IS NULL")
    op.execute("UPDATE marketplace_listings SET is_featured = false WHERE is_featured IS NULL")
    op.execute("UPDATE marketplace_listings SET hiring_tagline = '' WHERE hiring_tagline IS NULL")
    op.execute("UPDATE marketplace_listings SET estimated_minutes_saved_per_week = 0 WHERE estimated_minutes_saved_per_week IS NULL")
    op.execute("UPDATE marketplace_listings SET difficulty = 'beginner' WHERE difficulty IS NULL")


def downgrade() -> None:
    op.drop_column("marketplace_listings", "difficulty")
    op.drop_column("marketplace_listings", "estimated_minutes_saved_per_week")
    op.drop_column("marketplace_listings", "hiring_tagline")
    op.drop_column("marketplace_listings", "department_type")
    op.drop_column("marketplace_listings", "role_slug")
    op.drop_column("marketplace_listings", "author")
    op.drop_column("marketplace_listings", "is_featured")
    op.drop_column("marketplace_listings", "recommended_integrations")
    op.drop_column("marketplace_listings", "required_integrations")
    op.drop_column("marketplace_listings", "optional_tools")
    op.drop_column("marketplace_listings", "required_tools")
    op.drop_column("marketplace_listings", "icon")
    op.drop_column("marketplace_listings", "short_description")

    op.drop_constraint("fk_workflows_created_by_user_id_users", "workflows", type_="foreignkey")
    op.drop_constraint("fk_workflows_installed_from_listing_id_marketplace_listings", "workflows", type_="foreignkey")
    op.drop_column("workflows", "created_by_user_id")
    op.drop_column("workflows", "installed_from_listing_id")
    op.drop_column("workflows", "configured_inputs")
    op.drop_column("workflows", "input_variables")
    op.drop_column("workflows", "input_template")

    op.drop_constraint("fk_agents_created_by_user_id_users", "agents", type_="foreignkey")
    op.drop_constraint("fk_agents_installed_from_listing_id_marketplace_listings", "agents", type_="foreignkey")
    op.drop_column("agents", "created_by_user_id")
    op.drop_column("agents", "installed_from_listing_id")
    op.drop_column("agents", "trust_score")
    op.drop_column("agents", "autonomy_level")
    op.drop_column("agents", "seniority_level")
    op.drop_column("agents", "role_slug")

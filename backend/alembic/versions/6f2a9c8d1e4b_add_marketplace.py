"""add_marketplace

Revision ID: 6f2a9c8d1e4b
Revises: 4d8f0b2c6a91
Create Date: 2026-04-28 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "6f2a9c8d1e4b"
down_revision: Union[str, None] = "4d8f0b2c6a91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(
        "productivity",
        "development",
        "marketing",
        "finance",
        "customer_support",
        "research",
        "hr",
        "operations",
        "data",
        "other",
        name="marketplacecategory",
    ).create(bind, checkfirst=True)
    postgresql.ENUM("agent", "workflow", "eval_suite", name="listingtype").create(bind, checkfirst=True)
    postgresql.ENUM("draft", "pending", "published", "rejected", "archived", name="listingstatus").create(bind, checkfirst=True)

    marketplace_category = postgresql.ENUM(
        "productivity",
        "development",
        "marketing",
        "finance",
        "customer_support",
        "research",
        "hr",
        "operations",
        "data",
        "other",
        name="marketplacecategory",
        create_type=False,
    )
    listing_type = postgresql.ENUM("agent", "workflow", "eval_suite", name="listingtype", create_type=False)
    listing_status = postgresql.ENUM(
        "draft",
        "pending",
        "published",
        "rejected",
        "archived",
        name="listingstatus",
        create_type=False,
    )

    op.create_table(
        "marketplace_listings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("publisher_user_id", sa.String(), nullable=False),
        sa.Column("publisher_org_id", sa.String(), nullable=True),
        sa.Column("listing_type", listing_type, nullable=False),
        sa.Column("category", marketplace_category, nullable=False),
        sa.Column("status", listing_status, nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("tagline", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("readme", sa.Text(), nullable=True),
        sa.Column("template_data", sa.Text(), nullable=False),
        sa.Column("tags", sa.String(length=500), nullable=True),
        sa.Column("preview_image_url", sa.String(length=500), nullable=True),
        sa.Column("demo_video_url", sa.String(length=500), nullable=True),
        sa.Column("source_url", sa.String(length=500), nullable=True),
        sa.Column("install_count", sa.Integer(), nullable=True),
        sa.Column("rating_avg", sa.Float(), nullable=True),
        sa.Column("rating_count", sa.Integer(), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=True),
        sa.Column("is_free", sa.Boolean(), nullable=True),
        sa.Column("price_usd", sa.Float(), nullable=True),
        sa.Column("version", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["publisher_org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["publisher_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(
        "ix_marketplace_listings_status_category",
        "marketplace_listings",
        ["status", "category"],
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_listings_install_count_desc ON marketplace_listings (install_count DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_listings_rating_avg_desc ON marketplace_listings (rating_avg DESC)")

    op.create_table(
        "marketplace_installs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("listing_id", sa.String(), nullable=False),
        sa.Column("installer_user_id", sa.String(), nullable=False),
        sa.Column("installer_org_id", sa.String(), nullable=False),
        sa.Column("installed_resource_id", sa.String(), nullable=True),
        sa.Column("installed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["installer_org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["installer_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["listing_id"], ["marketplace_listings.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("listing_id", "installer_org_id", name="uq_marketplace_install_listing_org"),
    )

    op.create_table(
        "marketplace_reviews",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("listing_id", sa.String(), nullable=False),
        sa.Column("reviewer_user_id", sa.String(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("helpful_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["listing_id"], ["marketplace_listings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("listing_id", "reviewer_user_id", name="uq_marketplace_review_listing_user"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_table("marketplace_reviews")
    op.drop_table("marketplace_installs")
    op.drop_index("ix_marketplace_listings_rating_avg_desc", table_name="marketplace_listings")
    op.drop_index("ix_marketplace_listings_install_count_desc", table_name="marketplace_listings")
    op.drop_index("ix_marketplace_listings_status_category", table_name="marketplace_listings")
    op.drop_table("marketplace_listings")
    sa.Enum(name="listingstatus").drop(bind, checkfirst=True)
    sa.Enum(name="listingtype").drop(bind, checkfirst=True)
    sa.Enum(name="marketplacecategory").drop(bind, checkfirst=True)

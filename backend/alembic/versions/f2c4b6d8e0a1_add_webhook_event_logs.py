"""add_webhook_event_logs

Revision ID: f2c4b6d8e0a1
Revises: e4b7c9d1a2f3
Create Date: 2026-04-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f2c4b6d8e0a1"
down_revision: Union[str, None] = "e4b7c9d1a2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'billing_payment_failed'")
    op.add_column("organizations", sa.Column("stripe_subscription_status", sa.String(length=50), nullable=True))
    op.add_column("organizations", sa.Column("stripe_metered_subscription_item_id", sa.String(length=100), nullable=True))
    op.add_column("organizations", sa.Column("stripe_current_period_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("stripe_trial_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("cancellation_date", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "webhook_event_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=True),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_webhook_event_logs_event_id"),
    )
    op.create_index(
        "ix_webhook_event_logs_source_event_created",
        "webhook_event_logs",
        ["source", "event_type", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_event_logs_source_event_created", table_name="webhook_event_logs")
    op.drop_table("webhook_event_logs")
    op.drop_column("organizations", "cancellation_date")
    op.drop_column("organizations", "stripe_trial_end")
    op.drop_column("organizations", "stripe_current_period_end")
    op.drop_column("organizations", "stripe_metered_subscription_item_id")
    op.drop_column("organizations", "stripe_subscription_status")
    # PostgreSQL enum values are not removed on downgrade.

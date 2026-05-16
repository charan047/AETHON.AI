"""add workflow schedule controls and notification preferences

Revision ID: 9a7b6c5d4e3f
Revises: 7c9e1a2b3d4f
Create Date: 2026-05-14 17:40:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "9a7b6c5d4e3f"
down_revision = "7c9e1a2b3d4f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workflows", sa.Column("schedule_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("workflows", sa.Column("schedule_timezone", sa.String(length=64), nullable=False, server_default="UTC"))
    op.add_column("workflows", sa.Column("last_run_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE workflows SET schedule_enabled = CASE WHEN schedule IS NOT NULL THEN true ELSE false END")
    op.alter_column("workflows", "schedule_enabled", server_default=None)
    op.alter_column("workflows", "schedule_timezone", server_default=None)

    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("email_on_approval_needed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("email_on_execution_complete", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("email_on_autonomy_change", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("daily_digest_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("daily_digest_time", sa.String(length=5), nullable=False, server_default="08:00"),
        sa.Column("notification_email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "user_id", name="uq_notification_preferences_org_user"),
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")
    op.drop_column("workflows", "last_run_at")
    op.drop_column("workflows", "schedule_timezone")
    op.drop_column("workflows", "schedule_enabled")

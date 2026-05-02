"""scope notifications by org

Revision ID: b5c6d7e8f9a0
Revises: a1b2c3d4e5f6
Create Date: 2026-05-02 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b5c6d7e8f9a0"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("in_app_notifications", sa.Column("org_id", sa.String(), nullable=True))

    op.execute(
        """
        UPDATE in_app_notifications AS notif
        SET org_id = agents.org_id
        FROM agents
        WHERE notif.agent_id = agents.id
          AND notif.org_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE in_app_notifications AS notif
        SET org_id = profiles.org_id
        FROM company_profiles AS profiles
        WHERE notif.user_id = profiles.user_id
          AND notif.org_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE in_app_notifications AS notif
        SET org_id = members.org_id
        FROM org_members AS members
        WHERE notif.user_id = members.user_id
          AND notif.org_id IS NULL
        """
    )

    op.alter_column("in_app_notifications", "org_id", nullable=False)
    op.create_foreign_key(
        "fk_in_app_notifications_org_id_organizations",
        "in_app_notifications",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_index("ix_in_app_notifications_user_unread_created", table_name="in_app_notifications")
    op.create_index(
        "ix_in_app_notifications_org_user_unread_created",
        "in_app_notifications",
        ["org_id", "user_id", "is_read", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_in_app_notifications_org_user_unread_created", table_name="in_app_notifications")
    op.create_index(
        "ix_in_app_notifications_user_unread_created",
        "in_app_notifications",
        ["user_id", "is_read", "created_at"],
        unique=False,
    )
    op.drop_constraint("fk_in_app_notifications_org_id_organizations", "in_app_notifications", type_="foreignkey")
    op.drop_column("in_app_notifications", "org_id")

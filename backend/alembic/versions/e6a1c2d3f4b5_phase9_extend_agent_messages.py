"""phase9_extend_agent_messages

Revision ID: e6a1c2d3f4b5
Revises: d4ce33e34aef
Create Date: 2026-05-05 22:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e6a1c2d3f4b5"
down_revision: Union[str, None] = "d4ce33e34aef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_messages",
        sa.Column("org_id", sa.String(), nullable=True),
    )
    op.add_column(
        "agent_messages",
        sa.Column("message_type", sa.String(length=50), nullable=True, server_default="general"),
    )
    op.add_column(
        "agent_messages",
        sa.Column("thread_id", sa.String(), nullable=True),
    )
    op.add_column(
        "agent_messages",
        sa.Column("parent_message_id", sa.String(), nullable=True),
    )
    op.add_column(
        "agent_messages",
        sa.Column("is_resolved", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "agent_messages",
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "agent_messages",
        sa.Column("requires_human", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    op.add_column(
        "agent_messages",
        sa.Column("priority", sa.String(length=20), nullable=True, server_default="normal"),
    )
    op.add_column(
        "agent_messages",
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.create_foreign_key(
        "fk_agent_messages_org_id",
        "agent_messages",
        "organizations",
        ["org_id"],
        ["id"],
    )
    op.alter_column("agent_messages", "from_agent_id", existing_type=sa.String(), nullable=True)
    op.alter_column("agent_messages", "to_agent_id", existing_type=sa.String(), nullable=True)
    op.create_index(
        "ix_agent_messages_org_requires_human",
        "agent_messages",
        ["org_id", "requires_human"],
        unique=False,
    )
    op.create_index(
        "ix_agent_messages_thread",
        "agent_messages",
        ["thread_id"],
        unique=False,
    )

    op.add_column(
        "organizations",
        sa.Column("agent_message_retention_days", sa.Integer(), nullable=True, server_default="30"),
    )

    op.execute(
        """
        UPDATE agent_messages am
        SET org_id = a.org_id
        FROM agents a
        WHERE am.org_id IS NULL AND am.from_agent_id = a.id
        """
    )
    op.execute(
        """
        UPDATE agent_messages am
        SET org_id = a.org_id
        FROM agents a
        WHERE am.org_id IS NULL AND am.to_agent_id = a.id
        """
    )
    op.execute("UPDATE agent_messages SET message_type = 'general' WHERE message_type IS NULL")
    op.execute("UPDATE agent_messages SET thread_id = id WHERE thread_id IS NULL")
    op.execute("UPDATE agent_messages SET is_resolved = false WHERE is_resolved IS NULL")
    op.execute("UPDATE agent_messages SET requires_human = false WHERE requires_human IS NULL")
    op.execute("UPDATE agent_messages SET priority = 'normal' WHERE priority IS NULL")
    op.execute(
        "UPDATE organizations SET agent_message_retention_days = 30 "
        "WHERE agent_message_retention_days IS NULL"
    )


def downgrade() -> None:
    op.drop_column("organizations", "agent_message_retention_days")

    op.drop_index("ix_agent_messages_thread", table_name="agent_messages")
    op.drop_index("ix_agent_messages_org_requires_human", table_name="agent_messages")
    op.alter_column("agent_messages", "to_agent_id", existing_type=sa.String(), nullable=False)
    op.alter_column("agent_messages", "from_agent_id", existing_type=sa.String(), nullable=False)
    op.drop_constraint("fk_agent_messages_org_id", "agent_messages", type_="foreignkey")
    op.drop_column("agent_messages", "read_at")
    op.drop_column("agent_messages", "priority")
    op.drop_column("agent_messages", "requires_human")
    op.drop_column("agent_messages", "resolved_at")
    op.drop_column("agent_messages", "is_resolved")
    op.drop_column("agent_messages", "parent_message_id")
    op.drop_column("agent_messages", "thread_id")
    op.drop_column("agent_messages", "message_type")
    op.drop_column("agent_messages", "org_id")

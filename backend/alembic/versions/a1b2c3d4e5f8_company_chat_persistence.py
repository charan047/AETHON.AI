"""company_chat_persistence

Revision ID: a1b2c3d4e5f8
Revises: a1b2c3d4e5f7
Create Date: 2026-05-06 10:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f8"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_conversations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=True, server_default="0"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_company_conversations_org_user",
        "company_conversations",
        ["org_id", "user_id"],
        unique=False,
    )

    op.create_table(
        "company_chat_messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("conversation_id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("actions_json", sa.JSON(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("attachments_json", sa.JSON(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["company_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_conversation", "company_chat_messages", ["conversation_id"], unique=False)
    op.create_index("ix_chat_messages_org_created", "company_chat_messages", ["org_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_chat_messages_org_created", table_name="company_chat_messages")
    op.drop_index("ix_chat_messages_conversation", table_name="company_chat_messages")
    op.drop_table("company_chat_messages")
    op.drop_index("ix_company_conversations_org_user", table_name="company_conversations")
    op.drop_table("company_conversations")

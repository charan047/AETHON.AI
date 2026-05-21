"""add_is_proactive_to_chat_message

Revision ID: 6b2f1a9c3d4e
Revises: 0115e4577dbe
Create Date: 2026-05-20 21:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6b2f1a9c3d4e"
down_revision: Union[str, None] = "0115e4577dbe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company_chat_messages",
        sa.Column(
            "is_proactive",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("company_chat_messages", "is_proactive", server_default=None)


def downgrade() -> None:
    op.drop_column("company_chat_messages", "is_proactive")

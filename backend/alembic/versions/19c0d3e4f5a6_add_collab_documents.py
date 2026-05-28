"""add_collab_documents

Revision ID: 19c0d3e4f5a6
Revises: 0f19a2b3c4d5
Create Date: 2026-05-28 03:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "19c0d3e4f5a6"
down_revision: Union[str, None] = "0f19a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "collab_documents" not in set(inspector.get_table_names()):
        op.create_table(
            "collab_documents",
            sa.Column("room", sa.String(length=255), nullable=False),
            sa.Column("yjs_state", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("room"),
        )


def downgrade() -> None:
    op.drop_table("collab_documents")

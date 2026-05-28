"""scope custom tool names per org

Revision ID: f7b8c9d0e1a2
Revises: 8d1f2a3b4c5d
Create Date: 2026-05-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7b8c9d0e1a2"
down_revision: Union[str, None] = "8d1f2a3b4c5d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE custom_tools DROP CONSTRAINT IF EXISTS custom_tools_name_key")

    with op.batch_alter_table("custom_tools") as batch_op:
        batch_op.create_unique_constraint("uq_custom_tools_org_name", ["org_id", "name"])


def downgrade() -> None:
    with op.batch_alter_table("custom_tools") as batch_op:
        batch_op.drop_constraint("uq_custom_tools_org_name", type_="unique")
        batch_op.create_unique_constraint("custom_tools_name_key", ["name"])

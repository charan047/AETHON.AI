"""add_output_file_id_to_mission_tasks

Revision ID: 3c19d5e6f7a8
Revises: 2b19c4d5e6f7
Create Date: 2026-05-28 19:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3c19d5e6f7a8"
down_revision: Union[str, None] = "2b19c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("mission_tasks")}

    if "output_file_id" not in existing_columns:
        with op.batch_alter_table("mission_tasks") as batch_op:
            batch_op.add_column(sa.Column("output_file_id", sa.String(), nullable=True))
            batch_op.create_foreign_key(
                "fk_mission_tasks_output_file_id_org_files",
                "org_files",
                ["output_file_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("mission_tasks")}

    if "output_file_id" in existing_columns:
        with op.batch_alter_table("mission_tasks") as batch_op:
            batch_op.drop_constraint(
                "fk_mission_tasks_output_file_id_org_files",
                type_="foreignkey",
            )
            batch_op.drop_column("output_file_id")

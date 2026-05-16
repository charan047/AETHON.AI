"""eval_run_model_comparison_fields

Revision ID: 7c9e1a2b3d4f
Revises: 15b2c4d6e7f8
Create Date: 2026-05-13 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7c9e1a2b3d4f"
down_revision: Union[str, None] = "15b2c4d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "eval_runs",
        sa.Column("model_config_id", sa.String(), nullable=True),
    )
    op.add_column(
        "eval_runs",
        sa.Column("comparison_group_id", sa.String(), nullable=True),
    )
    op.add_column(
        "eval_runs",
        sa.Column("comparison_slot", sa.String(length=10), nullable=True),
    )
    op.create_foreign_key(
        "fk_eval_runs_model_config_id_model_configs",
        "eval_runs",
        "model_configs",
        ["model_config_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_eval_runs_comparison_group_id", "eval_runs", ["comparison_group_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_eval_runs_comparison_group_id", table_name="eval_runs")
    op.drop_constraint("fk_eval_runs_model_config_id_model_configs", "eval_runs", type_="foreignkey")
    op.drop_column("eval_runs", "comparison_slot")
    op.drop_column("eval_runs", "comparison_group_id")
    op.drop_column("eval_runs", "model_config_id")

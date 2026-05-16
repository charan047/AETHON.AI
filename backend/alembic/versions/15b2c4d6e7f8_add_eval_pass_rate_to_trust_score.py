"""add_eval_pass_rate_to_trust_score

Revision ID: 15b2c4d6e7f8
Revises: 4d6f34984c76
Create Date: 2026-05-13 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "15b2c4d6e7f8"
down_revision: Union[str, None] = "4d6f34984c76"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_trust_scores",
        sa.Column("eval_pass_rate", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "agent_trust_scores",
        sa.Column("eval_runs_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("agent_trust_scores", "eval_pass_rate", server_default=None)
    op.alter_column("agent_trust_scores", "eval_runs_count", server_default=None)


def downgrade() -> None:
    op.drop_column("agent_trust_scores", "eval_runs_count")
    op.drop_column("agent_trust_scores", "eval_pass_rate")

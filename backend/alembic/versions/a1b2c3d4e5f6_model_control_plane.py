"""model control plane

Revision ID: a1b2c3d4e5f6
Revises: 7c1d2e3f4a5b
Create Date: 2026-05-01 23:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "7c1d2e3f4a5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for value in ("model_added", "model_set_default", "agent_model_changed"):
            op.execute(f"ALTER TYPE auditaction ADD VALUE IF NOT EXISTS '{value}'")

    op.create_table(
        "model_configs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model_id", sa.String(length=200), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("context_window", sa.Integer(), nullable=True),
        sa.Column("supports_tools", sa.Boolean(), nullable=True),
        sa.Column("supports_vision", sa.Boolean(), nullable=True),
        sa.Column("cost_per_million_input_tokens", sa.Float(), nullable=True),
        sa.Column("cost_per_million_output_tokens", sa.Float(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.Column("test_status", sa.String(length=20), nullable=True),
        sa.Column("test_error", sa.Text(), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_model_configs_org_default", "model_configs", ["org_id", "is_default"], unique=False)
    op.create_index("ix_model_configs_org_id", "model_configs", ["org_id"], unique=False)

    op.add_column("agents", sa.Column("model_config_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_agents_model_config_id_model_configs",
        "agents",
        "model_configs",
        ["model_config_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_agents_model_config_id_model_configs", "agents", type_="foreignkey")
    op.drop_column("agents", "model_config_id")
    op.drop_index("ix_model_configs_org_id", table_name="model_configs")
    op.drop_index("ix_model_configs_org_default", table_name="model_configs")
    op.drop_table("model_configs")

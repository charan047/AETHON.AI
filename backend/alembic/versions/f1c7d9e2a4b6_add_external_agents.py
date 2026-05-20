"""add external agents

Revision ID: f1c7d9e2a4b6
Revises: e2b4c6d8f0a2
Create Date: 2026-05-18 02:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f1c7d9e2a4b6"
down_revision = "e2b4c6d8f0a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'external_agent_call'")
        op.execute("CREATE TYPE a2ataskdirection AS ENUM ('incoming', 'outgoing')")

    op.create_table(
        "external_agents",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("agent_card_url", sa.String(length=500), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("provider_name", sa.String(length=255), nullable=True),
        sa.Column("provider_url", sa.String(length=500), nullable=True),
        sa.Column("task_endpoint", sa.String(length=500), nullable=False),
        sa.Column("skills", sa.JSON(), nullable=True),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("trust_status", sa.String(length=20), nullable=True),
        sa.Column("agent_did", sa.String(length=255), nullable=True),
        sa.Column("total_calls", sa.Integer(), nullable=True),
        sa.Column("successful_calls", sa.Integer(), nullable=True),
        sa.Column("total_cost_usd", sa.Float(), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_external_agents_org_id", "external_agents", ["org_id"], unique=False)

    if dialect == "postgresql":
        direction_type = sa.Enum("incoming", "outgoing", name="a2ataskdirection", create_type=False)
    else:
        direction_type = sa.Enum("incoming", "outgoing", name="a2ataskdirection")

    op.add_column("a2a_tasks", sa.Column("external_agent_id", sa.String(), nullable=True))
    op.add_column(
        "a2a_tasks",
        sa.Column(
            "direction",
            direction_type,
            nullable=False,
            server_default="incoming",
        ),
    )
    op.create_foreign_key(
        "fk_a2a_tasks_external_agent_id_external_agents",
        "a2a_tasks",
        "external_agents",
        ["external_agent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute("UPDATE a2a_tasks SET direction = 'incoming' WHERE direction IS NULL")
    op.alter_column("a2a_tasks", "direction", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_a2a_tasks_external_agent_id_external_agents", "a2a_tasks", type_="foreignkey")
    op.drop_column("a2a_tasks", "direction")
    op.drop_column("a2a_tasks", "external_agent_id")
    op.drop_index("ix_external_agents_org_id", table_name="external_agents")
    op.drop_table("external_agents")

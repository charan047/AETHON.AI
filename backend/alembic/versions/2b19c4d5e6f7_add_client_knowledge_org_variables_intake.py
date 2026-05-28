"""add_client_knowledge_org_variables_intake

Revision ID: 2b19c4d5e6f7
Revises: 19c0d3e4f5a6
Create Date: 2026-05-28 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2b19c4d5e6f7"
down_revision: Union[str, None] = "19c0d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "client_knowledge" not in existing_tables:
        op.create_table(
            "client_knowledge",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("source_agent_id", sa.String(), nullable=True),
            sa.Column("source_execution_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_client_knowledge_client", "client_knowledge", ["client_id"], unique=False)

    if "org_variables" not in existing_tables:
        op.create_table(
            "org_variables",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("key", sa.String(length=100), nullable=False),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("org_id", "key", name="uq_org_variable"),
        )

    if "client_intake_forms" not in existing_tables:
        op.create_table(
            "client_intake_forms",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("workflow_id", sa.String(), nullable=True),
            sa.Column("fields", sa.JSON(), nullable=True),
            sa.Column("token", sa.String(length=64), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token"),
        )

    if "client_intake_submissions" not in existing_tables:
        op.create_table(
            "client_intake_submissions",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("form_id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("submitted_data", sa.JSON(), nullable=False),
            sa.Column("execution_id", sa.String(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["form_id"], ["client_intake_forms.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    op.drop_table("client_intake_submissions")
    op.drop_table("client_intake_forms")
    op.drop_table("org_variables")
    op.drop_index("ix_client_knowledge_client", table_name="client_knowledge")
    op.drop_table("client_knowledge")

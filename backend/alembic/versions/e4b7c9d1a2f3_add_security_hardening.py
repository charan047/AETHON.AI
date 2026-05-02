"""add_security_hardening

Revision ID: e4b7c9d1a2f3
Revises: d3a7e9b2c4f1
Create Date: 2026-04-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "e4b7c9d1a2f3"
down_revision: Union[str, None] = "d3a7e9b2c4f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(
        "user_login",
        "user_login_failed",
        "user_registered",
        "api_key_created",
        "api_key_revoked",
        "agent_deleted",
        "workflow_deleted",
        "org_member_removed",
        "org_member_role_changed",
        "hitl_approved",
        "hitl_rejected",
        "marketplace_published",
        "data_exported",
        name="auditaction",
    ).create(bind, checkfirst=True)
    audit_action = postgresql.ENUM(
        "user_login",
        "user_login_failed",
        "user_registered",
        "api_key_created",
        "api_key_revoked",
        "agent_deleted",
        "workflow_deleted",
        "org_member_removed",
        "org_member_role_changed",
        "hitl_approved",
        "hitl_rejected",
        "marketplace_published",
        "data_exported",
        name="auditaction",
        create_type=False,
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("org_id", sa.String(), nullable=True),
        sa.Column("action", audit_action, nullable=False),
        sa.Column("resource_type", sa.String(length=50), nullable=True),
        sa.Column("resource_id", sa.String(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_audit_logs_org_created_desc",
        "audit_logs",
        ["org_id", sa.text("created_at DESC")],
        unique=False,
        postgresql_using="btree",
    )
    op.create_index(
        "ix_audit_logs_user_created_desc",
        "audit_logs",
        ["user_id", sa.text("created_at DESC")],
        unique=False,
        postgresql_using="btree",
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_user_created_desc", table_name="audit_logs")
    op.drop_index("ix_audit_logs_org_created_desc", table_name="audit_logs")
    op.drop_table("audit_logs")
    bind = op.get_bind()
    postgresql.ENUM(name="auditaction").drop(bind, checkfirst=True)

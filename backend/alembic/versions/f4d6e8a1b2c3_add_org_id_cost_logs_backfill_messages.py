"""add org_id cost logs backfill messages

Revision ID: f4d6e8a1b2c3
Revises: e1f2a3b4c5d6
Create Date: 2026-05-07 22:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "f4d6e8a1b2c3"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "execution_cost_logs",
        sa.Column(
            "org_id",
            sa.String(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_execution_cost_logs_org_created",
        "execution_cost_logs",
        ["org_id", "created_at"],
        unique=False,
    )

    op.execute(
        """
        UPDATE execution_cost_logs ecl
        SET org_id = e.org_id
        FROM executions e
        WHERE e.id = ecl.execution_id
          AND ecl.org_id IS NULL
        """
    )

    op.execute(
        """
        UPDATE agent_messages am
        SET org_id = (
            SELECT w.org_id
            FROM executions e
            JOIN workflows w ON e.workflow_id = w.id
            WHERE e.id = am.execution_id
        )
        WHERE am.org_id IS NULL
          AND am.execution_id IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE agent_messages am
        SET org_id = (
            SELECT a.org_id
            FROM agents a
            WHERE a.id = am.from_agent_id
        )
        WHERE am.org_id IS NULL
          AND am.from_agent_id IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE agent_messages am
        SET org_id = (
            SELECT a.org_id
            FROM agents a
            WHERE a.id = am.to_agent_id
        )
        WHERE am.org_id IS NULL
          AND am.to_agent_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_execution_cost_logs_org_created", table_name="execution_cost_logs")
    op.drop_column("execution_cost_logs", "org_id")

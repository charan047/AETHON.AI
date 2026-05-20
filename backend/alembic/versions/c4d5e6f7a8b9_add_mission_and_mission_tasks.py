"""add mission and mission tasks

Revision ID: c4d5e6f7a8b9
Revises: 9a7b6c5d4e3f
Create Date: 2026-05-17 10:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c4d5e6f7a8b9"
down_revision = "9a7b6c5d4e3f"
branch_labels = None
depends_on = None


missionstatus = sa.Enum(
    "planning",
    "active",
    "paused",
    "completed",
    "failed",
    name="missionstatus",
)

missiontaskstatus = sa.Enum(
    "pending",
    "running",
    "completed",
    "failed",
    "skipped",
    name="missiontaskstatus",
)


def upgrade() -> None:
    op.create_table(
        "missions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("status", missionstatus, nullable=False, server_default="planning"),
        sa.Column("report", sa.Text(), nullable=True),
        sa.Column("report_delivered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_missions_org_id", "missions", ["org_id"], unique=False)
    op.create_index("ix_missions_client_id", "missions", ["client_id"], unique=False)
    op.create_index("ix_missions_status", "missions", ["status"], unique=False)

    op.create_table(
        "mission_tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("mission_id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("agent_id", sa.String(), nullable=True),
        sa.Column("depends_on", sa.String(), nullable=True),
        sa.Column("status", missiontaskstatus, nullable=False, server_default="pending"),
        sa.Column("output_summary", sa.Text(), nullable=True),
        sa.Column("execution_id", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["execution_id"], ["executions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["mission_id"], ["missions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mission_tasks_mission_id", "mission_tasks", ["mission_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_mission_tasks_mission_id", table_name="mission_tasks")
    op.drop_table("mission_tasks")

    op.drop_index("ix_missions_status", table_name="missions")
    op.drop_index("ix_missions_client_id", table_name="missions")
    op.drop_index("ix_missions_org_id", table_name="missions")
    op.drop_table("missions")

    bind = op.get_bind()
    missiontaskstatus.drop(bind, checkfirst=True)
    missionstatus.drop(bind, checkfirst=True)

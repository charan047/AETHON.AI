"""add_evaluation_framework

Revision ID: d3a7e9b2c4f1
Revises: c9e2a1f4b6d8
Create Date: 2026-04-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "d3a7e9b2c4f1"
down_revision: Union[str, None] = "c9e2a1f4b6d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _index_exists(inspector, table_name: str, index_name: str) -> bool:
    if not _table_exists(inspector, table_name):
        return False
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    postgresql.ENUM("draft", "active", "archived", name="evalsuitestatus").create(bind, checkfirst=True)
    postgresql.ENUM(
        "exact_match",
        "contains",
        "regex",
        "llm_judge",
        "rouge_l",
        "semantic_similarity",
        "json_schema",
        "custom_function",
        name="scoringmethod",
    ).create(bind, checkfirst=True)
    postgresql.ENUM("pending", "running", "completed", "failed", name="evalrunstatus").create(bind, checkfirst=True)
    eval_suite_status = postgresql.ENUM("draft", "active", "archived", name="evalsuitestatus", create_type=False)
    scoring_method = postgresql.ENUM(
        "exact_match",
        "contains",
        "regex",
        "llm_judge",
        "rouge_l",
        "semantic_similarity",
        "json_schema",
        "custom_function",
        name="scoringmethod",
        create_type=False,
    )
    eval_run_status = postgresql.ENUM("pending", "running", "completed", "failed", name="evalrunstatus", create_type=False)

    if not _table_exists(inspector, "eval_suites"):
        op.create_table(
            "eval_suites",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("agent_id", sa.String(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", eval_suite_status, nullable=True),
            sa.Column("pass_threshold", sa.Float(), nullable=True),
            sa.Column("version", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(inspector, "eval_cases"):
        op.create_table(
            "eval_cases",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("suite_id", sa.String(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("input", sa.Text(), nullable=False),
            sa.Column("expected_output", sa.Text(), nullable=True),
            sa.Column("scoring_method", scoring_method, nullable=True),
            sa.Column("scoring_config", sa.Text(), nullable=True),
            sa.Column("weight", sa.Float(), nullable=True),
            sa.Column("tags", sa.String(length=500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["suite_id"], ["eval_suites.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(inspector, "eval_runs"):
        op.create_table(
            "eval_runs",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("suite_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("status", eval_run_status, nullable=True),
            sa.Column("triggered_by", sa.String(length=50), nullable=True),
            sa.Column("total_cases", sa.Integer(), nullable=True),
            sa.Column("passed_cases", sa.Integer(), nullable=True),
            sa.Column("failed_cases", sa.Integer(), nullable=True),
            sa.Column("error_cases", sa.Integer(), nullable=True),
            sa.Column("suite_score", sa.Float(), nullable=True),
            sa.Column("passed", sa.Boolean(), nullable=True),
            sa.Column("duration_seconds", sa.Integer(), nullable=True),
            sa.Column("total_cost_usd", sa.Float(), nullable=True),
            sa.Column("git_commit", sa.String(length=40), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["suite_id"], ["eval_suites.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(inspector, "eval_case_results"):
        op.create_table(
            "eval_case_results",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("run_id", sa.String(), nullable=False),
            sa.Column("case_id", sa.String(), nullable=False),
            sa.Column("actual_output", sa.Text(), nullable=True),
            sa.Column("score", sa.Float(), nullable=True),
            sa.Column("passed", sa.Boolean(), nullable=True),
            sa.Column("scoring_details", sa.Text(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("duration_seconds", sa.Float(), nullable=True),
            sa.Column("tokens_used", sa.Integer(), nullable=True),
            sa.Column("cost_usd", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["case_id"], ["eval_cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["run_id"], ["eval_runs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    if not _index_exists(inspector, "eval_case_results", "ix_eval_case_results_run_id"):
        op.create_index("ix_eval_case_results_run_id", "eval_case_results", ["run_id"])
    if not _index_exists(inspector, "marketplace_listings", "ix_marketplace_status_category_install"):
        op.create_index(
            "ix_marketplace_status_category_install",
            "marketplace_listings",
            ["status", "category", sa.text("install_count DESC")],
        )
    if not _index_exists(inspector, "marketplace_listings", "ix_marketplace_status_published"):
        op.create_index(
            "ix_marketplace_status_published",
            "marketplace_listings",
            ["status", sa.text("published_at DESC")],
        )
    if not _index_exists(inspector, "org_members", "ix_org_members_user"):
        op.create_index("ix_org_members_user", "org_members", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _index_exists(inspector, "marketplace_listings", "ix_marketplace_status_published"):
        op.drop_index("ix_marketplace_status_published", table_name="marketplace_listings")
    if _index_exists(inspector, "marketplace_listings", "ix_marketplace_status_category_install"):
        op.drop_index("ix_marketplace_status_category_install", table_name="marketplace_listings")
    if _index_exists(inspector, "eval_case_results", "ix_eval_case_results_run_id"):
        op.drop_index("ix_eval_case_results_run_id", table_name="eval_case_results")
    if _table_exists(inspector, "eval_case_results"):
        op.drop_table("eval_case_results")
    if _table_exists(inspector, "eval_runs"):
        op.drop_table("eval_runs")
    if _table_exists(inspector, "eval_cases"):
        op.drop_table("eval_cases")
    if _table_exists(inspector, "eval_suites"):
        op.drop_table("eval_suites")
    sa.Enum(name="evalrunstatus").drop(bind, checkfirst=True)
    sa.Enum(name="scoringmethod").drop(bind, checkfirst=True)
    sa.Enum(name="evalsuitestatus").drop(bind, checkfirst=True)

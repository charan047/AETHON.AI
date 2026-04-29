"""add_multi_tenancy_org_id

Revision ID: 4d8f0b2c6a91
Revises: 10012581a4c6
Create Date: 2026-04-28 00:00:00.000000
"""

from typing import Sequence, Union
import re
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "4d8f0b2c6a91"
down_revision: Union[str, None] = "10012581a4c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ORG_SCOPED_TABLES = [
    "agents",
    "workflows",
    "executions",
    "custom_tools",
    "eval_suites",
    "company_profiles",
    "user_integrations",
    "webhook_endpoints",
    "api_keys",
]


USER_SCOPED_TABLES = [
    "eval_suites",
    "company_profiles",
    "user_integrations",
    "webhook_endpoints",
    "api_keys",
]


GLOBAL_RESOURCE_TABLES = [
    "agents",
    "workflows",
    "custom_tools",
]


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if not _table_exists(inspector, table_name):
        return False
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _slug(email: str, used: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", email.split("@")[0].lower()).strip("-")[:50] or "my-company"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base[:44]}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    org_plan = sa.Enum("free", "solo", "team", "business", "enterprise", name="orgplan")
    org_member_role = sa.Enum("owner", "admin", "member", "viewer", name="orgmemberrole")
    org_plan.create(bind, checkfirst=True)
    org_member_role.create(bind, checkfirst=True)

    if not _table_exists(inspector, "organizations"):
        op.create_table(
            "organizations",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("slug", sa.String(length=100), nullable=False),
            sa.Column("plan", org_plan, nullable=True),
            sa.Column("owner_user_id", sa.String(), nullable=False),
            sa.Column("max_members", sa.Integer(), nullable=True),
            sa.Column("max_agents", sa.Integer(), nullable=True),
            sa.Column("max_workflows", sa.Integer(), nullable=True),
            sa.Column("max_monthly_executions", sa.Integer(), nullable=True),
            sa.Column("stripe_customer_id", sa.String(length=100), nullable=True),
            sa.Column("stripe_subscription_id", sa.String(length=100), nullable=True),
            sa.Column("billing_email", sa.String(length=255), nullable=True),
            sa.Column("monthly_budget_usd", sa.Float(), nullable=True),
            sa.Column("current_period_executions", sa.Integer(), nullable=True),
            sa.Column("timezone", sa.String(length=50), nullable=True),
            sa.Column("logo_url", sa.String(length=500), nullable=True),
            sa.Column("custom_domain", sa.String(length=255), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("slug"),
        )

    if not _table_exists(inspector, "org_members"):
        op.create_table(
            "org_members",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("role", org_member_role, nullable=True),
            sa.Column("invited_by_user_id", sa.String(), nullable=True),
            sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("org_id", "user_id", name="uq_org_member_user"),
        )
        op.create_index("ix_org_members_org_user", "org_members", ["org_id", "user_id"])
        op.create_index("ix_org_members_user", "org_members", ["user_id"])

    if not _table_exists(inspector, "org_invites"):
        op.create_table(
            "org_invites",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("role", org_member_role, nullable=True),
            sa.Column("token", sa.String(length=255), nullable=False),
            sa.Column("invited_by_user_id", sa.String(), nullable=False),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token"),
        )

    inspector = sa.inspect(bind)
    for table in ORG_SCOPED_TABLES:
        if _table_exists(inspector, table) and not _column_exists(inspector, table, "org_id"):
            op.add_column(table, sa.Column("org_id", sa.String(), nullable=True))

    users = bind.execute(sa.text("SELECT id, email FROM users")).fetchall()
    used_slugs = {
        row[0]
        for row in bind.execute(sa.text("SELECT slug FROM organizations")).fetchall()
    }
    user_orgs: dict[str, str] = {}

    for user in users:
        existing = bind.execute(
            sa.text("SELECT org_id FROM org_members WHERE user_id = :user_id ORDER BY joined_at LIMIT 1"),
            {"user_id": user.id},
        ).scalar()
        if existing:
            user_orgs[user.id] = existing
            continue

        org_id = str(uuid.uuid4())
        slug = _slug(user.email, used_slugs)
        bind.execute(
            sa.text(
                """
                INSERT INTO organizations (
                    id, name, slug, owner_user_id, plan,
                    max_members, max_agents, max_workflows, max_monthly_executions,
                    billing_email, monthly_budget_usd, current_period_executions,
                    timezone, is_active
                )
                VALUES (
                    :id, :name, :slug, :user_id, 'solo',
                    1, -1, -1, -1,
                    :email, 10.0, 0,
                    'UTC', true
                )
                """
            ),
            {"id": org_id, "name": "My Company", "slug": slug, "user_id": user.id, "email": user.email},
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO org_members (id, org_id, user_id, role)
                VALUES (:id, :org_id, :user_id, 'owner')
                """
            ),
            {"id": str(uuid.uuid4()), "org_id": org_id, "user_id": user.id},
        )
        user_orgs[user.id] = org_id

    first_org_id = next(iter(user_orgs.values()), None)

    for user_id, org_id in user_orgs.items():
        for table in USER_SCOPED_TABLES:
            if _table_exists(inspector, table) and _column_exists(inspector, table, "org_id"):
                bind.execute(
                    sa.text(f"UPDATE {table} SET org_id = :org_id WHERE user_id = :user_id AND org_id IS NULL"),
                    {"org_id": org_id, "user_id": user_id},
                )

    if first_org_id:
        for table in GLOBAL_RESOURCE_TABLES:
            if _table_exists(inspector, table) and _column_exists(inspector, table, "org_id"):
                bind.execute(
                    sa.text(f"UPDATE {table} SET org_id = :org_id WHERE org_id IS NULL"),
                    {"org_id": first_org_id},
                )

        if _table_exists(inspector, "workflows") and _table_exists(inspector, "executions"):
            bind.execute(
                sa.text(
                    """
                    UPDATE executions
                    SET org_id = workflows.org_id
                    FROM workflows
                    WHERE executions.workflow_id = workflows.id
                      AND executions.org_id IS NULL
                    """
                )
            )
            bind.execute(
                sa.text("UPDATE executions SET org_id = :org_id WHERE org_id IS NULL"),
                {"org_id": first_org_id},
            )

    for table in ORG_SCOPED_TABLES:
        if _table_exists(inspector, table) and _column_exists(inspector, table, "org_id"):
            op.create_foreign_key(
                f"fk_{table}_org_id_organizations",
                table,
                "organizations",
                ["org_id"],
                ["id"],
                ondelete="CASCADE",
            )
            op.alter_column(table, "org_id", nullable=False)

    if _table_exists(inspector, "company_profiles"):
        try:
            op.drop_constraint("company_profiles_user_id_key", "company_profiles", type_="unique")
        except Exception:
            pass
        try:
            op.create_unique_constraint("uq_company_profiles_org", "company_profiles", ["org_id"])
        except Exception:
            pass

    if _table_exists(inspector, "user_integrations"):
        try:
            op.drop_constraint("uq_user_integration_name", "user_integrations", type_="unique")
        except Exception:
            pass
        try:
            op.create_unique_constraint(
                "uq_org_user_integration_name",
                "user_integrations",
                ["org_id", "user_id", "integration_type", "name"],
            )
        except Exception:
            pass


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _table_exists(inspector, "company_profiles"):
        try:
            op.drop_constraint("uq_company_profiles_org", "company_profiles", type_="unique")
        except Exception:
            pass

    if _table_exists(inspector, "user_integrations"):
        try:
            op.drop_constraint("uq_org_user_integration_name", "user_integrations", type_="unique")
        except Exception:
            pass

    for table in reversed(ORG_SCOPED_TABLES):
        if _table_exists(inspector, table) and _column_exists(inspector, table, "org_id"):
            try:
                op.drop_constraint(f"fk_{table}_org_id_organizations", table, type_="foreignkey")
            except Exception:
                pass
            op.drop_column(table, "org_id")

    if _table_exists(inspector, "org_invites"):
        op.drop_table("org_invites")
    if _table_exists(inspector, "org_members"):
        op.drop_index("ix_org_members_user", table_name="org_members")
        op.drop_index("ix_org_members_org_user", table_name="org_members")
        op.drop_table("org_members")
    if _table_exists(inspector, "organizations"):
        op.drop_table("organizations")

    sa.Enum(name="orgmemberrole").drop(bind, checkfirst=True)
    sa.Enum(name="orgplan").drop(bind, checkfirst=True)

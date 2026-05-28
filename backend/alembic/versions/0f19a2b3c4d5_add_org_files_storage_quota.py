"""add_org_files_storage_quota

Revision ID: 0f19a2b3c4d5
Revises: f7b8c9d0e1a2
Create Date: 2026-05-27 22:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0f19a2b3c4d5"
down_revision: Union[str, None] = "f7b8c9d0e1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    filetype = postgresql.ENUM(
        "document",
        "pdf",
        "docx",
        "image",
        "markdown",
        "text",
        "other",
        name="filetype",
        create_type=False,
    )
    filestatus = postgresql.ENUM(
        "pending",
        "uploading",
        "ready",
        "deleted",
        "error",
        name="filestatus",
        create_type=False,
    )
    filetype.create(bind, checkfirst=True)
    filestatus.create(bind, checkfirst=True)

    if "org_files" not in existing_tables:
        op.create_table(
            "org_files",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=True),
            sa.Column("agent_id", sa.String(), nullable=True),
            sa.Column("execution_id", sa.String(), nullable=True),
            sa.Column("mission_id", sa.String(), nullable=True),
            sa.Column("name", sa.String(length=500), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("file_type", filetype, nullable=False),
            sa.Column("status", filestatus, nullable=False),
            sa.Column("storage_key", sa.String(length=1000), nullable=True),
            sa.Column("size_bytes", sa.BigInteger(), nullable=True),
            sa.Column("content_type", sa.String(length=200), nullable=True),
            sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("parent_file_id", sa.String(), nullable=True),
            sa.Column("is_latest", sa.Boolean(), nullable=False),
            sa.Column("collab_room", sa.String(length=255), nullable=True),
            sa.Column("yjs_storage_key", sa.String(length=1000), nullable=True),
            sa.Column("search_vector", postgresql.TSVECTOR(), nullable=True),
            sa.Column("extracted_text", sa.Text(), nullable=True),
            sa.Column("tags", sa.JSON(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_accessed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["execution_id"], ["executions.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["mission_id"], ["missions.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["parent_file_id"], ["org_files.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("collab_room"),
        )

    if "org_files" in set(sa.inspect(bind).get_table_names()):
        existing_indexes = {
            idx["name"] for idx in sa.inspect(bind).get_indexes("org_files")
        }
        if "ix_orgfiles_org_client" not in existing_indexes:
            op.create_index("ix_orgfiles_org_client", "org_files", ["org_id", "client_id"], unique=False)
        if "ix_orgfiles_org_status" not in existing_indexes:
            op.create_index("ix_orgfiles_org_status", "org_files", ["org_id", "status"], unique=False)
        if "ix_orgfiles_search" not in existing_indexes:
            op.create_index(
                "ix_orgfiles_search",
                "org_files",
                ["search_vector"],
                unique=False,
                postgresql_using="gin",
            )

    if "org_storage_quota" not in set(sa.inspect(bind).get_table_names()):
        op.create_table(
            "org_storage_quota",
            sa.Column("org_id", sa.String(), nullable=False),
            sa.Column("used_bytes", sa.BigInteger(), nullable=False),
            sa.Column("quota_bytes", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("org_id"),
        )


def downgrade() -> None:
    op.drop_table("org_storage_quota")
    op.drop_index("ix_orgfiles_search", table_name="org_files", postgresql_using="gin")
    op.drop_index("ix_orgfiles_org_status", table_name="org_files")
    op.drop_index("ix_orgfiles_org_client", table_name="org_files")
    op.drop_table("org_files")
    sa.Enum(name="filestatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="filetype").drop(op.get_bind(), checkfirst=True)

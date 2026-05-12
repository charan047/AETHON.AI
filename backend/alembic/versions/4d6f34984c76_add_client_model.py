"""add_client_model

Revision ID: 4d6f34984c76
Revises: 6467d81a45e4
Create Date: 2026-05-11 11:19:34.468447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4d6f34984c76'
down_revision: Union[str, None] = '6467d81a45e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('clients',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('org_id', sa.String(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('company_name', sa.String(length=255), nullable=True),
    sa.Column('contact_email', sa.String(length=255), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('service_type', sa.String(length=100), nullable=True),
    sa.Column('status', sa.Enum('active', 'paused', 'completed', name='clientstatus'), nullable=False),
    sa.Column('portal_token', sa.String(length=64), nullable=True),
    sa.Column('portal_enabled', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('color', sa.String(length=7), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('portal_token')
    )
    op.create_index('ix_clients_org_id', 'clients', ['org_id'], unique=False)
    op.create_index('ix_clients_org_status', 'clients', ['org_id', 'status'], unique=False)
    op.add_column('agents', sa.Column('client_id', sa.String(), nullable=True))
    op.create_index('ix_agents_client_id', 'agents', ['client_id'], unique=False)
    op.create_foreign_key(
        'fk_agents_client_id_clients',
        'agents',
        'clients',
        ['client_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.add_column('executions', sa.Column('client_id', sa.String(), nullable=True))
    op.create_index('ix_executions_client_id', 'executions', ['client_id'], unique=False)
    op.create_foreign_key(
        'fk_executions_client_id_clients',
        'executions',
        'clients',
        ['client_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_executions_client_id_clients', 'executions', type_='foreignkey')
    op.drop_index('ix_executions_client_id', table_name='executions')
    op.drop_column('executions', 'client_id')
    op.drop_constraint('fk_agents_client_id_clients', 'agents', type_='foreignkey')
    op.drop_index('ix_agents_client_id', table_name='agents')
    op.drop_column('agents', 'client_id')
    op.drop_index('ix_clients_org_status', table_name='clients')
    op.drop_index('ix_clients_org_id', table_name='clients')
    op.drop_table('clients')

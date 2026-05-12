"""remove_stripe_open_source

Revision ID: 6467d81a45e4
Revises: f4d6e8a1b2c3
Create Date: 2026-05-11 11:11:01.681928

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '6467d81a45e4'
down_revision: Union[str, None] = 'f4d6e8a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'organizations',
        'plan',
        existing_type=postgresql.ENUM('free', 'solo', 'team', 'business', 'enterprise', name='orgplan'),
        type_=sa.String(length=20),
        postgresql_using='plan::text',
        existing_nullable=True,
    )
    op.execute("UPDATE organizations SET plan = 'open_source'")
    op.alter_column('organizations', 'plan',
               existing_type=sa.String(length=20),
               nullable=False,
               server_default='open_source')
    op.drop_column('organizations', 'billing_email')
    op.drop_column('organizations', 'cancellation_date')
    op.drop_column('organizations', 'stripe_trial_end')
    op.drop_column('organizations', 'stripe_subscription_status')
    op.drop_column('organizations', 'stripe_metered_subscription_item_id')
    op.drop_column('organizations', 'stripe_customer_id')
    op.drop_column('organizations', 'stripe_current_period_end')
    op.drop_column('organizations', 'stripe_subscription_id')
    op.execute("DROP TYPE IF EXISTS orgplan")


def downgrade() -> None:
    orgplan = postgresql.ENUM('free', 'solo', 'team', 'business', 'enterprise', name='orgplan')
    orgplan.create(op.get_bind(), checkfirst=True)
    op.execute("UPDATE organizations SET plan = 'free' WHERE plan = 'open_source'")
    op.alter_column(
        'organizations',
        'plan',
        existing_type=sa.String(length=20),
        type_=orgplan,
        postgresql_using='plan::orgplan',
        existing_nullable=False,
        server_default='free',
    )
    op.add_column('organizations', sa.Column('stripe_subscription_id', sa.VARCHAR(length=100), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('stripe_current_period_end', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('stripe_customer_id', sa.VARCHAR(length=100), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('stripe_metered_subscription_item_id', sa.VARCHAR(length=100), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('stripe_subscription_status', sa.VARCHAR(length=50), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('stripe_trial_end', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('cancellation_date', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))
    op.add_column('organizations', sa.Column('billing_email', sa.VARCHAR(length=255), autoincrement=False, nullable=True))

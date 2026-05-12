"""phase9_agent_identity_memory

Revision ID: d4ce33e34aef
Revises: c2d3e4f5a6b7
Create Date: 2026-05-05 19:30:25.127571

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4ce33e34aef'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('agent_roles',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('seniority_level', sa.Integer(), nullable=False),
    sa.Column('department_type', sa.String(length=50), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('color', sa.String(length=7), nullable=False),
    sa.Column('icon', sa.String(length=10), nullable=False),
    sa.Column('is_system_role', sa.Boolean(), nullable=True),
    sa.Column('default_tools', sa.JSON(), nullable=True),
    sa.Column('default_max_iterations', sa.Integer(), nullable=True),
    sa.Column('default_autonomy_level', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('departments',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('org_id', sa.String(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('department_type', sa.String(length=50), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('color', sa.String(length=7), nullable=True),
    sa.Column('icon', sa.String(length=10), nullable=True),
    sa.Column('head_agent_id', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['head_agent_id'], ['agents.id'], ),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_departments_org_id', 'departments', ['org_id'], unique=False)
    op.create_table('agent_contracts',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('agent_id', sa.String(), nullable=False),
    sa.Column('responsibilities', sa.JSON(), nullable=True),
    sa.Column('allowed_tools', sa.JSON(), nullable=True),
    sa.Column('forbidden_tools', sa.JSON(), nullable=True),
    sa.Column('forbidden_actions', sa.JSON(), nullable=True),
    sa.Column('requires_approval_for', sa.JSON(), nullable=True),
    sa.Column('escalates_to_role', sa.String(length=100), nullable=True),
    sa.Column('escalation_triggers', sa.JSON(), nullable=True),
    sa.Column('max_tokens_per_task', sa.Integer(), nullable=True),
    sa.Column('max_cost_per_task_cents', sa.Integer(), nullable=True),
    sa.Column('requires_review_from', sa.JSON(), nullable=True),
    sa.Column('autonomy_level', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('agent_id')
    )
    op.create_index('ix_agent_contracts_agent_id', 'agent_contracts', ['agent_id'], unique=False)
    op.create_table('agent_trust_scores',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('agent_id', sa.String(), nullable=False),
    sa.Column('task_success_rate', sa.Float(), nullable=True),
    sa.Column('review_pass_rate', sa.Float(), nullable=True),
    sa.Column('cost_efficiency', sa.Float(), nullable=True),
    sa.Column('on_time_rate', sa.Float(), nullable=True),
    sa.Column('risky_action_rate', sa.Float(), nullable=True),
    sa.Column('overall_score', sa.Float(), nullable=True),
    sa.Column('skill_scores', sa.JSON(), nullable=True),
    sa.Column('trajectory', sa.String(length=20), nullable=True),
    sa.Column('trajectory_delta', sa.Float(), nullable=True),
    sa.Column('total_tasks', sa.Integer(), nullable=True),
    sa.Column('successful_tasks', sa.Integer(), nullable=True),
    sa.Column('failed_tasks', sa.Integer(), nullable=True),
    sa.Column('total_reviews', sa.Integer(), nullable=True),
    sa.Column('passed_reviews', sa.Integer(), nullable=True),
    sa.Column('risky_actions_attempted', sa.Integer(), nullable=True),
    sa.Column('risky_actions_blocked', sa.Integer(), nullable=True),
    sa.Column('human_overrides', sa.Integer(), nullable=True),
    sa.Column('autonomy_history', sa.JSON(), nullable=True),
    sa.Column('last_calculated', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('agent_id')
    )
    op.create_index('ix_agent_trust_scores_agent_id', 'agent_trust_scores', ['agent_id'], unique=False)
    op.create_table('agent_memory_entries',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('agent_id', sa.String(), nullable=False),
    sa.Column('org_id', sa.String(), nullable=False),
    sa.Column('mem0_memory_id', sa.String(length=255), nullable=False),
    sa.Column('content_preview', sa.String(length=500), nullable=True),
    sa.Column('memory_type', sa.String(length=50), nullable=True),
    sa.Column('tags', sa.JSON(), nullable=True),
    sa.Column('importance_score', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_agent_memory_entries_agent_id', 'agent_memory_entries', ['agent_id'], unique=False)
    op.create_index('ix_agent_memory_entries_org_id', 'agent_memory_entries', ['org_id'], unique=False)
    op.create_table('agent_approval_requests',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('org_id', sa.String(), nullable=False),
    sa.Column('requesting_agent_id', sa.String(), nullable=False),
    sa.Column('execution_id', sa.String(), nullable=True),
    sa.Column('approval_type', sa.String(length=50), nullable=False),
    sa.Column('title', sa.String(length=500), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('risk_level', sa.String(length=20), nullable=False),
    sa.Column('affected_files', sa.JSON(), nullable=True),
    sa.Column('affected_systems', sa.JSON(), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('expected_impact', sa.Text(), nullable=True),
    sa.Column('rollback_plan', sa.Text(), nullable=True),
    sa.Column('estimated_cost_cents', sa.Integer(), nullable=True),
    sa.Column('ai_recommendation', sa.String(length=20), nullable=True),
    sa.Column('ai_analysis', sa.Text(), nullable=True),
    sa.Column('ai_risk_factors', sa.JSON(), nullable=True),
    sa.Column('ai_analyzed_at', sa.DateTime(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=True),
    sa.Column('decided_by', sa.String(), nullable=True),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.Column('decision_note', sa.Text(), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['execution_id'], ['executions.id'], ),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requesting_agent_id'], ['agents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_approval_requests_agent', 'agent_approval_requests', ['requesting_agent_id'], unique=False)
    op.create_index('ix_approval_requests_org_status', 'agent_approval_requests', ['org_id', 'status'], unique=False)
    op.add_column('agents', sa.Column('persona_name', sa.String(length=100), nullable=True))
    op.add_column('agents', sa.Column('current_status', sa.String(length=50), nullable=True, server_default=sa.text("'idle'")))
    op.add_column('agents', sa.Column('current_task_summary', sa.String(length=500), nullable=True))
    op.add_column('agents', sa.Column('department_id', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('reports_to_agent_id', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('total_tasks_completed', sa.Integer(), nullable=True, server_default=sa.text("0")))
    op.execute("UPDATE agents SET current_status = 'idle' WHERE current_status IS NULL")
    op.execute("UPDATE agents SET total_tasks_completed = 0 WHERE total_tasks_completed IS NULL")
    op.create_foreign_key('fk_agents_department_id', 'agents', 'departments', ['department_id'], ['id'])
    op.create_foreign_key('fk_agents_reports_to_agent_id', 'agents', 'agents', ['reports_to_agent_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_agents_reports_to_agent_id', 'agents', type_='foreignkey')
    op.drop_constraint('fk_agents_department_id', 'agents', type_='foreignkey')
    op.drop_column('agents', 'total_tasks_completed')
    op.drop_column('agents', 'reports_to_agent_id')
    op.drop_column('agents', 'department_id')
    op.drop_column('agents', 'current_task_summary')
    op.drop_column('agents', 'current_status')
    op.drop_column('agents', 'persona_name')
    op.drop_index('ix_approval_requests_org_status', table_name='agent_approval_requests')
    op.drop_index('ix_approval_requests_agent', table_name='agent_approval_requests')
    op.drop_table('agent_approval_requests')
    op.drop_index('ix_agent_memory_entries_org_id', table_name='agent_memory_entries')
    op.drop_index('ix_agent_memory_entries_agent_id', table_name='agent_memory_entries')
    op.drop_table('agent_memory_entries')
    op.drop_index('ix_agent_trust_scores_agent_id', table_name='agent_trust_scores')
    op.drop_table('agent_trust_scores')
    op.drop_index('ix_agent_contracts_agent_id', table_name='agent_contracts')
    op.drop_table('agent_contracts')
    op.drop_index('ix_departments_org_id', table_name='departments')
    op.drop_table('departments')
    op.drop_table('agent_roles')

import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Boolean, Integer, Float, DateTime, JSON, ForeignKey, Enum as SAEnum, UniqueConstraint, Index, func
from sqlalchemy.orm import relationship
from uuid import uuid4

from database.db import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)
    description = Column(Text, default="")
    system_prompt = Column(Text, nullable=False)
    model = Column(String, default="llama-3.3-70b-versatile")
    tools = Column(JSON, default=list)
    memory_enabled = Column(Boolean, default=True)
    memory_window = Column(Integer, default=10)
    max_tokens = Column(Integer, default=2000)
    temperature = Column(Float, default=0.7)
    max_iterations = Column(Integer, default=10)
    timeout = Column(Integer, default=120)
    max_retries = Column(Integer, default=3, nullable=False)
    retry_delay_seconds = Column(Integer, default=5, nullable=False)
    retry_backoff_multiplier = Column(Float, default=2.0, nullable=False)
    retry_on_timeout = Column(Boolean, default=True, nullable=False)
    telegram_enabled = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AgentMemoryConfig(Base):
    __tablename__ = "agent_memory_configs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), unique=True)
    memory_enabled = Column(Boolean, default=True)
    max_memories_per_query = Column(Integer, default=5)
    memory_window_days = Column(Integer, default=30)
    auto_summarize = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class UserRole(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    timed_out = "timed_out"


class ExecutionStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    waiting_approval = "waiting_approval"
    rejected = "rejected"
    timed_out = "timed_out"


class IntegrationType(str, enum.Enum):
    github = "github"
    email_smtp = "email_smtp"
    slack = "slack"
    notion = "notion"
    linear = "linear"


class FeedbackType(str, enum.Enum):
    approved = "approved"
    rejected = "rejected"
    edited = "edited"
    flagged = "flagged"


class NotificationPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    urgent = "urgent"


class EvalSuiteStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    archived = "archived"


class EvalRunStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ScoringMethod(str, enum.Enum):
    exact_match = "exact_match"
    contains = "contains"
    regex = "regex"
    llm_judge = "llm_judge"
    rouge_l = "rouge_l"
    semantic_similarity = "semantic_similarity"
    json_schema = "json_schema"
    custom_function = "custom_function"


class OrgPlan(str, enum.Enum):
    free = "free"
    solo = "solo"
    team = "team"
    business = "business"
    enterprise = "enterprise"


class OrgMemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"


class MarketplaceCategory(str, enum.Enum):
    productivity = "productivity"
    development = "development"
    marketing = "marketing"
    finance = "finance"
    customer_support = "customer_support"
    research = "research"
    hr = "hr"
    operations = "operations"
    data = "data"
    other = "other"


class ListingType(str, enum.Enum):
    agent = "agent"
    workflow = "workflow"
    eval_suite = "eval_suite"


class ListingStatus(str, enum.Enum):
    draft = "draft"
    pending = "pending"
    published = "published"
    rejected = "rejected"
    archived = "archived"


class Workflow(Base):
    __tablename__ = "workflows"

    # Workflow nodes are stored as JSON. HITL approval nodes use this schema:
    # {
    #   "id": "node_1",
    #   "type": "approval",
    #   "data": {
    #     "title": "Review before deploying",
    #     "description": "Please review the generated code before it continues",
    #     "timeout_hours": 24,
    #     "auto_approve_on_timeout": false
    #   }
    # }
    # Agent nodes can also pause after the previous node with:
    # {"hitl_enabled": true, "hitl_config": {"title": "...", "timeout_hours": 24}}
    # ParallelGroup nodes fan out to multiple agents and merge their outputs:
    # {
    #   "id": "parallel_group_1",
    #   "type": "parallel_group",
    #   "data": {
    #     "label": "Research Phase",
    #     "agent_ids": ["agent_id_1", "agent_id_2", "agent_id_3"],
    #     "merge_strategy": "concatenate",
    #     "merge_separator": "\n\n---\n\n"
    #   }
    # }
    # merge_strategy values: concatenate, summarize, first_success.
    # Condition nodes route execution based on the previous output:
    # {
    #   "id": "condition_1",
    #   "type": "condition",
    #   "data": {
    #     "label": "Check sentiment",
    #     "evaluation_mode": "llm",
    #     "conditions": [
    #       {
    #         "id": "cond_positive",
    #         "label": "Positive",
    #         "mode": "llm",
    #         "prompt": "Does this text express a positive outcome? Answer only YES or NO.",
    #         "target_node_id": "agent_node_3"
    #       },
    #       {
    #         "id": "cond_negative",
    #         "label": "Negative",
    #         "mode": "contains",
    #         "value": "error",
    #         "target_node_id": "agent_node_4"
    #       }
    #     ],
    #     "default_target_node_id": "agent_node_5"
    #   }
    # }

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    nodes = Column(JSON, default=list)
    edges = Column(JSON, default=list)
    status = Column(String, default="draft")
    trigger = Column(String, default="manual")
    schedule = Column(String, nullable=True)
    template_id = Column(String, nullable=True)
    execution_mode = Column(String, default="sequential")
    orchestration_prompt = Column(Text, default="")
    max_cycles = Column(Integer, default=10, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    executions = relationship("Execution", back_populates="workflow", cascade="all, delete-orphan")


class Execution(Base):
    __tablename__ = "executions"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workflow_id = Column(String, ForeignKey("workflows.id"), nullable=False)
    trigger = Column(String, default="manual")
    status = Column(
        SAEnum(
            ExecutionStatus,
            values_callable=lambda values: [item.value for item in values],
            name="executionstatus",
        ),
        default=ExecutionStatus.pending,
    )
    input_message = Column(Text, default="")
    output_message = Column(Text, default="")
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    token_count = Column(Integer, default=0)
    cost = Column(Float, default=0.0)
    error = Column(Text, nullable=True)

    workflow = relationship("Workflow", back_populates="executions")
    messages = relationship("Message", back_populates="execution", cascade="all, delete-orphan")


class CustomTool(Base):
    __tablename__ = "custom_tools"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False, unique=True)   # snake_case — used as LangChain tool name
    description = Column(Text, nullable=False)           # shown to LLM to decide when to use it
    code = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    execution_id = Column(String, ForeignKey("executions.id"), nullable=False)
    from_agent = Column(String, nullable=False)
    to_agent = Column(String, nullable=True)
    content = Column(Text, nullable=False)
    role = Column(String, default="assistant")
    token_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)
    msg_metadata = Column(JSON, default=dict)

    execution = relationship("Execution", back_populates="messages")


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(SAEnum(UserRole), default=UserRole.editor, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    plan = Column(
        SAEnum(
            OrgPlan,
            values_callable=lambda values: [item.value for item in values],
            name="orgplan",
        ),
        default=OrgPlan.free,
    )
    owner_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    max_members = Column(Integer, default=1)
    max_agents = Column(Integer, default=3)
    max_workflows = Column(Integer, default=5)
    max_monthly_executions = Column(Integer, default=100)
    stripe_customer_id = Column(String(100), nullable=True)
    stripe_subscription_id = Column(String(100), nullable=True)
    billing_email = Column(String(255), nullable=True)
    monthly_budget_usd = Column(Float, default=10.0)
    current_period_executions = Column(Integer, default=0)
    timezone = Column(String(50), default="UTC")
    logo_url = Column(String(500), nullable=True)
    custom_domain = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class OrgMember(Base):
    __tablename__ = "org_members"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id", name="uq_org_member_user"),
        Index("ix_org_members_org_user", "org_id", "user_id"),
        Index("ix_org_members_user", "user_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(
        SAEnum(
            OrgMemberRole,
            values_callable=lambda values: [item.value for item in values],
            name="orgmemberrole",
        ),
        default=OrgMemberRole.member,
    )
    invited_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())


class OrgInvite(Base):
    __tablename__ = "org_invites"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    email = Column(String(255), nullable=False)
    role = Column(
        SAEnum(
            OrgMemberRole,
            values_callable=lambda values: [item.value for item in values],
            name="orgmemberrole",
        ),
        default=OrgMemberRole.member,
    )
    token = Column(String(255), unique=True, nullable=False)
    invited_by_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    key_hash = Column(String(255), nullable=False)
    key_prefix = Column(String(10), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserIntegration(Base):
    __tablename__ = "user_integrations"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id", "integration_type", "name", name="uq_org_user_integration_name"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    integration_type = Column(SAEnum(IntegrationType), nullable=False)
    name = Column(String(100), nullable=False)
    config = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    last_tested_at = Column(DateTime(timezone=True), nullable=True)
    last_test_result = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentFeedback(Base):
    __tablename__ = "agent_feedback"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    execution_id = Column(String, ForeignKey("executions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    feedback_type = Column(SAEnum(FeedbackType), nullable=False)
    original_output = Column(Text, nullable=False)
    edited_output = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)
    task_description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentReputation(Base):
    __tablename__ = "agent_reputation"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), unique=True)
    total_tasks = Column(Integer, default=0)
    approved_count = Column(Integer, default=0)
    rejected_count = Column(Integer, default=0)
    edited_count = Column(Integer, default=0)
    approval_rate = Column(Float, default=0.0)
    avg_edit_distance = Column(Float, default=0.0)
    specializations = Column(Text, nullable=True)
    learning_notes = Column(Text, nullable=True)
    last_updated = Column(DateTime(timezone=True), server_default=func.now())


class EvalSuite(Base):
    __tablename__ = "eval_suites"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        SAEnum(
            EvalSuiteStatus,
            values_callable=lambda values: [item.value for item in values],
            name="evalsuitestatus",
        ),
        default=EvalSuiteStatus.draft,
    )
    pass_threshold = Column(Float, default=0.8)
    version = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class EvalCase(Base):
    __tablename__ = "eval_cases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    suite_id = Column(String, ForeignKey("eval_suites.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    input = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=True)
    scoring_method = Column(
        SAEnum(
            ScoringMethod,
            values_callable=lambda values: [item.value for item in values],
            name="scoringmethod",
        ),
        default=ScoringMethod.llm_judge,
    )
    scoring_config = Column(Text, nullable=True)
    weight = Column(Float, default=1.0)
    tags = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    suite_id = Column(String, ForeignKey("eval_suites.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    status = Column(
        SAEnum(
            EvalRunStatus,
            values_callable=lambda values: [item.value for item in values],
            name="evalrunstatus",
        ),
        default=EvalRunStatus.pending,
    )
    triggered_by = Column(String(50), default="manual")
    total_cases = Column(Integer, default=0)
    passed_cases = Column(Integer, default=0)
    failed_cases = Column(Integer, default=0)
    error_cases = Column(Integer, default=0)
    suite_score = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    total_cost_usd = Column(Float, default=0.0)
    git_commit = Column(String(40), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class EvalCaseResult(Base):
    __tablename__ = "eval_case_results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String, ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False)
    case_id = Column(String, ForeignKey("eval_cases.id", ondelete="CASCADE"), nullable=False)
    actual_output = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    scoring_details = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    tokens_used = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ToolCallLog(Base):
    __tablename__ = "tool_call_logs"
    __table_args__ = (
        Index("ix_tool_call_logs_user_created", "user_id", "created_at"),
        Index("ix_tool_call_logs_tool_created", "tool_name", "created_at"),
        Index("ix_tool_call_logs_execution_id", "execution_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    execution_id = Column(String, ForeignKey("executions.id", ondelete="SET NULL"), nullable=True)
    tool_name = Column(String(100), nullable=False)
    function_name = Column(String(100), nullable=False)
    duration_ms = Column(Integer, nullable=False)
    success = Column(Boolean, nullable=False)
    error_message = Column(Text, nullable=True)
    input_preview = Column(String(500), nullable=True)
    output_preview = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ExecutionCostLog(Base):
    __tablename__ = "execution_cost_logs"
    __table_args__ = (
        Index("ix_execution_cost_logs_user_created", "user_id", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    execution_id = Column(String, ForeignKey("executions.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    model = Column(String(100), nullable=False)
    input_tokens = Column(Integer, nullable=False)
    output_tokens = Column(Integer, nullable=False)
    cost_usd = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InAppNotification(Base):
    __tablename__ = "in_app_notifications"
    __table_args__ = (
        Index("ix_in_app_notifications_user_unread_created", "user_id", "is_read", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id"), nullable=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    priority = Column(
        SAEnum(
            NotificationPriority,
            values_callable=lambda values: [item.value for item in values],
            name="notificationpriority",
        ),
        default=NotificationPriority.normal,
    )
    is_read = Column(Boolean, default=False)
    action_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_id = Column(String, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    endpoint_path = Column(String(255), unique=True, nullable=False)
    source = Column(String(50), nullable=False)
    signing_secret = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    trigger_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    definition = Column(Text, nullable=False)
    changelog = Column(String(500), nullable=True)
    created_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("workflow_id", "version_number", name="uq_workflow_version_number"),
        Index("ix_workflow_versions_workflow_version_desc", workflow_id, version_number.desc()),
    )


class CompanyProfile(Base):
    __tablename__ = "company_profiles"
    __table_args__ = (
        UniqueConstraint("org_id", name="uq_company_profiles_org"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    company_name = Column(String(255), nullable=False)
    mission = Column(Text, nullable=True)
    industry = Column(String(100), nullable=True)
    stage = Column(String(50), nullable=True)
    monthly_revenue = Column(Integer, default=0, nullable=False)
    monthly_budget_usd = Column(Float, default=50.0, nullable=False)
    runway_months = Column(Integer, nullable=True)
    primary_tech_stack = Column(Text, nullable=True)
    goals = Column(Text, nullable=True)
    onboarding_complete = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class HumanApprovalRequest(Base):
    __tablename__ = "human_approval_requests"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String, ForeignKey("workflows.id", ondelete="CASCADE"))
    execution_id = Column(String, ForeignKey("executions.id", ondelete="CASCADE"))
    node_id = Column(String(100), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    context_data = Column(Text, nullable=True)
    status = Column(SAEnum(ApprovalStatus), default=ApprovalStatus.pending)
    requested_by_agent_id = Column(String, ForeignKey("agents.id"), nullable=True)
    reviewed_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    reviewer_comment = Column(Text, nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    resume_token = Column(String(255), unique=True, nullable=False)


class MarketplaceListing(Base):
    __tablename__ = "marketplace_listings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    publisher_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    publisher_org_id = Column(String, ForeignKey("organizations.id"), nullable=True)
    listing_type = Column(
        SAEnum(
            ListingType,
            values_callable=lambda values: [item.value for item in values],
            name="listingtype",
        ),
        nullable=False,
    )
    category = Column(
        SAEnum(
            MarketplaceCategory,
            values_callable=lambda values: [item.value for item in values],
            name="marketplacecategory",
        ),
        nullable=False,
    )
    status = Column(
        SAEnum(
            ListingStatus,
            values_callable=lambda values: [item.value for item in values],
            name="listingstatus",
        ),
        default=ListingStatus.draft,
    )
    name = Column(String(255), nullable=False)
    slug = Column(String(255), unique=True, nullable=False)
    tagline = Column(String(500), nullable=False)
    description = Column(Text, nullable=False)
    readme = Column(Text, nullable=True)
    template_data = Column(Text, nullable=False)
    tags = Column(String(500), nullable=True)
    preview_image_url = Column(String(500), nullable=True)
    demo_video_url = Column(String(500), nullable=True)
    source_url = Column(String(500), nullable=True)
    install_count = Column(Integer, default=0)
    rating_avg = Column(Float, default=0.0)
    rating_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    is_free = Column(Boolean, default=True)
    price_usd = Column(Float, default=0.0)
    version = Column(String(20), default="1.0.0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    published_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_marketplace_listings_status_category", "status", "category"),
        Index("ix_marketplace_listings_install_count_desc", install_count.desc()),
        Index("ix_marketplace_listings_rating_avg_desc", rating_avg.desc()),
    )


class MarketplaceInstall(Base):
    __tablename__ = "marketplace_installs"
    __table_args__ = (
        UniqueConstraint("listing_id", "installer_org_id", name="uq_marketplace_install_listing_org"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    listing_id = Column(String, ForeignKey("marketplace_listings.id"), nullable=False)
    installer_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    installer_org_id = Column(String, ForeignKey("organizations.id"), nullable=False)
    installed_resource_id = Column(String, nullable=True)
    installed_at = Column(DateTime(timezone=True), server_default=func.now())


class MarketplaceReview(Base):
    __tablename__ = "marketplace_reviews"
    __table_args__ = (
        UniqueConstraint("listing_id", "reviewer_user_id", name="uq_marketplace_review_listing_user"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    listing_id = Column(String, ForeignKey("marketplace_listings.id", ondelete="CASCADE"), nullable=False)
    reviewer_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)
    title = Column(String(255), nullable=True)
    body = Column(Text, nullable=True)
    helpful_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

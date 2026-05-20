import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Boolean, Integer, Float, DateTime, JSON, ForeignKey, Enum as SAEnum, UniqueConstraint, Index, func, text
from sqlalchemy.orm import relationship
from uuid import uuid4

from database.db import Base


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        Index("ix_agents_client_id", "client_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    persona_name = Column(String(100), nullable=True)
    role = Column(String, nullable=False)
    description = Column(Text, default="")
    system_prompt = Column(Text, nullable=False)
    model = Column(String, default="llama-3.1-8b-instant")
    model_config_id = Column(String, ForeignKey("model_configs.id", ondelete="SET NULL"), nullable=True)
    role_slug = Column(String(100), nullable=True)
    seniority_level = Column(Integer, default=1)
    autonomy_level = Column(String(50), default="supervised")
    trust_score = Column(Float, default=50.0)
    current_status = Column(String(50), default="idle")
    current_task_summary = Column(String(500), nullable=True)
    department_id = Column(String, ForeignKey("departments.id"), nullable=True)
    reports_to_agent_id = Column(String, ForeignKey("agents.id"), nullable=True)
    total_tasks_completed = Column(Integer, default=0)
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
    client_id = Column(String, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    installed_from_listing_id = Column(String, ForeignKey("marketplace_listings.id"), nullable=True)
    created_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    model_config = relationship("ModelConfig", back_populates="agents")


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
    pending_review = "pending_review"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    waiting_approval = "waiting_approval"
    rejected = "rejected"
    timed_out = "timed_out"


class MissionStatus(str, enum.Enum):
    planning = "planning"
    active = "active"
    paused = "paused"
    completed = "completed"
    failed = "failed"


class MissionTaskStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    skipped = "skipped"


class A2ATaskStatus(str, enum.Enum):
    submitted = "submitted"
    working = "working"
    input_required = "input-required"
    completed = "completed"
    failed = "failed"


class A2ATaskDirection(str, enum.Enum):
    incoming = "incoming"
    outgoing = "outgoing"


class IntegrationType(str, enum.Enum):
    github = "github"
    gmail = "gmail"
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


class OrgMemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"


class AuditAction(str, enum.Enum):
    user_login = "user_login"
    user_login_failed = "user_login_failed"
    user_registered = "user_registered"
    api_key_created = "api_key_created"
    api_key_revoked = "api_key_revoked"
    agent_deleted = "agent_deleted"
    workflow_deleted = "workflow_deleted"
    org_member_removed = "org_member_removed"
    org_member_role_changed = "org_member_role_changed"
    hitl_approved = "hitl_approved"
    hitl_rejected = "hitl_rejected"
    marketplace_published = "marketplace_published"
    data_exported = "data_exported"
    model_added = "model_added"
    model_set_default = "model_set_default"
    agent_model_changed = "agent_model_changed"
    approval_requested = "approval_requested"
    external_agent_call = "external_agent_call"


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
    tool_config = "tool_config"
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
    schedule_enabled = Column(Boolean, default=False, nullable=False)
    schedule_timezone = Column(String(64), default="UTC", nullable=False)
    last_run_at = Column(DateTime, nullable=True)
    requires_review = Column(Boolean, default=False, nullable=False)
    input_template = Column(Text, default="")
    input_variables = Column(JSON, default=list)
    configured_inputs = Column(JSON, default=dict)
    template_id = Column(String, nullable=True)
    installed_from_listing_id = Column(String, ForeignKey("marketplace_listings.id"), nullable=True)
    created_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    execution_mode = Column(String, default="sequential")
    orchestration_prompt = Column(Text, default="")
    max_cycles = Column(Integer, default=10, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    executions = relationship("Execution", back_populates="workflow", cascade="all, delete-orphan")


class ModelConfig(Base):
    __tablename__ = "model_configs"
    __table_args__ = (
        Index("ix_model_configs_org_id", "org_id"),
        Index("ix_model_configs_org_default", "org_id", "is_default"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String(50), nullable=False)
    model_id = Column(String(200), nullable=False)
    display_name = Column(String(200), nullable=False)
    api_key_encrypted = Column(Text, nullable=True)
    base_url = Column(String(500), nullable=True)
    context_window = Column(Integer, nullable=True)
    supports_tools = Column(Boolean, default=True)
    supports_vision = Column(Boolean, default=False)
    cost_per_million_input_tokens = Column(Float, nullable=True)
    cost_per_million_output_tokens = Column(Float, nullable=True)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    test_status = Column(String(20), nullable=True)
    test_error = Column(Text, nullable=True)
    last_tested_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agents = relationship("Agent", back_populates="model_config")


class Execution(Base):
    __tablename__ = "executions"
    __table_args__ = (
        Index("ix_executions_client_id", "client_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workflow_id = Column(String, ForeignKey("workflows.id"), nullable=False)
    client_id = Column(String, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    parent_execution_id = Column(
        String,
        ForeignKey("executions.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    revision_number = Column(Integer, default=1, nullable=False)
    ceo_feedback = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    token_count = Column(Integer, default=0)
    cost = Column(Float, default=0.0)
    error = Column(Text, nullable=True)
    warning = Column(Text, nullable=True)
    max_runtime_seconds = Column(Integer, default=3600, nullable=False)
    is_demo = Column(Boolean, default=False, nullable=False)
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_note = Column(Text, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    delivery_method = Column(String(50), nullable=True)
    delivery_target = Column(String(500), nullable=True)

    workflow = relationship("Workflow", back_populates="executions")
    messages = relationship("Message", back_populates="execution", cascade="all, delete-orphan")
    steps = relationship(
        "ExecutionStep",
        back_populates="execution",
        order_by="ExecutionStep.step_index",
        cascade="all, delete-orphan",
    )


class Mission(Base):
    __tablename__ = "missions"
    __table_args__ = (
        Index("ix_missions_org_id", "org_id"),
        Index("ix_missions_client_id", "client_id"),
        Index("ix_missions_status", "status"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    client_id = Column(String, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    goal = Column(Text, nullable=False)
    title = Column(String(255), nullable=True)
    status = Column(
        SAEnum(
            MissionStatus,
            values_callable=lambda values: [item.value for item in values],
            name="missionstatus",
        ),
        default=MissionStatus.planning,
        nullable=False,
    )
    report = Column(Text, nullable=True)
    report_delivered = Column(Boolean, default=False, nullable=False)
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    tasks = relationship(
        "MissionTask",
        back_populates="mission",
        order_by="MissionTask.sequence",
        cascade="all, delete-orphan",
    )


class MissionTask(Base):
    __tablename__ = "mission_tasks"
    __table_args__ = (
        Index("ix_mission_tasks_mission_id", "mission_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    mission_id = Column(String, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    sequence = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    depends_on = Column(String, nullable=True)
    status = Column(
        SAEnum(
            MissionTaskStatus,
            values_callable=lambda values: [item.value for item in values],
            name="missiontaskstatus",
        ),
        default=MissionTaskStatus.pending,
        nullable=False,
    )
    output_summary = Column(Text, nullable=True)
    execution_id = Column(String, ForeignKey("executions.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    mission = relationship("Mission", back_populates="tasks")


class ExecutionStep(Base):
    __tablename__ = "execution_steps"
    __table_args__ = (
        Index("ix_execution_steps_execution_id", "execution_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    execution_id = Column(
        String,
        ForeignKey("executions.id", ondelete="CASCADE"),
        nullable=False,
    )
    org_id = Column(String, nullable=False)
    step_type = Column(String(30), nullable=False)
    content = Column(Text, nullable=False)
    tool_name = Column(String(100), nullable=True)
    tool_input = Column(JSON, nullable=True)
    tool_output = Column(JSON, nullable=True)
    tool_success = Column(Boolean, nullable=True)
    step_index = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=True)
    tokens_used = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    execution = relationship("Execution", back_populates="steps")


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


class AgentMessage(Base):
    __tablename__ = "agent_messages"
    __table_args__ = (
        Index("ix_agent_messages_to_created", "to_agent_id", "created_at"),
        Index("ix_agent_messages_execution", "execution_id"),
        Index("ix_agent_messages_org_requires_human", "org_id", "requires_human"),
        Index("ix_agent_messages_thread", "thread_id"),
        Index("ix_agent_messages_org_sender", "org_id", "sender_type"),
        Index("ix_agent_messages_org_ceo_inbox", "org_id", "requires_human", "is_resolved"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id"), nullable=True)
    from_agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=True)
    to_agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=True)
    execution_id = Column(String, nullable=True)
    message = Column(Text, nullable=False)
    # "agent" | "ceo"
    sender_type = Column(String(10), default="agent")
    message_type = Column(String(50), default="general")
    thread_id = Column(String, nullable=True)
    parent_message_id = Column(String, nullable=True)
    is_resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime, nullable=True)
    requires_human = Column(Boolean, default=False)
    priority = Column(String(20), default="normal")
    read_at = Column(DateTime, nullable=True)
    response = Column(Text, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    responded_at = Column(DateTime, nullable=True)
    # Scheduled follow-up reply fields
    scheduled_reply_at = Column(DateTime, nullable=True)
    scheduled_reply_job_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


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
    plan = Column(String(20), default="open_source", nullable=False)
    owner_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    max_members = Column(Integer, default=1)
    max_agents = Column(Integer, default=3)
    max_workflows = Column(Integer, default=5)
    max_monthly_executions = Column(Integer, default=100)
    monthly_budget_usd = Column(Float, default=10.0)
    current_period_executions = Column(Integer, default=0)
    onboarding_completed = Column(Boolean, default=False, nullable=False)
    onboarding_step = Column(String(64), default="company_identity", nullable=False)
    company_description = Column(Text, nullable=True)
    primary_challenge = Column(String(100), nullable=True)
    competitors = Column(JSON, default=list)
    timezone = Column(String(50), default="UTC")
    logo_url = Column(String(500), nullable=True)
    agent_message_retention_days = Column(Integer, nullable=True, default=30)
    custom_domain = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ClientStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    completed = "completed"


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (
        Index("ix_clients_org_id", "org_id"),
        Index("ix_clients_org_status", "org_id", "status"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    company_name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    service_type = Column(String(100), nullable=True)
    status = Column(
        SAEnum(
            ClientStatus,
            values_callable=lambda v: [i.value for i in v],
            name="clientstatus",
        ),
        default=ClientStatus.active,
        nullable=False,
    )
    portal_token = Column(String(64), nullable=True, unique=True)
    portal_enabled = Column(Boolean, default=False, nullable=False)
    notes = Column(Text, nullable=True)
    color = Column(String(7), nullable=True, default="#6366F1")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_org_created_desc", "org_id", text("created_at DESC")),
        Index("ix_audit_logs_user_created_desc", "user_id", text("created_at DESC")),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    org_id = Column(String, nullable=True)
    action = Column(
        SAEnum(
            AuditAction,
            values_callable=lambda values: [item.value for item in values],
            name="auditaction",
        ),
        nullable=False,
    )
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    details = Column(Text, nullable=True)
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
    model_config_id = Column(String, ForeignKey("model_configs.id", ondelete="SET NULL"), nullable=True)
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
    comparison_group_id = Column(String, nullable=True)
    comparison_slot = Column(String(10), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class EvalCaseResult(Base):
    __tablename__ = "eval_case_results"
    __table_args__ = (
        Index("ix_eval_case_results_run_id", "run_id"),
    )

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
        Index("ix_tool_call_logs_org_created", "org_id", "created_at"),
        Index("ix_tool_call_logs_tool_created", "tool_name", "created_at"),
        Index("ix_tool_call_logs_execution_id", "execution_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
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
        Index("ix_execution_cost_logs_org_created", "org_id", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    execution_id = Column(String, ForeignKey("executions.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(
        String,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )
    model = Column(String(100), nullable=False)
    input_tokens = Column(Integer, nullable=False)
    output_tokens = Column(Integer, nullable=False)
    cost_usd = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InAppNotification(Base):
    __tablename__ = "in_app_notifications"
    __table_args__ = (
        Index("ix_in_app_notifications_org_user_unread_created", "org_id", "user_id", "is_read", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
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


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id", name="uq_notification_preferences_org_user"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    email_on_approval_needed = Column(Boolean, default=True, nullable=False)
    email_on_execution_complete = Column(Boolean, default=False, nullable=False)
    email_on_autonomy_change = Column(Boolean, default=True, nullable=False)
    daily_digest_enabled = Column(Boolean, default=True, nullable=False)
    daily_digest_time = Column(String(5), default="08:00", nullable=False)
    notification_email = Column(String(255), nullable=True)
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


class WebhookEventLog(Base):
    __tablename__ = "webhook_event_logs"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_webhook_event_logs_event_id"),
        Index("ix_webhook_event_logs_source_event_created", "source", "event_type", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    source = Column(String(50), nullable=False)
    event_type = Column(String(100), nullable=False)
    event_id = Column(String(255), nullable=True)
    payload = Column(Text, nullable=False)
    processed = Column(Boolean, default=False, nullable=False)
    processing_error = Column(Text, nullable=True)
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


class CompanyConversation(Base):
    __tablename__ = "company_conversations"
    __table_args__ = (
        Index("ix_company_conversations_org_user", "org_id", "user_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=True)
    pinned = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_message_at = Column(DateTime, default=datetime.utcnow)
    message_count = Column(Integer, default=0)


class CompanyChatMessage(Base):
    __tablename__ = "company_chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_conversation", "conversation_id"),
        Index("ix_chat_messages_org_created", "org_id", "created_at"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    conversation_id = Column(
        String,
        ForeignKey("company_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    actions_json = Column(JSON, default=list)
    attachments_json = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)


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
    short_description = Column(String(500), default="")
    description = Column(Text, nullable=False)
    readme = Column(Text, nullable=True)
    template_data = Column(Text, nullable=False)
    tags = Column(String(500), nullable=True)
    icon = Column(String(16), default="🤖")
    required_tools = Column(JSON, default=list)
    optional_tools = Column(JSON, default=list)
    required_integrations = Column(JSON, default=list)
    recommended_integrations = Column(JSON, default=list)
    preview_image_url = Column(String(500), nullable=True)
    demo_video_url = Column(String(500), nullable=True)
    source_url = Column(String(500), nullable=True)
    install_count = Column(Integer, default=0)
    rating_avg = Column(Float, default=0.0)
    rating_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    is_free = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    author = Column(String(255), nullable=True)
    role_slug = Column(String(100), nullable=True)
    department_type = Column(String(100), nullable=True)
    hiring_tagline = Column(String(500), default="")
    estimated_minutes_saved_per_week = Column(Integer, default=0)
    difficulty = Column(String(32), default="beginner")
    price_usd = Column(Float, default=0.0)
    version = Column(String(20), default="1.0.0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    published_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_marketplace_listings_status_category", "status", "category"),
        Index("ix_marketplace_listings_install_count_desc", install_count.desc()),
        Index("ix_marketplace_listings_rating_avg_desc", rating_avg.desc()),
        Index("ix_marketplace_status_category_install", "status", "category", install_count.desc()),
        Index("ix_marketplace_status_published", "status", published_at.desc()),
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


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (Index("ix_departments_org_id", "org_id"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    department_type = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True)
    icon = Column(String(10), nullable=True)
    head_agent_id = Column(String, ForeignKey("agents.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AgentRole(Base):
    __tablename__ = "agent_roles"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)
    seniority_level = Column(Integer, nullable=False)
    department_type = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=False, default="#6C63FF")
    icon = Column(String(10), nullable=False, default="🤖")
    is_system_role = Column(Boolean, default=True)
    default_tools = Column(JSON, default=list)
    default_max_iterations = Column(Integer, default=15)
    default_autonomy_level = Column(String(20), default="supervised")
    created_at = Column(DateTime, default=datetime.utcnow)


class AgentContract(Base):
    __tablename__ = "agent_contracts"
    __table_args__ = (Index("ix_agent_contracts_agent_id", "agent_id"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, unique=True)
    responsibilities = Column(JSON, default=list)
    allowed_tools = Column(JSON, default=list)
    forbidden_tools = Column(JSON, default=list)
    forbidden_actions = Column(JSON, default=list)
    requires_approval_for = Column(JSON, default=list)
    escalates_to_role = Column(String(100), nullable=True)
    escalation_triggers = Column(JSON, default=list)
    max_tokens_per_task = Column(Integer, default=50000)
    max_cost_per_task_cents = Column(Integer, default=100)
    requires_review_from = Column(JSON, default=list)
    autonomy_level = Column(String(20), default="supervised")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AgentTrustScore(Base):
    __tablename__ = "agent_trust_scores"
    __table_args__ = (Index("ix_agent_trust_scores_agent_id", "agent_id"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, unique=True)
    task_success_rate = Column(Float, default=0.0)
    review_pass_rate = Column(Float, default=0.0)
    cost_efficiency = Column(Float, default=100.0)
    on_time_rate = Column(Float, default=100.0)
    risky_action_rate = Column(Float, default=100.0)
    eval_pass_rate = Column(Float, default=0.0, nullable=False)
    eval_runs_count = Column(Integer, default=0, nullable=False)
    overall_score = Column(Float, default=50.0)
    skill_scores = Column(JSON, default=dict)
    trajectory = Column(String(20), default="stable")
    trajectory_delta = Column(Float, default=0.0)
    total_tasks = Column(Integer, default=0)
    successful_tasks = Column(Integer, default=0)
    failed_tasks = Column(Integer, default=0)
    total_reviews = Column(Integer, default=0)
    passed_reviews = Column(Integer, default=0)
    risky_actions_attempted = Column(Integer, default=0)
    risky_actions_blocked = Column(Integer, default=0)
    human_overrides = Column(Integer, default=0)
    autonomy_history = Column(JSON, default=list)
    last_calculated = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)


class AgentApprovalRequest(Base):
    __tablename__ = "agent_approval_requests"
    __table_args__ = (
        Index("ix_approval_requests_org_status", "org_id", "status"),
        Index("ix_approval_requests_agent", "requesting_agent_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    requesting_agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    execution_id = Column(String, ForeignKey("executions.id"), nullable=True)
    approval_type = Column(String(50), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=False)
    risk_level = Column(String(20), nullable=False, default="medium")
    affected_files = Column(JSON, default=list)
    affected_systems = Column(JSON, default=list)
    reason = Column(Text, nullable=True)
    expected_impact = Column(Text, nullable=True)
    rollback_plan = Column(Text, nullable=True)
    estimated_cost_cents = Column(Integer, nullable=True)
    ai_recommendation = Column(String(20), nullable=True)
    ai_analysis = Column(Text, nullable=True)
    ai_risk_factors = Column(JSON, default=list)
    ai_analyzed_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="pending")
    decided_by = Column(String, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_note = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ExternalAgent(Base):
    __tablename__ = "external_agents"
    __table_args__ = (
        Index("ix_external_agents_org_id", "org_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    agent_card_url = Column(String(500), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    provider_name = Column(String(255), nullable=True)
    provider_url = Column(String(500), nullable=True)
    task_endpoint = Column(String(500), nullable=False)
    skills = Column(JSON, default=list)
    api_key_encrypted = Column(Text, nullable=True)
    trust_status = Column(String(20), default="pending")
    agent_did = Column(String(255), nullable=True)
    total_calls = Column(Integer, default=0)
    successful_calls = Column(Integer, default=0)
    total_cost_usd = Column(Float, default=0.0)
    added_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)


class A2ATask(Base):
    __tablename__ = "a2a_tasks"
    __table_args__ = (
        Index("ix_a2a_tasks_org_created", "org_id", "created_at"),
        Index("ix_a2a_tasks_agent_status", "agent_id", "status"),
    )

    id = Column(String, primary_key=True)
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    execution_id = Column(String, ForeignKey("executions.id", ondelete="SET NULL"), nullable=True)
    external_agent_id = Column(String, ForeignKey("external_agents.id", ondelete="SET NULL"), nullable=True)
    input_text = Column(Text, nullable=False)
    output_text = Column(Text, nullable=True)
    direction = Column(
        SAEnum(
            A2ATaskDirection,
            values_callable=lambda values: [item.value for item in values],
            name="a2ataskdirection",
        ),
        default=A2ATaskDirection.incoming,
        nullable=False,
    )
    status = Column(
        SAEnum(
            A2ATaskStatus,
            values_callable=lambda values: [item.value for item in values],
            name="a2ataskstatus",
        ),
        default=A2ATaskStatus.submitted,
        nullable=False,
    )
    caller_identity = Column(String(255), nullable=True)
    payment_amount = Column(Float, nullable=True)
    payment_currency = Column(String(10), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class AgentMemoryEntry(Base):
    __tablename__ = "agent_memory_entries"
    __table_args__ = (
        Index("ix_agent_memory_entries_agent_id", "agent_id"),
        Index("ix_agent_memory_entries_org_id", "org_id"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    agent_id = Column(String, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    mem0_memory_id = Column(String(255), nullable=False)
    content_preview = Column(String(500), nullable=True)
    memory_type = Column(String(50), default="general")
    tags = Column(JSON, default=list)
    importance_score = Column(Float, default=0.5)
    always_inject = Column(Boolean, default=False, nullable=False)
    source = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

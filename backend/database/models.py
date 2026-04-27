import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Boolean, Integer, Float, DateTime, JSON, ForeignKey, Enum as SAEnum, func
from sqlalchemy.orm import relationship
from uuid import uuid4

from database.db import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)
    description = Column(Text, default="")
    system_prompt = Column(Text, nullable=False)
    model = Column(String, default="gemini-2.5-flash")
    tools = Column(JSON, default=list)
    memory_enabled = Column(Boolean, default=True)
    memory_window = Column(Integer, default=10)
    max_tokens = Column(Integer, default=2000)
    temperature = Column(Float, default=0.7)
    max_iterations = Column(Integer, default=10)
    timeout = Column(Integer, default=120)
    telegram_enabled = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    executions = relationship("Execution", back_populates="workflow", cascade="all, delete-orphan")


class Execution(Base):
    __tablename__ = "executions"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workflow_id = Column(String, ForeignKey("workflows.id"), nullable=False)
    trigger = Column(String, default="manual")
    status = Column(String, default="pending")
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


class UserRole(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


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


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    key_hash = Column(String(255), nullable=False)
    key_prefix = Column(String(10), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

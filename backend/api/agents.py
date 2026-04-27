from auth.dependencies import get_current_user, require_editor, require_admin
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import uuid4

from database import get_db
from database.models import Agent, CustomTool
from config import AVAILABLE_MODELS, AVAILABLE_TOOLS

router = APIRouter(dependencies=[Depends(get_current_user)])


class AgentCreate(BaseModel):
    name: str
    role: str
    description: str = ""
    system_prompt: str
    model: str = "gemini-2.5-flash"
    tools: List[str] = []
    memory_enabled: bool = True
    memory_window: int = 10
    max_tokens: int = 2000
    temperature: float = 0.7
    max_iterations: int = 10
    timeout: int = 120
    telegram_enabled: bool = False


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    tools: Optional[List[str]] = None
    memory_enabled: Optional[bool] = None
    memory_window: Optional[int] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    max_iterations: Optional[int] = None
    timeout: Optional[int] = None
    telegram_enabled: Optional[bool] = None
    is_active: Optional[bool] = None


class AgentResponse(BaseModel):
    id: str
    name: str
    role: str
    description: str
    system_prompt: str
    model: str
    tools: List[str]
    memory_enabled: bool
    memory_window: int
    max_tokens: int
    temperature: float
    max_iterations: int
    timeout: int
    telegram_enabled: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[AgentResponse])
async def list_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(data: AgentCreate, db: AsyncSession = Depends(get_db)):
    agent = Agent(
        id=str(uuid4()),
        **data.model_dump(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: str, data: AgentUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    agent.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    await db.delete(agent)
    await db.commit()


@router.get("/meta/models")
async def get_models():
    return AVAILABLE_MODELS


@router.get("/meta/tools")
async def get_tools_list(db: AsyncSession = Depends(get_db)):
    tools = list(AVAILABLE_TOOLS)
    ct_result = await db.execute(
        select(CustomTool).where(CustomTool.is_active == True).order_by(CustomTool.name)
    )
    for ct in ct_result.scalars().all():
        tools.append({"id": ct.id, "name": ct.name, "description": ct.description, "custom": True})
    return tools

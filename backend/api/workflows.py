from auth.dependencies import get_current_user, require_editor, require_admin
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
from uuid import uuid4

from database import get_db
from database.models import Workflow

router = APIRouter(dependencies=[Depends(get_current_user)])

WORKFLOW_TEMPLATES = [
    {
        "id": "research-summarize",
        "name": "Research & Summarize",
        "description": "A researcher gathers information and a summarizer condenses it into key insights.",
        "nodes": [
            {"id": "node-1", "type": "agentNode", "position": {"x": 100, "y": 200}, "data": {"label": "Researcher", "role": "researcher"}},
            {"id": "node-2", "type": "agentNode", "position": {"x": 450, "y": 200}, "data": {"label": "Summarizer", "role": "summarizer"}},
        ],
        "edges": [
            {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
        ],
        "suggested_agents": [
            {"role": "researcher", "name": "Research Agent", "system_prompt": "You are a thorough research agent. Use web search to gather comprehensive information about the topic provided. Return detailed findings.", "tools": ["web_search", "datetime_tool"]},
            {"role": "summarizer", "name": "Summary Agent", "system_prompt": "You are an expert summarizer. Take the research provided and condense it into a clear, concise summary with key points and actionable insights.", "tools": ["text_analysis"]},
        ],
    },
    {
        "id": "content-pipeline",
        "name": "Content Creation Pipeline",
        "description": "Ideate, write, and review content through a collaborative multi-agent pipeline.",
        "nodes": [
            {"id": "node-1", "type": "agentNode", "position": {"x": 80, "y": 200}, "data": {"label": "Ideator", "role": "ideator"}},
            {"id": "node-2", "type": "agentNode", "position": {"x": 350, "y": 200}, "data": {"label": "Writer", "role": "writer"}},
            {"id": "node-3", "type": "agentNode", "position": {"x": 620, "y": 200}, "data": {"label": "Editor", "role": "editor"}},
        ],
        "edges": [
            {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
            {"id": "e2-3", "source": "node-2", "target": "node-3", "animated": True},
        ],
        "suggested_agents": [
            {"role": "ideator", "name": "Idea Generator", "system_prompt": "You are a creative ideation agent. Generate 3-5 compelling content ideas with angles, hooks, and key points for each.", "tools": ["web_search"]},
            {"role": "writer", "name": "Content Writer", "system_prompt": "You are a skilled content writer. Take the ideas provided and write engaging, well-structured content with clear sections.", "tools": ["text_analysis"]},
            {"role": "editor", "name": "Content Editor", "system_prompt": "You are a meticulous editor. Review the content provided, improve clarity, fix any issues, and provide the final polished version.", "tools": []},
        ],
    },
    {
        "id": "data-analyst",
        "name": "Data Analysis & Report",
        "description": "Fetch data, analyze it, and generate an executive report.",
        "nodes": [
            {"id": "node-1", "type": "agentNode", "position": {"x": 100, "y": 200}, "data": {"label": "Data Fetcher", "role": "fetcher"}},
            {"id": "node-2", "type": "agentNode", "position": {"x": 400, "y": 200}, "data": {"label": "Analyst", "role": "analyst"}},
        ],
        "edges": [
            {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
        ],
        "suggested_agents": [
            {"role": "fetcher", "name": "Data Fetcher", "system_prompt": "You are a data collection agent. Use HTTP requests and web search to gather relevant data and statistics on the requested topic.", "tools": ["http_request", "web_search", "datetime_tool"]},
            {"role": "analyst", "name": "Data Analyst", "system_prompt": "You are a data analyst. Take the raw data provided and perform thorough analysis. Identify trends, patterns, and generate a structured executive report.", "tools": ["calculator", "text_analysis"]},
        ],
    },
]


class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    nodes: List[Any] = []
    edges: List[Any] = []
    trigger: str = "manual"
    schedule: Optional[str] = None
    template_id: Optional[str] = None
    execution_mode: str = "sequential"
    orchestration_prompt: str = ""


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Any]] = None
    edges: Optional[List[Any]] = None
    status: Optional[str] = None
    trigger: Optional[str] = None
    schedule: Optional[str] = None
    execution_mode: Optional[str] = None
    orchestration_prompt: Optional[str] = None


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: str
    nodes: List[Any]
    edges: List[Any]
    status: str
    trigger: str
    schedule: Optional[str]
    template_id: Optional[str]
    execution_mode: str = "sequential"
    orchestration_prompt: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=List[WorkflowResponse])
async def list_workflows(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workflow).order_by(Workflow.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=WorkflowResponse, status_code=201)
async def create_workflow(data: WorkflowCreate, db: AsyncSession = Depends(get_db)):
    workflow = Workflow(
        id=str(uuid4()),
        **data.model_dump(),
        status="draft",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)
    return workflow


@router.get("/templates")
async def get_templates():
    return WORKFLOW_TEMPLATES


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(workflow_id: str, data: WorkflowUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(workflow, field, value)
    workflow.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(workflow)
    return workflow


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(workflow_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    await db.delete(workflow)
    await db.commit()

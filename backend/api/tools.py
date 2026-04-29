from auth.dependencies import get_current_user, require_editor, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, field_validator
from typing import Optional, Any
from datetime import datetime
from uuid import uuid4
import re

from database import get_db
from database.models import CustomTool
from middleware.rate_limit import limiter

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])

DEFAULT_CODE = '''\
def run(query: str, max_results: int = 3) -> str:
    """Describe what this tool does — the LLM reads this to decide when to call it."""
    # Define any number of typed parameters in the signature above.
    # Supported types: str, int, float, bool, list, dict
    # The LLM fills them automatically based on context.
    results = [f"Result {i + 1} for \\'{query}\\'" for i in range(max_results)]
    return "\\n".join(results)
'''


class ToolCreate(BaseModel):
    name: str
    description: str
    code: str = DEFAULT_CODE

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip().lower().replace(" ", "_")
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]{0,49}$", v):
            raise ValueError("Name must be a valid identifier (letters/digits/underscores, start with a letter)")
        return v


class ToolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower().replace(" ", "_")
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]{0,49}$", v):
            raise ValueError("Name must be a valid identifier (letters/digits/underscores, start with a letter)")
        return v


class ToolResponse(BaseModel):
    id: str
    name: str
    description: str
    code: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ParseParamsBody(BaseModel):
    code: str


class TestInput(BaseModel):
    params: dict[str, Any] = {}


@router.post("/parse-params")
async def parse_params(body: ParseParamsBody):
    """Parse the run() signature and return typed parameter definitions."""
    from runtime.tools import parse_tool_params
    return {"params": parse_tool_params(body.code)}


@router.get("", response_model=list[ToolResponse])
async def list_tools(db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(CustomTool).where(CustomTool.org_id == ctx.org.id).order_by(CustomTool.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=ToolResponse, status_code=201)
async def create_tool(data: ToolCreate, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    await check_plan_limit("custom_tools", ctx.org, db)
    existing = await db.execute(select(CustomTool).where(CustomTool.name == data.name, CustomTool.org_id == ctx.org.id))
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"A tool named '{data.name}' already exists")
    ct = CustomTool(id=str(uuid4()), org_id=ctx.org.id, **data.model_dump())
    db.add(ct)
    await db.commit()
    await db.refresh(ct)
    return ct


@router.get("/{tool_id}", response_model=ToolResponse)
async def get_tool(tool_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(CustomTool).where(CustomTool.id == tool_id, CustomTool.org_id == ctx.org.id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(404, "Tool not found")
    return ct


@router.put("/{tool_id}", response_model=ToolResponse)
async def update_tool(tool_id: str, data: ToolUpdate, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(CustomTool).where(CustomTool.id == tool_id, CustomTool.org_id == ctx.org.id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(404, "Tool not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(ct, field, value)
    ct.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(ct)
    return ct


@router.delete("/{tool_id}", status_code=204)
async def delete_tool(tool_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(CustomTool).where(CustomTool.id == tool_id, CustomTool.org_id == ctx.org.id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(404, "Tool not found")
    await db.delete(ct)
    await db.commit()


@router.post("/{tool_id}/test")
@limiter.limit("30/minute")
async def test_tool(
    request: Request,
    tool_id: str,
    body: TestInput,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(CustomTool).where(CustomTool.id == tool_id, CustomTool.org_id == ctx.org.id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(404, "Tool not found")
    from runtime.tools import execute_custom_tool_code
    output, error = execute_custom_tool_code(ct.code, **body.params)
    return {"output": output, "error": error}

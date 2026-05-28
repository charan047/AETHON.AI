from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import OrgVariable, User


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class OrgVariableCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1)
    description: str | None = None


class OrgVariableUpdate(BaseModel):
    value: str | None = Field(default=None, min_length=1)
    description: str | None = None


def _payload(variable: OrgVariable) -> dict:
    return {
        "id": variable.id,
        "org_id": variable.org_id,
        "key": variable.key,
        "value": variable.value,
        "description": variable.description,
        "created_at": variable.created_at,
    }


@router.get("/variables")
async def list_org_variables(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    rows = (
        await db.execute(
            select(OrgVariable)
            .where(OrgVariable.org_id == ctx.org.id)
            .order_by(OrgVariable.key.asc())
        )
    ).scalars().all()
    return [_payload(row) for row in rows]


@router.post("/variables", status_code=201)
async def create_org_variable(
    data: OrgVariableCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    variable = OrgVariable(
        org_id=ctx.org.id,
        key=data.key.strip(),
        value=data.value,
        description=data.description,
        created_at=datetime.utcnow(),
    )
    db.add(variable)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Variable key already exists") from exc
    await db.refresh(variable)
    return _payload(variable)


@router.patch("/variables/{variable_id}")
async def update_org_variable(
    variable_id: str,
    data: OrgVariableUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    variable = await db.scalar(
        select(OrgVariable).where(
            OrgVariable.id == variable_id,
            OrgVariable.org_id == ctx.org.id,
        )
    )
    if not variable:
        raise HTTPException(status_code=404, detail="Variable not found")

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(variable, field, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Variable key already exists") from exc
    await db.refresh(variable)
    return _payload(variable)


@router.delete("/variables/{variable_id}", status_code=204)
async def delete_org_variable(
    variable_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    variable = await db.scalar(
        select(OrgVariable).where(
            OrgVariable.id == variable_id,
            OrgVariable.org_id == ctx.org.id,
        )
    )
    if not variable:
        raise HTTPException(status_code=404, detail="Variable not found")
    await db.delete(variable)
    await db.commit()

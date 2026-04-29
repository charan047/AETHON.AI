from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import User
from services.business_context_service import BusinessContextService


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class RevenueUpdate(BaseModel):
    monthly_revenue: int = Field(..., ge=0)
    runway_months: int | None = Field(default=None, ge=0)


class GoalBody(BaseModel):
    goal: str = Field(..., min_length=1)


def _service() -> BusinessContextService:
    return BusinessContextService()


@router.get("/context")
async def get_business_context(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    return {"context": await _service().get_context_for_agent(current_user.id, db, org_id=ctx.org.id)}


@router.get("/summary")
async def get_business_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    return await _service().get_business_summary(current_user.id, db, org_id=ctx.org.id)


@router.put("/revenue")
async def update_revenue(
    data: RevenueUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        await _service().update_revenue(
            current_user.id,
            data.monthly_revenue,
            db,
            runway_months=data.runway_months,
            org_id=ctx.org.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _service().get_business_summary(current_user.id, db, org_id=ctx.org.id)


@router.post("/goals")
async def add_goal(
    data: GoalBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        await _service().add_goal(current_user.id, data.goal, db, org_id=ctx.org.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _service().get_business_summary(current_user.id, db, org_id=ctx.org.id)


@router.delete("/goals/{index}")
async def delete_goal(
    index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        await _service().delete_goal(current_user.id, index, db, org_id=ctx.org.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _service().get_business_summary(current_user.id, db, org_id=ctx.org.id)


@router.put("/goals/{index}")
async def update_goal(
    index: int,
    data: GoalBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    try:
        await _service().update_goal(current_user.id, index, data.goal, db, org_id=ctx.org.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _service().get_business_summary(current_user.id, db, org_id=ctx.org.id)

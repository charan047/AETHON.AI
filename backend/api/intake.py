from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import (
    Client,
    ClientIntakeForm,
    ClientIntakeSubmission,
    Execution,
    ExecutionStatus,
    User,
    Workflow,
)
from .executions import run_workflow_background


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
public_router = APIRouter()


class IntakeFormCreate(BaseModel):
    client_id: str
    title: str = Field(..., min_length=1, max_length=255)
    workflow_id: str | None = None
    fields: list[dict] = Field(default_factory=list)


class IntakeSubmissionRequest(BaseModel):
    model_config = {"extra": "allow"}


def _form_payload(form: ClientIntakeForm, client: Client | None = None) -> dict:
    return {
        "id": form.id,
        "org_id": form.org_id,
        "client_id": form.client_id,
        "client_name": (client.company_name or client.name) if client else None,
        "title": form.title,
        "workflow_id": form.workflow_id,
        "fields": form.fields or [],
        "token": form.token,
        "is_active": form.is_active,
        "created_at": form.created_at,
        "public_url": f"/intake/{form.token}",
    }


def _submission_payload(submission: ClientIntakeSubmission) -> dict:
    return {
        "id": submission.id,
        "form_id": submission.form_id,
        "org_id": submission.org_id,
        "submitted_data": submission.submitted_data,
        "execution_id": submission.execution_id,
        "submitted_at": submission.submitted_at,
    }


def _build_input_message(form: ClientIntakeForm, submitted_data: dict) -> str:
    parts: list[str] = []
    for field in form.fields or []:
        if not isinstance(field, dict):
            continue
        name = str(field.get("name") or "").strip()
        if not name:
            continue
        value = submitted_data.get(name)
        if value in (None, ""):
            continue
        label = str(field.get("label") or name)
        parts.append(f"{label}: {value}")
    if parts:
        return "\n".join(parts)
    return "\n".join(f"{key}: {value}" for key, value in submitted_data.items() if value not in (None, ""))


def _validate_required_fields(form: ClientIntakeForm, submitted_data: dict) -> None:
    missing: list[str] = []
    for field in form.fields or []:
        if not isinstance(field, dict):
            continue
        name = str(field.get("name") or "").strip()
        if not name:
            continue
        if field.get("required") and not submitted_data.get(name):
            missing.append(str(field.get("label") or name))
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required intake fields: {', '.join(missing)}")


@router.get("/forms")
async def list_intake_forms(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    rows = (
        await db.execute(
            select(ClientIntakeForm, Client)
            .join(Client, Client.id == ClientIntakeForm.client_id)
            .where(ClientIntakeForm.org_id == ctx.org.id)
            .order_by(ClientIntakeForm.created_at.desc())
        )
    ).all()
    return [_form_payload(form, client) for form, client in rows]


@router.post("/forms", status_code=201)
async def create_intake_form(
    data: IntakeFormCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    client = await db.scalar(
        select(Client).where(Client.id == data.client_id, Client.org_id == ctx.org.id)
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    workflow = None
    if data.workflow_id:
        workflow = await db.scalar(
            select(Workflow).where(Workflow.id == data.workflow_id, Workflow.org_id == ctx.org.id)
        )
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

    form = ClientIntakeForm(
        org_id=ctx.org.id,
        client_id=client.id,
        title=data.title.strip(),
        workflow_id=workflow.id if workflow else None,
        fields=data.fields,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(form)
    await db.commit()
    await db.refresh(form)
    return _form_payload(form, client)


@router.get("/forms/{form_id}/submissions")
async def list_intake_submissions(
    form_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    form = await db.scalar(
        select(ClientIntakeForm).where(
            ClientIntakeForm.id == form_id,
            ClientIntakeForm.org_id == ctx.org.id,
        )
    )
    if not form:
        raise HTTPException(status_code=404, detail="Intake form not found")
    rows = (
        await db.execute(
            select(ClientIntakeSubmission)
            .where(
                ClientIntakeSubmission.form_id == form_id,
                ClientIntakeSubmission.org_id == ctx.org.id,
            )
            .order_by(ClientIntakeSubmission.submitted_at.desc())
        )
    ).scalars().all()
    return [_submission_payload(row) for row in rows]


@public_router.get("/{token}")
async def get_public_intake_form(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(ClientIntakeForm, Client)
            .join(Client, Client.id == ClientIntakeForm.client_id)
            .where(
                ClientIntakeForm.token == token,
                ClientIntakeForm.is_active.is_(True),
            )
        )
    ).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Intake form not found")
    form, client = row
    payload = _form_payload(form, client)
    payload["client_company_name"] = client.company_name or client.name
    return payload


@public_router.post("/{token}", status_code=201)
async def submit_intake_form(
    token: str,
    data: IntakeSubmissionRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    form = await db.scalar(
        select(ClientIntakeForm).where(
            ClientIntakeForm.token == token,
            ClientIntakeForm.is_active.is_(True),
        )
    )
    if not form:
        raise HTTPException(status_code=404, detail="Intake form not found")
    if not form.workflow_id:
        raise HTTPException(status_code=400, detail="Intake form is not linked to a workflow")

    workflow = await db.scalar(
        select(Workflow).where(
            Workflow.id == form.workflow_id,
            Workflow.org_id == form.org_id,
        )
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    submitted_data = dict(data.__pydantic_extra__ or {})
    _validate_required_fields(form, submitted_data)
    input_message = _build_input_message(form, submitted_data)

    execution = Execution(
        id=str(uuid4()),
        org_id=form.org_id,
        workflow_id=workflow.id,
        client_id=form.client_id,
        trigger="client_intake",
        status=ExecutionStatus.pending,
        input_message=input_message,
        started_at=datetime.utcnow(),
        max_runtime_seconds=3600,
    )
    db.add(execution)
    await db.flush()

    submission = ClientIntakeSubmission(
        form_id=form.id,
        org_id=form.org_id,
        submitted_data=submitted_data,
        execution_id=execution.id,
        submitted_at=datetime.utcnow(),
    )
    db.add(submission)
    await db.commit()

    background_tasks.add_task(
        run_workflow_background,
        execution.id,
        workflow.id,
        input_message,
        None,
        form.org_id,
        getattr(request.app.state, "memory_service", None),
        getattr(request.app.state, "hitl_service", None),
    )

    return {
        "status": "submitted",
        "execution_id": execution.id,
        "submission_id": submission.id,
    }

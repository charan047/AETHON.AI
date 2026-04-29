import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from auth.security import generate_api_key, verify_password
from database import get_db
from database.models import (
    Agent,
    ApiKey,
    EvalCase,
    EvalCaseResult,
    EvalRun,
    EvalRunStatus,
    EvalSuite,
    EvalSuiteStatus,
    ScoringMethod,
    User,
)
from services.eval_runner import EvalRunner
from services.eval_generator import EvalGenerator
from services.plan_service import plan_service


router = APIRouter()


class SuiteCreate(BaseModel):
    name: str
    description: Optional[str] = None
    agent_id: str
    pass_threshold: float = Field(default=0.8, ge=0.0, le=1.0)


class SuiteUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[EvalSuiteStatus] = None
    pass_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class CaseCreate(BaseModel):
    name: str
    description: Optional[str] = None
    input: str
    expected_output: Optional[str] = None
    scoring_method: ScoringMethod = ScoringMethod.llm_judge
    scoring_config: Optional[dict[str, Any]] = None
    weight: float = Field(default=1.0, gt=0)
    tags: Optional[str] = None


class CaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    input: Optional[str] = None
    expected_output: Optional[str] = None
    scoring_method: Optional[ScoringMethod] = None
    scoring_config: Optional[dict[str, Any]] = None
    weight: Optional[float] = Field(default=None, gt=0)
    tags: Optional[str] = None


class CaseBulkCreate(BaseModel):
    cases: list[CaseCreate]


class RunRequest(BaseModel):
    triggered_by: str = "manual"
    notes: Optional[str] = None


class GenerateFromHistoryRequest(BaseModel):
    agent_id: Optional[str] = None
    count: int = Field(default=10, ge=1, le=50)


class CIRunRequest(BaseModel):
    suite_ids: list[str]
    git_commit: Optional[str] = None
    branch: Optional[str] = None


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


def _parse_json(raw: str | None, fallback=None):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _suite_response(
    suite: EvalSuite,
    agent_name: str | None = None,
    case_count: int | None = None,
    last_run: EvalRun | None = None,
):
    return {
        "id": suite.id,
        "user_id": suite.user_id,
        "agent_id": suite.agent_id,
        "agent_name": agent_name,
        "name": suite.name,
        "description": suite.description,
        "status": _enum_value(suite.status),
        "pass_threshold": suite.pass_threshold,
        "version": suite.version,
        "case_count": case_count,
        "last_run_score": last_run.suite_score if last_run else None,
        "last_run_passed": last_run.passed if last_run else None,
        "created_at": suite.created_at,
        "updated_at": suite.updated_at,
    }


def _case_response(case: EvalCase):
    return {
        "id": case.id,
        "suite_id": case.suite_id,
        "name": case.name,
        "description": case.description,
        "input": case.input,
        "expected_output": case.expected_output,
        "scoring_method": _enum_value(case.scoring_method),
        "scoring_config": _parse_json(case.scoring_config, {}),
        "weight": case.weight,
        "tags": case.tags,
        "created_at": case.created_at,
    }


def _case_result_response(result: EvalCaseResult, case: EvalCase | None = None):
    payload = {
        "id": result.id,
        "run_id": result.run_id,
        "case_id": result.case_id,
        "actual_output": result.actual_output,
        "score": result.score,
        "passed": result.passed,
        "scoring_details": _parse_json(result.scoring_details, {}),
        "error_message": result.error_message,
        "duration_seconds": result.duration_seconds,
        "tokens_used": result.tokens_used,
        "cost_usd": result.cost_usd,
        "created_at": result.created_at,
    }
    if case:
        payload["case"] = _case_response(case)
    return payload


def _run_response(run: EvalRun, results: list[dict] | None = None):
    return {
        "id": run.id,
        "suite_id": run.suite_id,
        "user_id": run.user_id,
        "status": _enum_value(run.status),
        "triggered_by": run.triggered_by,
        "total_cases": run.total_cases,
        "passed_cases": run.passed_cases,
        "failed_cases": run.failed_cases,
        "error_cases": run.error_cases,
        "suite_score": run.suite_score,
        "passed": run.passed,
        "duration_seconds": run.duration_seconds,
        "total_cost_usd": run.total_cost_usd,
        "git_commit": run.git_commit,
        "notes": run.notes,
        "created_at": run.created_at,
        "completed_at": run.completed_at,
        "results": results,
    }


async def _get_suite_for_user(suite_id: str, user_id: str, db: AsyncSession, org_id: str | None = None) -> EvalSuite:
    suite = await db.get(EvalSuite, suite_id)
    if not suite or suite.user_id != user_id or (org_id and suite.org_id != org_id):
        raise HTTPException(status_code=404, detail="Eval suite not found")
    return suite


async def _get_case_for_suite(case_id: str, suite_id: str, db: AsyncSession) -> EvalCase:
    case = await db.get(EvalCase, case_id)
    if not case or case.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Eval case not found")
    return case


async def _count_cases(suite_id: str, db: AsyncSession) -> int:
    return (
        await db.scalar(
            select(func.count(EvalCase.id)).where(EvalCase.suite_id == suite_id)
        )
        or 0
    )


async def _last_run(suite_id: str, db: AsyncSession) -> EvalRun | None:
    result = await db.execute(
        select(EvalRun)
        .where(EvalRun.suite_id == suite_id)
        .order_by(EvalRun.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _get_ci_user(
    x_ci_token: str = Header(..., alias="X-CI-Token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.name == "CI",
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    for api_key in result.scalars().all():
        if api_key.expires_at and api_key.expires_at <= now:
            continue
        if verify_password(x_ci_token, api_key.key_hash):
            api_key.last_used_at = now
            user = await db.get(User, api_key.user_id)
            if not user or not user.is_active:
                break
            await db.commit()
            return user
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid CI token")


@router.get("/suites")
async def list_suites(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(EvalSuite, Agent.name)
        .join(Agent, EvalSuite.agent_id == Agent.id)
        .where(EvalSuite.user_id == current_user.id, EvalSuite.org_id == ctx.org.id)
        .order_by(EvalSuite.created_at.desc())
    )
    suites = []
    for suite, agent_name in result.all():
        suites.append(
            _suite_response(
                suite,
                agent_name=agent_name,
                case_count=await _count_cases(suite.id, db),
                last_run=await _last_run(suite.id, db),
            )
        )
    return suites


@router.post("/suites", status_code=201)
async def create_suite(
    data: SuiteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    agent = await db.scalar(select(Agent).where(Agent.id == data.agent_id, Agent.org_id == ctx.org.id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    suite = EvalSuite(
        id=str(uuid.uuid4()),
        org_id=ctx.org.id,
        user_id=current_user.id,
        agent_id=data.agent_id,
        name=data.name,
        description=data.description,
        pass_threshold=data.pass_threshold,
    )
    db.add(suite)
    await db.commit()
    await db.refresh(suite)
    return _suite_response(suite, agent_name=agent.name, case_count=0)


@router.get("/suites/{suite_id}")
async def get_suite(
    suite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    suite = await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    agent = await db.get(Agent, suite.agent_id)
    result = await db.execute(
        select(EvalCase)
        .where(EvalCase.suite_id == suite_id)
        .order_by(EvalCase.created_at.asc())
    )
    cases = [_case_response(case) for case in result.scalars().all()]
    payload = _suite_response(
        suite,
        agent_name=agent.name if agent else None,
        case_count=len(cases),
        last_run=await _last_run(suite.id, db),
    )
    payload["cases"] = cases
    return payload


@router.put("/suites/{suite_id}")
async def update_suite(
    suite_id: str,
    data: SuiteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    suite = await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(suite, field, value)
    await db.commit()
    await db.refresh(suite)
    agent = await db.get(Agent, suite.agent_id)
    return _suite_response(
        suite,
        agent_name=agent.name if agent else None,
        case_count=await _count_cases(suite_id, db),
        last_run=await _last_run(suite_id, db),
    )


@router.delete("/suites/{suite_id}", status_code=204)
async def delete_suite(
    suite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    suite = await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    await db.delete(suite)
    await db.commit()


@router.post("/suites/{suite_id}/cases", status_code=201)
async def create_case(
    suite_id: str,
    data: CaseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    allowed, message = await plan_service.check_eval_case_limit(ctx.org, suite_id, 1, db)
    if not allowed:
        raise HTTPException(status_code=429, detail=message)
    case = EvalCase(
        id=str(uuid.uuid4()),
        suite_id=suite_id,
        name=data.name,
        description=data.description,
        input=data.input,
        expected_output=data.expected_output,
        scoring_method=data.scoring_method,
        scoring_config=json.dumps(data.scoring_config or {}),
        weight=data.weight,
        tags=data.tags,
    )
    db.add(case)
    await db.commit()
    await db.refresh(case)
    return _case_response(case)


@router.put("/suites/{suite_id}/cases/{case_id}")
async def update_case(
    suite_id: str,
    case_id: str,
    data: CaseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    case = await _get_case_for_suite(case_id, suite_id, db)
    for field, value in data.model_dump(exclude_none=True).items():
        if field == "scoring_config":
            value = json.dumps(value or {})
        setattr(case, field, value)
    await db.commit()
    await db.refresh(case)
    return _case_response(case)


@router.delete("/suites/{suite_id}/cases/{case_id}", status_code=204)
async def delete_case(
    suite_id: str,
    case_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    case = await _get_case_for_suite(case_id, suite_id, db)
    await db.delete(case)
    await db.commit()


@router.post("/suites/{suite_id}/cases/bulk", status_code=201)
async def bulk_create_cases(
    suite_id: str,
    data: CaseBulkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    allowed, message = await plan_service.check_eval_case_limit(ctx.org, suite_id, len(data.cases), db)
    if not allowed:
        raise HTTPException(status_code=429, detail=message)
    created = []
    for item in data.cases:
        case = EvalCase(
            id=str(uuid.uuid4()),
            suite_id=suite_id,
            name=item.name,
            description=item.description,
            input=item.input,
            expected_output=item.expected_output,
            scoring_method=item.scoring_method,
            scoring_config=json.dumps(item.scoring_config or {}),
            weight=item.weight,
            tags=item.tags,
        )
        db.add(case)
        created.append(case)
    await db.commit()
    for case in created:
        await db.refresh(case)
    return {"created": len(created), "cases": [_case_response(case) for case in created]}


@router.post("/suites/{suite_id}/cases/generate-from-history", status_code=201)
async def generate_cases_from_history(
    suite_id: str,
    data: GenerateFromHistoryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    suite = await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    allowed, message = await plan_service.check_eval_case_limit(ctx.org, suite_id, data.count, db)
    if not allowed:
        raise HTTPException(status_code=429, detail=message)
    generator = EvalGenerator()
    cases = await generator.generate_cases_from_history(
        agent_id=data.agent_id or suite.agent_id,
        suite_id=suite_id,
        count=data.count,
        db=db,
    )
    return {"created": len(cases), "cases": [_case_response(case) for case in cases]}


@router.post("/suites/{suite_id}/run")
async def run_suite(
    suite_id: str,
    data: RunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    case_count = await _count_cases(suite_id, db)
    if case_count == 0:
        raise HTTPException(status_code=400, detail="Eval suite has no cases")

    runner = EvalRunner()
    if case_count >= 20:
        task = await runner.run_suite_background(
            suite_id,
            current_user.id,
            triggered_by=data.triggered_by,
        )
        return {
            "run_id": task.id,
            "task_id": task.id,
            "status": "running",
            "message": "Running in background",
        }

    run = await runner.run_suite(
        suite_id,
        current_user.id,
        triggered_by=data.triggered_by,
        db=db,
    )
    if data.notes:
        run.notes = data.notes
        await db.commit()
        await db.refresh(run)
    return _run_response(run)


@router.post("/suites/{suite_id}/cases/{case_id}/run")
async def run_single_case(
    suite_id: str,
    case_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    suite = await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    case = await _get_case_for_suite(case_id, suite_id, db)
    run = EvalRun(
        id=str(uuid.uuid4()),
        suite_id=suite_id,
        user_id=current_user.id,
        status=EvalRunStatus.running,
        triggered_by="single_case",
        total_cases=1,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    started = datetime.now(timezone.utc)
    result = await EvalRunner()._run_case(
        suite_id=suite_id,
        run_id=run.id,
        case_id=case.id,
        agent_id=suite.agent_id,
        user_id=current_user.id,
    )

    score = float(result.get("score") or 0.0)
    passed = bool(result.get("passed"))
    run.status = EvalRunStatus.completed
    run.passed_cases = 1 if passed else 0
    run.failed_cases = 0 if passed else 1
    run.error_cases = 1 if result.get("error") else 0
    run.suite_score = score
    run.passed = passed
    run.duration_seconds = int((datetime.now(timezone.utc) - started).total_seconds())
    run.total_cost_usd = float(result.get("cost_usd") or 0.0)
    run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(run)
    return _run_response(run)


@router.get("/runs/{run_id}")
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    run = await db.get(EvalRun, run_id)
    if not run or run.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Eval run not found")
    await _get_suite_for_user(run.suite_id, current_user.id, db, ctx.org.id)
    result = await db.execute(
        select(EvalCaseResult, EvalCase)
        .join(EvalCase, EvalCaseResult.case_id == EvalCase.id)
        .where(EvalCaseResult.run_id == run_id)
        .order_by(EvalCase.created_at.asc())
    )
    results = [_case_result_response(case_result, case) for case_result, case in result.all()]
    return _run_response(run, results=results)


@router.get("/suites/{suite_id}/runs")
async def list_suite_runs(
    suite_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    result = await db.execute(
        select(EvalRun)
        .where(EvalRun.suite_id == suite_id)
        .order_by(EvalRun.created_at.desc())
        .limit(limit)
    )
    runs = result.scalars().all()
    trend = [
        {
            "date": run.created_at,
            "score": run.suite_score,
            "passed": run.passed,
        }
        for run in reversed(runs)
    ]
    return {"runs": [_run_response(run) for run in runs], "score_trend": trend}


@router.get("/suites/{suite_id}/insights")
async def suite_insights(
    suite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    await _get_suite_for_user(suite_id, current_user.id, db, ctx.org.id)
    runs_result = await db.execute(
        select(EvalRun)
        .where(EvalRun.suite_id == suite_id, EvalRun.status == EvalRunStatus.completed)
        .order_by(EvalRun.created_at.desc())
        .limit(10)
    )
    runs = runs_result.scalars().all()
    score_trend = [
        {"date": run.created_at, "score": run.suite_score, "passed": run.passed}
        for run in reversed(runs)
    ]

    if not runs:
        return {
            "score_trend": [],
            "hardest_cases": [],
            "most_improved_cases": [],
            "regression_cases": [],
        }

    run_ids = [run.id for run in runs]
    results_query = await db.execute(
        select(EvalCaseResult, EvalCase)
        .join(EvalCase, EvalCaseResult.case_id == EvalCase.id)
        .where(EvalCaseResult.run_id.in_(run_ids))
    )
    by_case: dict[str, list[EvalCaseResult]] = {}
    case_names: dict[str, str] = {}
    for result, case in results_query.all():
        by_case.setdefault(case.id, []).append(result)
        case_names[case.id] = case.name

    hardest = sorted(
        (
            {
                "case_id": case_id,
                "case_name": case_names.get(case_id),
                "failures": sum(1 for item in items if not item.passed),
                "avg_score": sum((item.score or 0) for item in items) / len(items),
            }
            for case_id, items in by_case.items()
        ),
        key=lambda item: (-item["failures"], item["avg_score"]),
    )[:5]

    improved = []
    regressions = []
    for case_id, items in by_case.items():
        ordered = sorted(items, key=lambda item: item.created_at or datetime.min)
        if len(ordered) < 2:
            continue
        delta = (ordered[-1].score or 0) - (ordered[0].score or 0)
        if delta > 0:
            improved.append({"case_id": case_id, "case_name": case_names.get(case_id), "delta": delta})
        if ordered[-2].passed and not ordered[-1].passed:
            regressions.append({"case_id": case_id, "case_name": case_names.get(case_id)})

    return {
        "score_trend": score_trend,
        "hardest_cases": hardest,
        "most_improved_cases": sorted(improved, key=lambda item: item["delta"], reverse=True)[:5],
        "regression_cases": regressions,
    }


@router.get("/ci/token")
async def get_ci_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    existing_result = await db.execute(
        select(ApiKey).where(ApiKey.user_id == current_user.id, ApiKey.org_id == ctx.org.id, ApiKey.name == "CI")
    )
    for api_key in existing_result.scalars().all():
        api_key.is_active = False

    raw_key, key_hash, key_prefix = generate_api_key()
    api_key = ApiKey(
        id=str(uuid.uuid4()),
        org_id=ctx.org.id,
        user_id=current_user.id,
        name="CI",
        key_hash=key_hash,
        key_prefix=key_prefix,
    )
    db.add(api_key)
    await db.commit()
    return {
        "ci_token": raw_key,
        "key_prefix": key_prefix,
        "message": "Store this token securely. It will not be shown again.",
    }


@router.post("/ci/run")
async def ci_run(
    data: CIRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_get_ci_user),
):
    if not data.suite_ids:
        raise HTTPException(status_code=400, detail="suite_ids is required")

    for suite_id in data.suite_ids:
        await _get_suite_for_user(suite_id, current_user.id, db)

    runner = EvalRunner()
    results = await asyncio.gather(
        *[
            runner.run_suite(
                suite_id,
                current_user.id,
                triggered_by="ci",
                git_commit=data.git_commit,
            )
            for suite_id in data.suite_ids
        ],
        return_exceptions=True,
    )

    response_results = []
    all_passed = True
    for suite_id, result in zip(data.suite_ids, results):
        if isinstance(result, Exception):
            all_passed = False
            response_results.append(
                {
                    "suite_id": suite_id,
                    "score": 0.0,
                    "passed": False,
                    "error": str(result),
                }
            )
            continue
        if not result.passed:
            all_passed = False
        response_results.append(
            {
                "suite_id": suite_id,
                "run_id": result.id,
                "score": result.suite_score,
                "passed": result.passed,
            }
        )

    payload = {"passed": all_passed, "branch": data.branch, "results": response_results}
    if not all_passed:
        return JSONResponse(status_code=422, content=payload)
    return payload

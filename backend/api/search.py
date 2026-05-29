from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Float, cast, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.db import AsyncSessionLocal
from database.models import Agent, Client, Execution, FileStatus, Mission, OrgFile, Workflow


router = APIRouter(dependencies=[Depends(get_org_context)])


SearchFn = Callable[[str, str, AsyncSession], Awaitable[list[dict[str, Any]]]]


def _like_pattern(query: str) -> str:
    return f"%{query.strip().lower()}%"


def _score_text(value: str | None, query: str) -> float:
    if not value:
        return 0.0
    haystack = value.lower()
    needle = query.strip().lower()
    if not needle:
        return 0.0
    if haystack == needle:
        return 1.0
    if haystack.startswith(needle):
        return 0.9
    if needle in haystack:
        return 0.75
    return 0.0


def _coalesce(*parts: str | None) -> str:
    return " · ".join([part for part in parts if part])


async def _search_agents(query: str, org_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    rows = (
        await db.execute(
            select(Agent)
            .where(
                Agent.org_id == org_id,
                Agent.is_active == True,  # noqa: E712
                or_(
                    func.lower(func.coalesce(Agent.persona_name, "")).like(pattern),
                    func.lower(Agent.name).like(pattern),
                    func.lower(func.coalesce(Agent.role_slug, "")).like(pattern),
                    func.lower(func.coalesce(Agent.role, "")).like(pattern),
                ),
            )
            .order_by(Agent.updated_at.desc())
            .limit(5)
        )
    ).scalars().all()

    return [
        {
            "type": "agent",
            "id": agent.id,
            "title": agent.persona_name or agent.name,
            "subtitle": _coalesce(agent.role_slug or agent.role, agent.name if agent.persona_name else None),
            "navigate_to": f"/agents?agent={agent.id}",
            "score": max(
                _score_text(agent.persona_name, query),
                _score_text(agent.name, query),
                _score_text(agent.role_slug, query),
                _score_text(agent.role, query),
            ),
            "created_at": agent.created_at.isoformat() if agent.created_at else "",
            "icon": "agent",
        }
        for agent in rows
    ]


async def _search_clients(query: str, org_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    rows = (
        await db.execute(
            select(Client)
            .where(
                Client.org_id == org_id,
                or_(
                    func.lower(Client.name).like(pattern),
                    func.lower(func.coalesce(Client.company_name, "")).like(pattern),
                ),
            )
            .order_by(Client.updated_at.desc())
            .limit(5)
        )
    ).scalars().all()

    return [
        {
            "type": "client",
            "id": client.id,
            "title": client.company_name or client.name,
            "subtitle": _coalesce(client.name if client.company_name else None, client.service_type),
            "navigate_to": f"/clients/{client.id}",
            "score": max(_score_text(client.name, query), _score_text(client.company_name, query)),
            "created_at": client.created_at.isoformat() if client.created_at else "",
            "icon": "client",
        }
        for client in rows
    ]


async def _search_files(query: str, org_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    is_sqlite = "sqlite" in str(db.bind.url).lower()

    if is_sqlite:
        rows = (
            await db.execute(
                select(OrgFile)
                .where(
                    OrgFile.org_id == org_id,
                    OrgFile.status == FileStatus.ready,
                    or_(
                        func.lower(OrgFile.name).like(pattern),
                        func.lower(func.coalesce(OrgFile.extracted_text, "")).like(pattern),
                    ),
                )
                .order_by(OrgFile.created_at.desc())
                .limit(5)
            )
        ).scalars().all()
        return [
            {
                "type": "file",
                "id": file.id,
                "title": file.name,
                "subtitle": (file.extracted_text or "").replace("\n", " ").strip()[:110],
                "navigate_to": f"/files/{file.id}" if file.file_type.value != "document" else f"/files/{file.id}/edit",
                "score": max(_score_text(file.name, query), _score_text(file.extracted_text, query)),
                "created_at": file.created_at.isoformat() if file.created_at else "",
                "icon": "file",
            }
            for file in rows
        ]

    ts_query = func.plainto_tsquery("english", query.strip())
    rows = (
        await db.execute(
            select(
                OrgFile,
                cast(func.ts_rank(OrgFile.search_vector, ts_query), Float).label("rank"),
            )
            .where(
                OrgFile.org_id == org_id,
                OrgFile.status == FileStatus.ready,
                or_(
                    func.lower(OrgFile.name).like(pattern),
                    OrgFile.search_vector.op("@@")(ts_query),
                ),
            )
            .order_by(literal(1).desc())  # placeholder for compatibility, overridden below
        )
    ).all()

    sorted_rows = sorted(
        rows,
        key=lambda row: (
            float(row.rank or 0.0),
            row.OrgFile.created_at.isoformat() if row.OrgFile.created_at else "",
        ),
        reverse=True,
    )[:5]

    return [
        {
            "type": "file",
            "id": row.OrgFile.id,
            "title": row.OrgFile.name,
            "subtitle": (row.OrgFile.extracted_text or "").replace("\n", " ").strip()[:110],
            "navigate_to": f"/files/{row.OrgFile.id}" if row.OrgFile.file_type.value != "document" else f"/files/{row.OrgFile.id}/edit",
            "score": max(float(row.rank or 0.0), _score_text(row.OrgFile.name, query)),
            "created_at": row.OrgFile.created_at.isoformat() if row.OrgFile.created_at else "",
            "icon": "file",
        }
        for row in sorted_rows
    ]


async def _search_executions(query: str, org_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    rows = (
        await db.execute(
            select(Execution)
            .where(
                Execution.org_id == org_id,
                func.lower(func.coalesce(Execution.input_message, "")).like(pattern),
            )
            .order_by(Execution.started_at.desc())
            .limit(5)
        )
    ).scalars().all()

    return [
        {
            "type": "execution",
            "id": execution.id,
            "title": (execution.input_message or "Execution").strip()[:90],
            "subtitle": execution.status.value if hasattr(execution.status, "value") else str(execution.status),
            "navigate_to": f"/executions/{execution.id}",
            "score": _score_text(execution.input_message, query),
            "created_at": execution.started_at.isoformat() if execution.started_at else "",
            "icon": "execution",
        }
        for execution in rows
    ]


async def _search_missions(query: str, org_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    rows = (
        await db.execute(
            select(Mission)
            .where(
                Mission.org_id == org_id,
                or_(
                    func.lower(func.coalesce(Mission.title, "")).like(pattern),
                    func.lower(Mission.goal).like(pattern),
                ),
            )
            .order_by(Mission.created_at.desc())
            .limit(5)
        )
    ).scalars().all()

    return [
        {
            "type": "mission",
            "id": mission.id,
            "title": mission.title or mission.goal[:90],
            "subtitle": mission.goal[:110],
            "navigate_to": f"/missions/{mission.id}/report" if mission.status.value == "completed" else "/missions",
            "score": max(_score_text(mission.title, query), _score_text(mission.goal, query)),
            "created_at": mission.created_at.isoformat() if mission.created_at else "",
            "icon": "mission",
        }
        for mission in rows
    ]


async def _search_workflows(query: str, org_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    rows = (
        await db.execute(
            select(Workflow)
            .where(
                Workflow.org_id == org_id,
                or_(
                    func.lower(Workflow.name).like(pattern),
                    func.lower(func.coalesce(Workflow.description, "")).like(pattern),
                ),
            )
            .order_by(Workflow.updated_at.desc())
            .limit(5)
        )
    ).scalars().all()

    return [
        {
            "type": "workflow",
            "id": workflow.id,
            "title": workflow.name,
            "subtitle": workflow.description[:110] if workflow.description else "",
            "navigate_to": "/workflows",
            "score": max(_score_text(workflow.name, query), _score_text(workflow.description, query)),
            "created_at": workflow.created_at.isoformat() if workflow.created_at else "",
            "icon": "workflow",
        }
        for workflow in rows
    ]


async def _run_search_in_new_session(search_fn: SearchFn, query: str, org_id: str) -> list[dict[str, Any]]:
    async with AsyncSessionLocal() as db:
        return await search_fn(query, org_id, db)


@router.get("")
async def global_search(
    q: str = Query(...),
    types: str | None = Query(None),
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Query must be at least 2 characters")

    default_types = ["agents", "clients", "files", "executions", "missions"]
    requested_types = [item.strip() for item in (types or "").split(",") if item.strip()]
    search_types = requested_types or default_types

    registry: list[tuple[str, SearchFn]] = [
        ("agents", _search_agents),
        ("clients", _search_clients),
        ("files", _search_files),
        ("executions", _search_executions),
        ("missions", _search_missions),
        ("workflows", _search_workflows),
    ]

    is_sqlite = "sqlite" in str(db.bind.url).lower()

    if is_sqlite:
      groups: list[list[dict[str, Any]]] = []
      for type_name, search_fn in registry:
          if type_name not in search_types:
              continue
          groups.append(await search_fn(query, ctx.org.id, db))
    else:
      tasks = [
          _run_search_in_new_session(search_fn, query, ctx.org.id)
          for type_name, search_fn in registry
          if type_name in search_types
      ]
      gathered = await asyncio.gather(*tasks, return_exceptions=True)
      groups = [group for group in gathered if isinstance(group, list)]

    results: list[dict[str, Any]] = []
    for group in groups:
        results.extend(group)

    results.sort(
        key=lambda item: (
            float(item.get("score", 0.0)),
            item.get("created_at", ""),
        ),
        reverse=True,
    )

    return {
        "results": results[:20],
        "total": len(results),
        "query": query,
    }

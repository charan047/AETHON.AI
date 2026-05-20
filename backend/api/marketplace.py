import json
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from config import settings
from database import get_db
from database.models import (
    Agent,
    AgentContract,
    AuditAction,
    ListingStatus,
    ListingType,
    MarketplaceCategory,
    MarketplaceInstall,
    MarketplaceListing,
    MarketplaceReview,
    NotificationPriority,
    InAppNotification,
    Organization,
    OrgMember,
    User,
    Workflow,
)
from services import audit_log_service
from services.agent_naming_service import agent_naming_service
from api.agents import _initialize_agent_identity
from services.marketplace_service import MarketplaceService
from utils.sanitize import sanitize_html, sanitize_text, validate_url


router = APIRouter()
marketplace_service = MarketplaceService()


class ListingPublishRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    tagline: str = Field(..., min_length=1, max_length=500)
    description: str = Field(..., min_length=1, max_length=100000)
    category: MarketplaceCategory = MarketplaceCategory.other
    tags: Optional[str | list[str]] = None
    readme: Optional[str] = None
    preview_image_url: Optional[str] = None
    demo_video_url: Optional[str] = None
    source_url: Optional[str] = None
    is_free: bool = True
    price_usd: float = 0.0


class ListingUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    tagline: Optional[str] = Field(default=None, min_length=1, max_length=500)
    description: Optional[str] = Field(default=None, max_length=100000)
    category: Optional[MarketplaceCategory] = None
    tags: Optional[str | list[str]] = None
    readme: Optional[str] = None
    preview_image_url: Optional[str] = None
    demo_video_url: Optional[str] = None
    source_url: Optional[str] = None
    is_free: Optional[bool] = None
    price_usd: Optional[float] = None


class NewVersionRequest(ListingUpdateRequest):
    template_data: Optional[dict[str, Any]] = None
    version: Optional[str] = None


class InstallRequest(BaseModel):
    agent_name: Optional[str] = None
    workflow_name: Optional[str] = None
    configured_inputs: Optional[dict[str, Any]] = None
    agent_id: Optional[str] = None
    reinstall: bool = False


class ReviewRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    title: Optional[str] = Field(default=None, max_length=255)
    body: Optional[str] = None


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=1)


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


def _parse_json(raw: str | None, fallback=None):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


class _SafeFormatDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _template_payload(listing: MarketplaceListing) -> dict[str, Any]:
    return _parse_json(listing.template_data, {}) or {}


def _render_template(template: str | None, values: dict[str, Any] | None) -> str:
    if not template:
        return ""
    clean_values = {key: value for key, value in (values or {}).items() if value is not None}
    return template.format_map(_SafeFormatDict(clean_values))


async def _apply_template_contract_rules(
    agent_id: str,
    template: dict[str, Any],
    db: AsyncSession,
) -> None:
    contract_cfg = template.get("contract") if isinstance(template, dict) else None
    if not isinstance(contract_cfg, dict):
        return

    contract = await db.scalar(select(AgentContract).where(AgentContract.agent_id == agent_id))
    if not contract:
        return

    requires_approval_for = contract_cfg.get("requires_approval_for")
    if isinstance(requires_approval_for, list):
        contract.requires_approval_for = [str(item) for item in requires_approval_for if str(item).strip()]

    await db.commit()


def _to_role_name(role_slug: str | None, fallback: str) -> str:
    if not role_slug:
        return fallback
    return role_slug.replace("_", " ").title()


def _single_agent_nodes(agent_id: str, agent_name: str) -> list[dict[str, Any]]:
    return [
        {
            "id": "agent_node_1",
            "type": "agentNode",
            "position": {
                "x": 180,
                "y": 180,
            },
            "data": {
                "agent_id": agent_id,
                "label": agent_name,
            },
        }
    ]


def _listing_summary(listing: MarketplaceListing) -> dict:
    payload = _template_payload(listing)
    listing_meta = payload.get("listing", {}) if isinstance(payload, dict) else {}
    return {
        "id": listing.id,
        "publisher_user_id": listing.publisher_user_id,
        "publisher_org_id": listing.publisher_org_id,
        "listing_type": _enum_value(listing.listing_type),
        "category": _enum_value(listing.category),
        "status": _enum_value(listing.status),
        "name": listing.name,
        "slug": listing.slug,
        "tagline": listing.tagline,
        "short_description": listing.short_description or listing_meta.get("short_description", ""),
        "tags": [tag for tag in (listing.tags or "").split(",") if tag],
        "icon": listing.icon or listing_meta.get("icon", "🤖"),
        "author": listing.author,
        "required_tools": listing.required_tools or listing_meta.get("required_tools", []),
        "optional_tools": listing.optional_tools or listing_meta.get("optional_tools", []),
        "required_integrations": listing.required_integrations or listing_meta.get("required_integrations", []),
        "recommended_integrations": listing.recommended_integrations or listing_meta.get("recommended_integrations", []),
        "is_featured": bool(listing.is_featured),
        "role_slug": listing.role_slug or listing_meta.get("role_slug"),
        "department_type": listing.department_type or listing_meta.get("department_type"),
        "hiring_tagline": listing.hiring_tagline or listing_meta.get("hiring_tagline", ""),
        "estimated_minutes_saved_per_week": listing.estimated_minutes_saved_per_week or listing_meta.get(
            "estimated_minutes_saved_per_week",
            0,
        ),
        "difficulty": listing.difficulty or listing_meta.get("difficulty", "beginner"),
        "preview_image_url": listing.preview_image_url,
        "demo_video_url": listing.demo_video_url,
        "source_url": listing.source_url,
        "install_count": listing.install_count,
        "rating_avg": listing.rating_avg,
        "rating_count": listing.rating_count,
        "view_count": listing.view_count,
        "is_free": listing.is_free,
        "price_usd": listing.price_usd,
        "version": listing.version,
        "created_at": listing.created_at,
        "updated_at": listing.updated_at,
        "published_at": listing.published_at,
    }


def _listing_detail(
    listing: MarketplaceListing,
    reviews: list[MarketplaceReview] | None = None,
    publisher: User | None = None,
    publisher_org: Organization | None = None,
    review_users: dict[str, User] | None = None,
    publisher_other_listing_count: int = 0,
) -> dict:
    template_data = _template_payload(listing)
    payload = _listing_summary(listing)
    payload.update(
        {
            "description": listing.description,
            "readme": listing.readme,
            "template_data": template_data,
            "publisher": {
                "id": publisher.id,
                "name": publisher.full_name or publisher.email,
            } if publisher else None,
            "publisher_org": {
                "id": publisher_org.id,
                "name": publisher_org.name,
                "slug": publisher_org.slug,
            } if publisher_org else None,
            "publisher_other_listing_count": publisher_other_listing_count,
            "version_history": _version_history_payload(listing, template_data),
            "reviews": [
                _review_payload(review, (review_users or {}).get(review.reviewer_user_id))
                for review in (reviews or [])
            ],
        }
    )
    return payload


def _review_payload(review: MarketplaceReview, reviewer: User | None = None) -> dict:
    return {
        "id": review.id,
        "listing_id": review.listing_id,
        "reviewer_user_id": review.reviewer_user_id,
        "reviewer": {
            "id": reviewer.id,
            "name": reviewer.full_name or reviewer.email,
        } if reviewer else None,
        "rating": review.rating,
        "title": review.title,
        "body": review.body,
        "helpful_count": review.helpful_count,
        "created_at": review.created_at,
    }


def _version_history_payload(listing: MarketplaceListing, template_data: dict) -> list[dict]:
    raw_history = template_data.get("_version_history") if isinstance(template_data, dict) else None
    history = raw_history if isinstance(raw_history, list) else []
    current = {
        "version": listing.version,
        "status": _enum_value(listing.status),
        "published_at": listing.published_at,
        "created_at": listing.updated_at or listing.created_at,
        "note": "Current version",
    }
    return [current, *history][:3]


def _record_version_history(listing: MarketplaceListing, next_template_data: dict | None) -> dict:
    existing = _parse_json(listing.template_data, {}) or {}
    history = existing.get("_version_history") if isinstance(existing, dict) else None
    prior_versions = history if isinstance(history, list) else []
    prior_entry = {
        "version": listing.version,
        "status": _enum_value(listing.status),
        "published_at": listing.published_at.isoformat() if listing.published_at else None,
        "created_at": (listing.updated_at or listing.created_at).isoformat() if (listing.updated_at or listing.created_at) else None,
        "note": "Previous version",
    }
    payload = dict(next_template_data if next_template_data is not None else existing)
    payload["_version_history"] = [prior_entry, *prior_versions][:2]
    return payload


def _validate_optional_url(value: str | None, field_name: str) -> str | None:
    if value and not validate_url(value):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
    return value


def _sanitize_listing_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(metadata)
    if "name" in cleaned and cleaned["name"] is not None:
        cleaned["name"] = sanitize_text(cleaned["name"].strip(), max_length=255)
    if "tagline" in cleaned and cleaned["tagline"] is not None:
        cleaned["tagline"] = sanitize_text(cleaned["tagline"].strip(), max_length=500)
    if "description" in cleaned and cleaned["description"] is not None:
        cleaned["description"] = sanitize_html(sanitize_text(cleaned["description"], max_length=100000))
    if "readme" in cleaned and cleaned["readme"] is not None:
        cleaned["readme"] = sanitize_html(sanitize_text(cleaned["readme"], max_length=100000))
    for field in ("preview_image_url", "demo_video_url", "source_url"):
        if field in cleaned:
            cleaned[field] = _validate_optional_url(cleaned.get(field), field)
    return cleaned


async def _get_listing_for_publisher(
    listing_id: str,
    current_user: User,
    db: AsyncSession,
) -> MarketplaceListing:
    listing = await db.get(MarketplaceListing, listing_id)
    if not listing or listing.publisher_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Marketplace listing not found")
    return listing


@router.get("/admin/pending")
async def admin_pending_listings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(MarketplaceListing)
        .where(MarketplaceListing.status == ListingStatus.pending)
        .order_by(MarketplaceListing.created_at.asc())
    )
    return [_listing_summary(listing) for listing in result.scalars().all()]


@router.post("/admin/listings/{listing_id}/approve")
async def admin_approve_listing(
    listing_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    try:
        listing = await marketplace_service.approve_listing(listing_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _listing_detail(listing)


@router.post("/admin/listings/{listing_id}/reject")
async def admin_reject_listing(
    listing_id: str,
    data: RejectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    listing = await db.get(MarketplaceListing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Marketplace listing not found")
    listing.status = ListingStatus.rejected
    notification_org_id = listing.publisher_org_id or await db.scalar(
        select(OrgMember.org_id).where(OrgMember.user_id == listing.publisher_user_id).limit(1)
    )
    if notification_org_id:
        db.add(
            InAppNotification(
                org_id=notification_org_id,
                user_id=listing.publisher_user_id,
                title="Marketplace listing rejected",
                message=f"'{listing.name}' was rejected: {data.reason}",
                priority=NotificationPriority.normal,
                action_url="/marketplace/my-listings",
            )
        )
    await db.commit()
    await db.refresh(listing)
    return _listing_detail(listing)


@router.get("")
async def browse_marketplace(
    query: Optional[str] = None,
    category: Optional[MarketplaceCategory] = None,
    listing_type: Optional[ListingType] = Query(default=None, alias="type"),
    sort_by: str = Query(default="popular", pattern="^(popular|newest|rating)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    listings, total = await marketplace_service.search_marketplace(
        query=query,
        category=category,
        listing_type=listing_type,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
        db=db,
    )
    return {
        "items": [_listing_summary(listing) for listing in listings],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/my-installs")
async def my_installs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(MarketplaceInstall, MarketplaceListing)
        .join(MarketplaceListing, MarketplaceInstall.listing_id == MarketplaceListing.id)
        .where(MarketplaceInstall.installer_org_id == ctx.org.id)
        .order_by(MarketplaceInstall.installed_at.desc())
    )
    return [
        {
            "id": install.id,
            "installed_resource_id": install.installed_resource_id,
            "installed_at": install.installed_at,
            "listing": _listing_summary(listing),
            "installed_by_current_user": install.installer_user_id == current_user.id,
        }
        for install, listing in result.all()
    ]


@router.get("/my-listings")
async def my_listings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(MarketplaceListing)
        .where(MarketplaceListing.publisher_user_id == current_user.id)
        .order_by(MarketplaceListing.created_at.desc())
    )
    return [_listing_summary(listing) for listing in result.scalars().all()]


@router.post("/publish/agent/{agent_id}", status_code=status.HTTP_201_CREATED)
async def publish_agent(
    agent_id: str,
    data: ListingPublishRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    metadata = _sanitize_listing_metadata(data.model_dump())
    metadata["org_id"] = ctx.org.id
    try:
        listing = await marketplace_service.publish_agent(agent_id, current_user.id, metadata, db)
    except ValueError as exc:
        detail = str(exc)
        status_code = 400 if detail == "System prompt contains secrets" else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc
    await audit_log_service.log(
        AuditAction.marketplace_published,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="marketplace_listing",
        resource_id=listing.id,
        request=request,
        details={"listing_type": "agent", "name": listing.name},
        db=db,
    )
    return _listing_detail(listing)


@router.post("/publish/workflow/{workflow_id}", status_code=status.HTTP_201_CREATED)
async def publish_workflow(
    workflow_id: str,
    data: ListingPublishRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    metadata = _sanitize_listing_metadata(data.model_dump())
    metadata["org_id"] = ctx.org.id
    try:
        listing = await marketplace_service.publish_workflow(workflow_id, current_user.id, metadata, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await audit_log_service.log(
        AuditAction.marketplace_published,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="marketplace_listing",
        resource_id=listing.id,
        request=request,
        details={"listing_type": "workflow", "name": listing.name},
        db=db,
    )
    return _listing_detail(listing)


@router.post("/publish/tool/{tool_id}", status_code=status.HTTP_201_CREATED)
async def publish_tool_config(
    tool_id: str,
    data: ListingPublishRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    metadata = _sanitize_listing_metadata(data.model_dump())
    metadata["org_id"] = ctx.org.id
    try:
        listing = await marketplace_service.publish_tool_config(tool_id, current_user.id, metadata, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await audit_log_service.log(
        AuditAction.marketplace_published,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="marketplace_listing",
        resource_id=listing.id,
        request=request,
        details={"listing_type": "tool_config", "name": listing.name},
        db=db,
    )
    return _listing_detail(listing)


@router.put("/listings/{listing_id}")
async def update_listing(
    listing_id: str,
    data: ListingUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    listing = await _get_listing_for_publisher(listing_id, current_user, db)
    updates = _sanitize_listing_metadata(data.model_dump(exclude_none=True))
    for field, value in updates.items():
        if field == "tags":
            value = ",".join(value) if isinstance(value, list) else value
        setattr(listing, field, value)
    listing.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(listing)
    return _listing_detail(listing)


@router.post("/listings/{listing_id}/new-version")
async def publish_new_version(
    listing_id: str,
    data: NewVersionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    listing = await _get_listing_for_publisher(listing_id, current_user, db)
    updates = _sanitize_listing_metadata(data.model_dump(exclude_none=True))
    template_data = updates.pop("template_data", None)
    version = updates.pop("version", None)
    for field, value in updates.items():
        if field == "tags":
            value = ",".join(value) if isinstance(value, list) else value
        setattr(listing, field, value)
    listing.template_data = json.dumps(_record_version_history(listing, template_data))
    listing.version = version or _bump_patch_version(listing.version)
    listing.status = ListingStatus.pending
    listing.published_at = None
    listing.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(listing)
    return _listing_detail(listing)


@router.post("/{listing_id}/install")
async def install_marketplace_listing(
    listing_id: str,
    data: InstallRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    listing = await db.get(MarketplaceListing, listing_id)
    if not listing or listing.status != ListingStatus.published:
        raise HTTPException(status_code=404, detail="Marketplace listing not found")

    body = data or InstallRequest()
    template = _template_payload(listing)
    listing_cfg = template.get("listing", {}) if isinstance(template, dict) else {}
    agent_cfg = template.get("agent", {}) if isinstance(template, dict) else {}
    workflow_cfg = template.get("workflow", {}) if isinstance(template, dict) else {}
    existing_install = await db.scalar(
        select(MarketplaceInstall).where(
            MarketplaceInstall.listing_id == listing_id,
            MarketplaceInstall.installer_org_id == ctx.org.id,
        )
    )
    if existing_install and not body.reinstall:
        raise HTTPException(
            status_code=409,
            detail=f"'{listing.name}' is already installed in this organization. Enable reinstall to create a fresh copy.",
        )
    if not agent_cfg or not workflow_cfg:
        try:
            return await marketplace_service.install_listing(
                listing_id=listing_id,
                user_id=current_user.id,
                org_id=ctx.org.id,
                db=db,
                options=body.model_dump(),
            )
        except ValueError as exc:
            message = str(exc)
            status_code = 403 if "before reviewing" in message.lower() else 400
            raise HTTPException(status_code=status_code, detail=message) from exc
    configured_inputs = body.configured_inputs or {}

    await check_plan_limit("agents", ctx.org, db)
    await check_plan_limit("workflows", ctx.org, db)
    if workflow_cfg.get("trigger_type") == "schedule":
        await check_plan_limit("scheduling", ctx.org, db)

    agent_name = body.agent_name or agent_cfg.get("name") or listing.name
    workflow_name = body.workflow_name or workflow_cfg.get("name") or listing.name
    rendered_system_prompt = _render_template(agent_cfg.get("system_prompt"), configured_inputs)
    rendered_input_template = _render_template(workflow_cfg.get("input_template"), configured_inputs)
    role_slug = agent_cfg.get("role_slug") or listing.role_slug
    department_type = agent_cfg.get("department_type") or listing.department_type or "research"

    agent = Agent(
        id=str(uuid4()),
        org_id=ctx.org.id,
        name=agent_name,
        role=_to_role_name(role_slug, agent_name),
        description=listing.short_description or workflow_cfg.get("description", ""),
        system_prompt=rendered_system_prompt,
        model=agent_cfg.get("model", settings.default_model),
        role_slug=role_slug,
        seniority_level=agent_cfg.get("seniority_level", 1),
        autonomy_level=agent_cfg.get("autonomy_level", "supervised"),
        trust_score=agent_cfg.get("initial_trust_score", 50.0),
        tools=agent_cfg.get("tools", []),
        temperature=agent_cfg.get("temperature", 0.2),
        max_iterations=agent_cfg.get("max_iterations", 15),
        installed_from_listing_id=listing.id,
        created_by_user_id=current_user.id,
    )

    if not agent.persona_name:
        taken = await agent_naming_service.get_taken_names(str(ctx.org.id), db)
        suggestions = agent_naming_service.suggest_names(
            department_type=department_type,
            count=1,
            exclude=taken,
        )
        if suggestions:
            agent.persona_name = suggestions[0]

    db.add(agent)
    await db.flush()

    workflow = Workflow(
        id=str(uuid4()),
        org_id=ctx.org.id,
        name=workflow_name,
        description=workflow_cfg.get("description", ""),
        nodes=_single_agent_nodes(agent.id, agent.name),
        edges=[],
        status="draft",
        trigger=workflow_cfg.get("trigger_type", "manual"),
        schedule=workflow_cfg.get("schedule"),
        input_template=rendered_input_template,
        input_variables=workflow_cfg.get("input_variables", []),
        configured_inputs=configured_inputs,
        installed_from_listing_id=listing.id,
        created_by_user_id=current_user.id,
        execution_mode="sequential",
    )
    db.add(workflow)

    if existing_install:
        existing_install.installed_resource_id = agent.id
        existing_install.installer_user_id = current_user.id
        existing_install.installed_at = datetime.now(timezone.utc)
        install_record = existing_install
    else:
        install_record = MarketplaceInstall(
            id=str(uuid4()),
            listing_id=listing.id,
            installer_user_id=current_user.id,
            installer_org_id=ctx.org.id,
            installed_resource_id=agent.id,
        )
        db.add(install_record)
    await db.execute(
        update(MarketplaceListing)
        .where(MarketplaceListing.id == listing.id)
        .values(install_count=MarketplaceListing.install_count + 1)
    )
    await db.commit()
    await db.refresh(agent)
    await _initialize_agent_identity(
        agent_id=str(agent.id),
        role_slug=agent.role_slug,
        db=db,
    )
    await _apply_template_contract_rules(str(agent.id), template, db)
    if agent.persona_name:
        await agent_naming_service.seed_identity_memory(
            agent_id=str(agent.id),
            org_id=str(agent.org_id),
            persona_name=agent.persona_name,
            role_display=agent.role or agent.role_slug or "Aethon teammate",
            company_name=ctx.org.name if getattr(ctx.org, "name", None) else "our company",
            department_type=department_type,
            db=db,
        )

    input_variables = workflow.input_variables or []
    needs_configuration = bool(input_variables) and not bool(workflow.configured_inputs)
    return {
        "success": True,
        "agent_id": agent.id,
        "workflow_id": workflow.id,
        "agent_name": agent.name,
        "message": f"'{listing.name}' installed successfully",
        "role": role_slug or "",
        "autonomy_level": agent.autonomy_level,
        "trust_score": agent.trust_score,
        "type": _enum_value(listing.listing_type),
        "resource_id": agent.id,
        "reinstalled": bool(existing_install),
        "what_they_can_do": [f"Use {tool_name}" for tool_name in (agent.tools or [])[:4]],
        "needs_configuration": needs_configuration,
        "next_step": "configure" if needs_configuration else "ready",
    }


@router.post("/{listing_id}/review", status_code=status.HTTP_201_CREATED)
async def review_listing(
    listing_id: str,
    data: ReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        review = await marketplace_service.submit_review(
            listing_id,
            current_user.id,
            data.rating,
            data.title,
            data.body,
            db,
        )
    except ValueError as exc:
        message = str(exc)
        status_code = 403 if "before reviewing" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from exc
    return _review_payload(review)


@router.get("/{slug}")
async def marketplace_detail(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(MarketplaceListing).where(MarketplaceListing.slug == slug))
    listing = result.scalar_one_or_none()
    if not listing or listing.status != ListingStatus.published:
        raise HTTPException(status_code=404, detail="Marketplace listing not found")

    listing.view_count = int(listing.view_count or 0) + 1
    reviews_result = await db.execute(
        select(MarketplaceReview)
        .where(MarketplaceReview.listing_id == listing.id)
        .order_by(MarketplaceReview.helpful_count.desc(), MarketplaceReview.created_at.desc())
        .limit(10)
    )
    reviews = reviews_result.scalars().all()
    review_users = {}
    reviewer_ids = [review.reviewer_user_id for review in reviews]
    if reviewer_ids:
        users_result = await db.execute(select(User).where(User.id.in_(reviewer_ids)))
        review_users = {user.id: user for user in users_result.scalars().all()}
    publisher_other_listing_count = await db.scalar(
        select(func.count(MarketplaceListing.id)).where(
            MarketplaceListing.publisher_user_id == listing.publisher_user_id,
            MarketplaceListing.id != listing.id,
            MarketplaceListing.status == ListingStatus.published,
        )
    ) or 0
    publisher = await db.get(User, listing.publisher_user_id)
    publisher_org = await db.get(Organization, listing.publisher_org_id) if listing.publisher_org_id else None
    await db.commit()
    await db.refresh(listing)
    return _listing_detail(
        listing,
        reviews,
        publisher,
        publisher_org,
        review_users=review_users,
        publisher_other_listing_count=publisher_other_listing_count,
    )


def _bump_patch_version(version: str | None) -> str:
    try:
        major, minor, patch = [int(part) for part in (version or "1.0.0").split(".")[:3]]
        return f"{major}.{minor}.{patch + 1}"
    except Exception:
        return "1.0.1"

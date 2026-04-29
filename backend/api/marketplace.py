import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database import get_db
from database.models import (
    ListingStatus,
    ListingType,
    MarketplaceCategory,
    MarketplaceInstall,
    MarketplaceListing,
    MarketplaceReview,
    NotificationPriority,
    InAppNotification,
    Organization,
    User,
)
from services.marketplace_service import MarketplaceService


router = APIRouter()
marketplace_service = MarketplaceService()


class ListingPublishRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    tagline: str = Field(..., min_length=1, max_length=500)
    description: str = Field(..., min_length=1)
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
    description: Optional[str] = None
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


def _listing_summary(listing: MarketplaceListing) -> dict:
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
        "tags": [tag for tag in (listing.tags or "").split(",") if tag],
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
) -> dict:
    payload = _listing_summary(listing)
    payload.update(
        {
            "description": listing.description,
            "readme": listing.readme,
            "template_data": _parse_json(listing.template_data, {}),
            "publisher": {
                "id": publisher.id,
                "name": publisher.full_name or publisher.email,
            } if publisher else None,
            "publisher_org": {
                "id": publisher_org.id,
                "name": publisher_org.name,
                "slug": publisher_org.slug,
            } if publisher_org else None,
            "reviews": [_review_payload(review) for review in (reviews or [])],
        }
    )
    return payload


def _review_payload(review: MarketplaceReview) -> dict:
    return {
        "id": review.id,
        "listing_id": review.listing_id,
        "reviewer_user_id": review.reviewer_user_id,
        "rating": review.rating,
        "title": review.title,
        "body": review.body,
        "helpful_count": review.helpful_count,
        "created_at": review.created_at,
    }


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
    db.add(
        InAppNotification(
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    metadata = data.model_dump()
    metadata["org_id"] = ctx.org.id
    try:
        listing = await marketplace_service.publish_agent(agent_id, current_user.id, metadata, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _listing_detail(listing)


@router.post("/publish/workflow/{workflow_id}", status_code=status.HTTP_201_CREATED)
async def publish_workflow(
    workflow_id: str,
    data: ListingPublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    metadata = data.model_dump()
    metadata["org_id"] = ctx.org.id
    try:
        listing = await marketplace_service.publish_workflow(workflow_id, current_user.id, metadata, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _listing_detail(listing)


@router.put("/listings/{listing_id}")
async def update_listing(
    listing_id: str,
    data: ListingUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    listing = await _get_listing_for_publisher(listing_id, current_user, db)
    for field, value in data.model_dump(exclude_none=True).items():
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
    updates = data.model_dump(exclude_none=True)
    template_data = updates.pop("template_data", None)
    version = updates.pop("version", None)
    for field, value in updates.items():
        if field == "tags":
            value = ",".join(value) if isinstance(value, list) else value
        setattr(listing, field, value)
    if template_data is not None:
        listing.template_data = json.dumps(template_data)
    listing.version = version or _bump_patch_version(listing.version)
    listing.status = ListingStatus.pending
    listing.published_at = None
    listing.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(listing)
    return _listing_detail(listing)


@router.post("/{listing_id}/install")
async def install_listing(
    listing_id: str,
    data: InstallRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    listing = await db.get(MarketplaceListing, listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Marketplace listing not found")
    listing_type = ListingType(_enum_value(listing.listing_type))
    template = _parse_json(listing.template_data, {})
    if listing_type == ListingType.agent:
        await check_plan_limit("agents", ctx.org, db)
        if template.get("memory_enabled", False):
            await check_plan_limit("memory_enabled", ctx.org, db)
    elif listing_type == ListingType.workflow:
        await check_plan_limit("workflows", ctx.org, db)
        if any((node or {}).get("type") == "parallel_group" for node in template.get("nodes", [])):
            await check_plan_limit("parallel_execution", ctx.org, db)
    elif listing_type == ListingType.eval_suite:
        await check_plan_limit("eval_suites", ctx.org, db)

    try:
        return await marketplace_service.install_listing(
            listing_id=listing_id,
            user_id=current_user.id,
            org_id=ctx.org.id,
            db=db,
            options=(data or InstallRequest()).model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
    publisher = await db.get(User, listing.publisher_user_id)
    publisher_org = await db.get(Organization, listing.publisher_org_id) if listing.publisher_org_id else None
    await db.commit()
    await db.refresh(listing)
    return _listing_detail(listing, reviews_result.scalars().all(), publisher, publisher_org)


def _bump_patch_version(version: str | None) -> str:
    try:
        major, minor, patch = [int(part) for part in (version or "1.0.0").split(".")[:3]]
        return f"{major}.{minor}.{patch + 1}"
    except Exception:
        return "1.0.1"

import json
import logging
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from database.models import ListingStatus, ListingType, MarketplaceCategory, MarketplaceListing, Organization, User
from marketplace.templates.client_reporter import TEMPLATE as CLIENT_REPORTER
from marketplace.templates.competitor_monitor import TEMPLATE as COMPETITOR_MONITOR
from marketplace.templates.content_writer import TEMPLATE as CONTENT_WRITER
from marketplace.templates.lead_qualifier import TEMPLATE as LEAD_QUALIFIER
from marketplace.templates.market_researcher import TEMPLATE as MARKET_RESEARCHER
from marketplace.templates.outreach_agent import TEMPLATE as OUTREACH_AGENT
from marketplace.templates.research_analyst import TEMPLATE as RESEARCH_ANALYST
from marketplace.templates.support_analyst import TEMPLATE as SUPPORT_ANALYST
from marketplace.templates.support_triage import TEMPLATE as SUPPORT_TRIAGE


logger = logging.getLogger(__name__)

_CATEGORY_MAP = {
    "content": MarketplaceCategory.marketing,
    "sales": MarketplaceCategory.operations,
    "support": MarketplaceCategory.customer_support,
}

_TOOL_MAP = {
    "google_docs_create": "google_docs",
    "google_sheets_create": "google_sheets",
}

TEMPLATES = [
    MARKET_RESEARCHER,
    CONTENT_WRITER,
    LEAD_QUALIFIER,
    SUPPORT_TRIAGE,
    COMPETITOR_MONITOR,
    CLIENT_REPORTER,
    OUTREACH_AGENT,
    RESEARCH_ANALYST,
    SUPPORT_ANALYST,
]


def _normalize_category(raw: str) -> MarketplaceCategory:
    if raw in _CATEGORY_MAP:
        return _CATEGORY_MAP[raw]
    return MarketplaceCategory(raw)


def _normalize_tools(items: list[str]) -> list[str]:
    return [_TOOL_MAP.get(item, item) for item in items]


async def seed_marketplace_templates(db: AsyncSession) -> None:
    publisher = await db.scalar(
        select(User).order_by(
            (User.role == "admin").desc(),
            User.created_at.asc(),
        )
    )
    if not publisher:
        logger.warning("Skipping marketplace template seed because no users exist yet.")
        return

    publisher_org_id = await db.scalar(
        select(Organization.id)
        .where(Organization.owner_user_id == publisher.id)
        .order_by(Organization.created_at.asc())
        .limit(1)
    )

    logger.info("Seeding %s marketplace templates...", len(TEMPLATES))
    for template in TEMPLATES:
        listing_cfg = template["listing"]
        agent_cfg = dict(template["agent"])
        workflow_cfg = dict(template["workflow"])
        agent_cfg["tools"] = _normalize_tools(agent_cfg.get("tools", []))
        normalized_listing = {
            **listing_cfg,
            "required_tools": _normalize_tools(listing_cfg.get("required_tools", [])),
            "optional_tools": _normalize_tools(listing_cfg.get("optional_tools", [])),
        }
        persisted_template = {
            **template,
            "listing": normalized_listing,
            "agent": agent_cfg,
            "workflow": workflow_cfg,
        }
        values = {
            "id": str(uuid4()),
            "publisher_user_id": publisher.id,
            "publisher_org_id": publisher_org_id,
            "listing_type": ListingType.agent.value,
            "category": _normalize_category(listing_cfg["category"]).value,
            "status": ListingStatus.published.value,
            "name": listing_cfg["name"],
            "slug": listing_cfg["slug"],
            "tagline": listing_cfg["short_description"],
            "short_description": listing_cfg["short_description"],
            "description": listing_cfg["description"],
            "readme": None,
            "template_data": json.dumps(
                persisted_template
            ),
            "tags": ",".join(listing_cfg.get("tags", [])),
            "icon": listing_cfg.get("icon", "🤖"),
            "required_tools": normalized_listing["required_tools"],
            "optional_tools": normalized_listing["optional_tools"],
            "required_integrations": listing_cfg.get("required_integrations", []),
            "recommended_integrations": listing_cfg.get("recommended_integrations", []),
            "is_free": True,
            "is_featured": listing_cfg.get("is_featured", False),
            "author": "Aethon",
            "role_slug": listing_cfg.get("role_slug"),
            "department_type": listing_cfg.get("department_type"),
            "hiring_tagline": listing_cfg.get("hiring_tagline", ""),
            "estimated_minutes_saved_per_week": listing_cfg.get("estimated_minutes_saved_per_week", 0),
            "difficulty": listing_cfg.get("difficulty", "beginner"),
            "price_usd": 0.0,
            "version": listing_cfg.get("version", "1.0.0"),
            "published_at": func.now(),
        }
        stmt = pg_insert(MarketplaceListing.__table__).values(**values)
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["slug"],
                set_={
                    "publisher_user_id": publisher.id,
                    "publisher_org_id": publisher_org_id,
                    "listing_type": ListingType.agent.value,
                    "category": _normalize_category(listing_cfg["category"]).value,
                    "status": ListingStatus.published.value,
                    "name": listing_cfg["name"],
                    "tagline": listing_cfg["short_description"],
                    "short_description": listing_cfg["short_description"],
                    "description": listing_cfg["description"],
                    "template_data": values["template_data"],
                    "tags": values["tags"],
                    "icon": values["icon"],
                    "required_tools": values["required_tools"],
                    "optional_tools": values["optional_tools"],
                    "required_integrations": values["required_integrations"],
                    "recommended_integrations": values["recommended_integrations"],
                    "is_featured": values["is_featured"],
                    "author": "Aethon",
                    "role_slug": values["role_slug"],
                    "department_type": values["department_type"],
                    "hiring_tagline": values["hiring_tagline"],
                    "estimated_minutes_saved_per_week": values["estimated_minutes_saved_per_week"],
                    "difficulty": values["difficulty"],
                    "version": values["version"],
                    "published_at": func.now(),
                },
            )
        )

    await db.commit()
    logger.info("Seeded %s marketplace templates ✓", len(TEMPLATES))

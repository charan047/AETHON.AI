import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import (
    Agent,
    CustomTool,
    EvalCase,
    EvalSuite,
    ListingStatus,
    ListingType,
    MarketplaceCategory,
    MarketplaceInstall,
    MarketplaceListing,
    MarketplaceReview,
    NotificationPriority,
    InAppNotification,
    OrgMember,
    ScoringMethod,
    Workflow,
)
from services.websocket_manager import ws_manager
from utils.sanitize import sanitize_html, sanitize_text
from utils.secret_scanner import redact_secrets, scan_for_secrets


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


class MarketplaceService:
    async def _resolve_user_org_id(self, user_id: str, db: AsyncSession) -> str | None:
        return await db.scalar(
            select(OrgMember.org_id).where(OrgMember.user_id == user_id).limit(1)
        )

    async def publish_agent(
        self,
        agent_id: str,
        user_id: str,
        metadata: dict,
        db: AsyncSession,
    ) -> MarketplaceListing:
        agent = await db.get(Agent, agent_id)
        if not agent or metadata.get("org_id") and agent.org_id != metadata["org_id"]:
            raise ValueError("Agent not found")
        if scan_for_secrets(agent.system_prompt):
            raise ValueError("System prompt contains secrets")

        template_data = {
            "name": agent.name,
            "role": agent.role,
            "description": agent.description,
            "system_prompt": self._sanitize_text(agent.system_prompt),
            "tools": self._sanitize_tools(agent.tools or []),
            "model_preference": agent.model,
            "memory_enabled": bool(agent.memory_enabled),
            "max_tokens": agent.max_tokens,
            "temperature": agent.temperature,
            "max_iterations": agent.max_iterations,
            "timeout": agent.timeout,
            "max_retries": agent.max_retries,
            "retry_delay_seconds": agent.retry_delay_seconds,
            "retry_backoff_multiplier": agent.retry_backoff_multiplier,
            "retry_on_timeout": agent.retry_on_timeout,
        }
        return await self._create_listing(
            user_id=user_id,
            org_id=agent.org_id,
            listing_type=ListingType.agent,
            metadata=metadata,
            template_data=template_data,
            db=db,
        )

    async def publish_workflow(
        self,
        workflow_id: str,
        user_id: str,
        metadata: dict,
        db: AsyncSession,
    ) -> MarketplaceListing:
        workflow = await db.get(Workflow, workflow_id)
        if not workflow or metadata.get("org_id") and workflow.org_id != metadata["org_id"]:
            raise ValueError("Workflow not found")

        nodes = await self._sanitize_workflow_nodes(workflow.nodes or [], workflow.org_id, db)
        template_data = {
            "name": workflow.name,
            "description": workflow.description,
            "nodes": nodes,
            "edges": workflow.edges or [],
            "execution_mode": workflow.execution_mode,
            "orchestration_prompt": self._sanitize_text(workflow.orchestration_prompt or "", max_length=50000),
            "max_cycles": workflow.max_cycles,
        }
        return await self._create_listing(
            user_id=user_id,
            org_id=workflow.org_id,
            listing_type=ListingType.workflow,
            metadata=metadata,
            template_data=template_data,
            db=db,
        )

    async def publish_tool_config(
        self,
        tool_id: str,
        user_id: str,
        metadata: dict,
        db: AsyncSession,
    ) -> MarketplaceListing:
        tool = await db.get(CustomTool, tool_id)
        if not tool or metadata.get("org_id") and tool.org_id != metadata["org_id"]:
            raise ValueError("Tool config not found")

        template_data = {
            "name": tool.name,
            "description": self._sanitize_text(tool.description, max_length=10000),
            "code": self._sanitize_text(tool.code, max_length=100000),
            "is_active": True,
        }
        return await self._create_listing(
            user_id=user_id,
            org_id=tool.org_id,
            listing_type=ListingType.tool_config,
            metadata=metadata,
            template_data=template_data,
            db=db,
        )

    async def install_listing(
        self,
        listing_id: str,
        user_id: str,
        org_id: str,
        db: AsyncSession,
        options: dict | None = None,
    ) -> dict:
        listing = await db.get(MarketplaceListing, listing_id)
        if not listing or listing.status != ListingStatus.published:
            raise ValueError("Marketplace listing not found or not published")

        existing = await db.scalar(
            select(MarketplaceInstall).where(
                MarketplaceInstall.listing_id == listing_id,
                MarketplaceInstall.installer_org_id == org_id,
            )
        )
        reinstall = bool((options or {}).get("reinstall"))
        if existing and not reinstall:
            return {
                "installed": False,
                "already_installed": True,
                "resource_id": existing.installed_resource_id,
                "type": _enum_value(listing.listing_type),
            }

        template = json.loads(listing.template_data)
        listing_type = ListingType(_enum_value(listing.listing_type))
        if listing_type == ListingType.agent:
            resource_id = await self._install_agent(template, org_id, db)
        elif listing_type == ListingType.workflow:
            resource_id = await self._install_workflow(template, org_id, db)
        elif listing_type == ListingType.tool_config:
            resource_id = await self._install_tool_config(template, org_id, db)
        elif listing_type == ListingType.eval_suite:
            resource_id = await self._install_eval_suite(template, user_id, org_id, db, options or {})
        else:
            raise ValueError("Unsupported listing type")

        if existing:
            existing.installer_user_id = user_id
            existing.installed_resource_id = resource_id
            existing.installed_at = datetime.now(timezone.utc)
            db.add(existing)
        else:
            install = MarketplaceInstall(
                id=str(uuid.uuid4()),
                listing_id=listing_id,
                installer_user_id=user_id,
                installer_org_id=org_id,
                installed_resource_id=resource_id,
            )
            listing.install_count = int(listing.install_count or 0) + 1
            db.add(install)
        await db.commit()
        if listing_type == ListingType.agent:
            from api.agents import _initialize_agent_identity

            await _initialize_agent_identity(
                agent_id=resource_id,
                role_slug=template.get("role_slug"),
                db=db,
            )
        return {
            "installed": True,
            "reinstalled": bool(existing),
            "resource_id": resource_id,
            "type": _enum_value(listing.listing_type),
        }

    async def search_marketplace(
        self,
        query: str | None = None,
        category: MarketplaceCategory | None = None,
        listing_type: ListingType | None = None,
        sort_by: str = "popular",
        limit: int = 20,
        offset: int = 0,
        db: AsyncSession | None = None,
    ) -> tuple[list[MarketplaceListing], int]:
        if db is None:
            raise ValueError("Database session is required")

        conditions = [MarketplaceListing.status == ListingStatus.published]
        if query:
            pattern = f"%{query.strip()}%"
            conditions.append(
                or_(
                    MarketplaceListing.name.ilike(pattern),
                    MarketplaceListing.tagline.ilike(pattern),
                    MarketplaceListing.tags.ilike(pattern),
                )
            )
        if category:
            conditions.append(MarketplaceListing.category == category)
        if listing_type:
            conditions.append(MarketplaceListing.listing_type == listing_type)

        total = await db.scalar(select(func.count(MarketplaceListing.id)).where(*conditions)) or 0
        stmt = select(MarketplaceListing).where(*conditions)
        if sort_by == "newest":
            stmt = stmt.order_by(MarketplaceListing.published_at.desc().nullslast(), MarketplaceListing.created_at.desc())
        elif sort_by == "rating":
            stmt = stmt.order_by(MarketplaceListing.rating_avg.desc(), MarketplaceListing.rating_count.desc())
        else:
            stmt = stmt.order_by(MarketplaceListing.install_count.desc(), MarketplaceListing.published_at.desc().nullslast())

        result = await db.execute(stmt.offset(offset).limit(limit))
        return result.scalars().all(), total

    async def submit_review(
        self,
        listing_id: str,
        reviewer_user_id: str,
        rating: int,
        title: str | None,
        body: str | None,
        db: AsyncSession,
    ) -> MarketplaceReview:
        if rating < 1 or rating > 5:
            raise ValueError("Rating must be between 1 and 5")

        install = await db.scalar(
            select(MarketplaceInstall).where(
                MarketplaceInstall.listing_id == listing_id,
                MarketplaceInstall.installer_user_id == reviewer_user_id,
            )
        )
        if not install:
            raise ValueError("Install this listing before reviewing it")

        existing = await db.scalar(
            select(MarketplaceReview).where(
                MarketplaceReview.listing_id == listing_id,
                MarketplaceReview.reviewer_user_id == reviewer_user_id,
            )
        )
        if existing:
            existing.rating = rating
            existing.title = title
            existing.body = body
            review = existing
        else:
            review = MarketplaceReview(
                id=str(uuid.uuid4()),
                listing_id=listing_id,
                reviewer_user_id=reviewer_user_id,
                rating=rating,
                title=title,
                body=body,
            )
            db.add(review)

        await db.flush()
        await self._recalculate_rating(listing_id, db)
        await db.commit()
        await db.refresh(review)
        return review

    async def approve_listing(
        self,
        listing_id: str,
        db: AsyncSession,
    ) -> MarketplaceListing:
        listing = await db.get(MarketplaceListing, listing_id)
        if not listing:
            raise ValueError("Marketplace listing not found")
        listing.status = ListingStatus.published
        listing.published_at = datetime.now(timezone.utc)
        notification_org_id = listing.publisher_org_id or await self._resolve_user_org_id(listing.publisher_user_id, db)
        if notification_org_id:
            db.add(
                InAppNotification(
                    org_id=notification_org_id,
                    user_id=listing.publisher_user_id,
                    title="Marketplace listing approved",
                    message=f"'{listing.name}' is now published in the marketplace.",
                    priority=NotificationPriority.normal,
                    action_url=f"/marketplace/{listing.slug}",
                )
            )
        await db.commit()
        await db.refresh(listing)
        return listing

    async def _create_listing(
        self,
        user_id: str,
        org_id: str | None,
        listing_type: ListingType,
        metadata: dict,
        template_data: dict,
        db: AsyncSession,
    ) -> MarketplaceListing:
        name = metadata["name"].strip()
        listing = MarketplaceListing(
            id=str(uuid.uuid4()),
            publisher_user_id=user_id,
            publisher_org_id=org_id,
            listing_type=listing_type,
            category=MarketplaceCategory(metadata.get("category") or MarketplaceCategory.other.value),
            status=ListingStatus.pending,
            name=name,
            slug=await self._unique_slug(name, db),
            tagline=self._sanitize_text(metadata["tagline"].strip(), max_length=500),
            description=sanitize_html(self._sanitize_text(metadata["description"].strip(), max_length=100000)),
            readme=sanitize_html(self._sanitize_text(metadata.get("readme") or "", max_length=100000)) or None,
            template_data=json.dumps(template_data),
            tags=self._normalize_tags(metadata.get("tags")),
            preview_image_url=metadata.get("preview_image_url"),
            demo_video_url=metadata.get("demo_video_url"),
            source_url=metadata.get("source_url"),
            is_free=metadata.get("is_free", True),
            price_usd=metadata.get("price_usd", 0.0),
            version=metadata.get("version") or "1.0.0",
        )
        db.add(listing)
        await db.commit()
        await db.refresh(listing)
        await ws_manager.broadcast(
            {
                "type": "marketplace_listing_submitted",
                "listing_id": listing.id,
                "listing_type": listing_type.value,
                "name": listing.name,
            }
        )
        return listing

    async def _install_agent(self, template: dict, org_id: str, db: AsyncSession) -> str:
        agent = Agent(
            id=str(uuid.uuid4()),
            org_id=org_id,
            name=template.get("name", "Marketplace Agent"),
            role=template.get("role", template.get("name", "agent")),
            description=template.get("description", ""),
            system_prompt=template.get("system_prompt", ""),
            tools=template.get("tools", []),
            model=template.get("model_preference") or settings.default_model,
            memory_enabled=template.get("memory_enabled", True),
            max_tokens=template.get("max_tokens", 2000),
            temperature=template.get("temperature", 0.7),
            max_iterations=template.get("max_iterations", 10),
            timeout=template.get("timeout", 120),
            max_retries=template.get("max_retries", 3),
            retry_delay_seconds=template.get("retry_delay_seconds", 5),
            retry_backoff_multiplier=template.get("retry_backoff_multiplier", 2.0),
            retry_on_timeout=template.get("retry_on_timeout", True),
        )
        db.add(agent)
        await db.flush()
        return agent.id

    async def _install_workflow(self, template: dict, org_id: str, db: AsyncSession) -> str:
        workflow = Workflow(
            id=str(uuid.uuid4()),
            org_id=org_id,
            name=template.get("name", "Marketplace Workflow"),
            description=template.get("description", ""),
            nodes=self._clear_agent_assignments(template.get("nodes", [])),
            edges=template.get("edges", []),
            execution_mode=template.get("execution_mode", "sequential"),
            orchestration_prompt=template.get("orchestration_prompt", ""),
            max_cycles=template.get("max_cycles", 10),
            status="draft",
        )
        db.add(workflow)
        await db.flush()
        return workflow.id

    async def _install_tool_config(self, template: dict, org_id: str, db: AsyncSession) -> str:
        tool = CustomTool(
            id=str(uuid.uuid4()),
            org_id=org_id,
            name=await self._unique_tool_name(template.get("name", "marketplace_tool"), db),
            description=template.get("description", ""),
            code=template.get("code", ""),
            is_active=template.get("is_active", True),
        )
        db.add(tool)
        await db.flush()
        return tool.id

    async def _install_eval_suite(
        self,
        template: dict,
        user_id: str,
        org_id: str,
        db: AsyncSession,
        options: dict,
    ) -> str:
        agent_id = options.get("agent_id")
        if not agent_id:
            raise ValueError("Installing an eval suite requires agent_id")
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id))
        if not agent:
            raise ValueError("Target agent not found")

        suite = EvalSuite(
            id=str(uuid.uuid4()),
            org_id=org_id,
            user_id=user_id,
            agent_id=agent_id,
            name=template.get("name", "Marketplace Eval Suite"),
            description=template.get("description"),
            pass_threshold=template.get("pass_threshold", 0.8),
        )
        db.add(suite)
        await db.flush()
        for case_data in template.get("cases", []):
            db.add(
                EvalCase(
                    id=str(uuid.uuid4()),
                    suite_id=suite.id,
                    name=case_data.get("name", "Marketplace case"),
                    description=case_data.get("description"),
                    input=case_data.get("input", ""),
                    expected_output=case_data.get("expected_output"),
                    scoring_method=ScoringMethod(case_data.get("scoring_method", "llm_judge")),
                    scoring_config=json.dumps(case_data.get("scoring_config") or {}),
                    weight=case_data.get("weight", 1.0),
                    tags=case_data.get("tags"),
                )
            )
        await db.flush()
        return suite.id

    async def _sanitize_workflow_nodes(self, nodes: list[dict], org_id: str, db: AsyncSession) -> list[dict]:
        agent_ids = set()
        for node in nodes:
            data = (node or {}).get("data") or {}
            if data.get("agent_id"):
                agent_ids.add(data["agent_id"])
            for agent_id in data.get("agent_ids") or []:
                agent_ids.add(agent_id)

        agent_map = {}
        if agent_ids:
            result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids), Agent.org_id == org_id))
            agent_map = {
                agent.id: {"name": agent.name, "role": agent.role, "description": agent.description}
                for agent in result.scalars().all()
            }

        sanitized = []
        for node in nodes:
            clone = json.loads(json.dumps(node or {}))
            data = clone.setdefault("data", {})
            if data.get("agent_id"):
                data["agent_ref"] = agent_map.get(data["agent_id"], {"role": data.get("role") or data.get("label")})
                data["agent_id"] = None
            if data.get("agent_ids"):
                data["agent_refs"] = [agent_map.get(agent_id, {"role": "agent"}) for agent_id in data["agent_ids"]]
                data["agent_ids"] = []
            sanitized.append(clone)
        return sanitized

    def _clear_agent_assignments(self, nodes: list[dict]) -> list[dict]:
        cleared = []
        for node in nodes:
            clone = json.loads(json.dumps(node or {}))
            data = clone.setdefault("data", {})
            if "agent_id" in data:
                data["agent_id"] = None
            if "agent_ids" in data:
                data["agent_ids"] = []
            cleared.append(clone)
        return cleared

    def _sanitize_text(self, value: str, max_length: int = 10000) -> str:
        return redact_secrets(sanitize_text(value or "", max_length=max_length) or "") or ""

    def _sanitize_tools(self, tools: list[Any]) -> list[str]:
        return [str(tool) for tool in tools if isinstance(tool, (str, int, float))]

    def _normalize_tags(self, tags: str | list[str] | None) -> str | None:
        if not tags:
            return None
        if isinstance(tags, str):
            values = [tag.strip().lower() for tag in tags.split(",")]
        else:
            values = [str(tag).strip().lower() for tag in tags]
        return ",".join(dict.fromkeys(tag for tag in values if tag))

    async def _unique_slug(self, name: str, db: AsyncSession) -> str:
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:220] or "listing"
        candidate = base
        suffix = 2
        while await db.scalar(select(MarketplaceListing.id).where(MarketplaceListing.slug == candidate)):
            candidate = f"{base[:210]}-{suffix}"
            suffix += 1
        return candidate

    async def _unique_tool_name(self, name: str, db: AsyncSession) -> str:
        base = re.sub(r"[^a-zA-Z0-9_]+", "_", (name or "marketplace_tool").strip().lower()).strip("_")
        if not base or not re.match(r"^[a-zA-Z_]", base):
            base = f"tool_{base}" if base else "marketplace_tool"
        base = base[:45]
        candidate = base
        suffix = 2
        while await db.scalar(select(CustomTool.id).where(CustomTool.name == candidate)):
            candidate = f"{base[:42]}_{suffix}"
            suffix += 1
        return candidate

    async def _recalculate_rating(self, listing_id: str, db: AsyncSession) -> None:
        result = await db.execute(
            select(func.count(MarketplaceReview.id), func.avg(MarketplaceReview.rating)).where(
                MarketplaceReview.listing_id == listing_id
            )
        )
        rating_count, rating_avg = result.one()
        listing = await db.get(MarketplaceListing, listing_id)
        if listing:
            listing.rating_count = int(rating_count or 0)
            listing.rating_avg = float(rating_avg or 0.0)

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import (
    Agent,
    ApiKey,
    CustomTool,
    EvalCase,
    EvalSuite,
    Execution,
    OrgMember,
    Organization,
    OrgPlan,
    UserIntegration,
    WebhookEndpoint,
    Workflow,
)


UNLIMITED = 999999


PLAN_LIMITS: dict[OrgPlan, dict[str, Any]] = {
    OrgPlan.free: {
        "max_members": 1,
        "max_agents": 3,
        "max_workflows": 5,
        "max_monthly_executions": 100,
        "max_monthly_budget_usd": 5.0,
        "eval_suites": 1,
        "eval_cases_per_suite": 10,
        "memory_enabled": False,
        "parallel_execution": False,
        "webhooks": False,
        "scheduling": False,
        "version_history": False,
        "api_keys": False,
        "custom_tools": 2,
        "integrations": 1,
    },
    OrgPlan.solo: {
        "max_members": 1,
        "max_agents": UNLIMITED,
        "max_workflows": UNLIMITED,
        "max_monthly_executions": 2000,
        "max_monthly_budget_usd": 50.0,
        "eval_suites": 10,
        "eval_cases_per_suite": 100,
        "memory_enabled": True,
        "parallel_execution": True,
        "webhooks": True,
        "scheduling": True,
        "version_history": True,
        "api_keys": True,
        "custom_tools": UNLIMITED,
        "integrations": 5,
    },
    OrgPlan.team: {
        "max_members": 5,
        "max_agents": UNLIMITED,
        "max_workflows": UNLIMITED,
        "max_monthly_executions": 10000,
        "max_monthly_budget_usd": 200.0,
        "eval_suites": UNLIMITED,
        "eval_cases_per_suite": 500,
        "memory_enabled": True,
        "parallel_execution": True,
        "webhooks": True,
        "scheduling": True,
        "version_history": True,
        "api_keys": True,
        "custom_tools": UNLIMITED,
        "integrations": UNLIMITED,
    },
    OrgPlan.business: {
        "max_members": 25,
        "max_agents": UNLIMITED,
        "max_workflows": UNLIMITED,
        "max_monthly_executions": 50000,
        "max_monthly_budget_usd": 1000.0,
        "eval_suites": UNLIMITED,
        "eval_cases_per_suite": UNLIMITED,
        "memory_enabled": True,
        "parallel_execution": True,
        "webhooks": True,
        "scheduling": True,
        "version_history": True,
        "api_keys": True,
        "custom_tools": UNLIMITED,
        "integrations": UNLIMITED,
    },
    OrgPlan.enterprise: {
        "max_members": UNLIMITED,
        "max_agents": UNLIMITED,
        "max_workflows": UNLIMITED,
        "max_monthly_executions": UNLIMITED,
        "max_monthly_budget_usd": 999999.0,
        "eval_suites": UNLIMITED,
        "eval_cases_per_suite": UNLIMITED,
        "memory_enabled": True,
        "parallel_execution": True,
        "webhooks": True,
        "scheduling": True,
        "version_history": True,
        "api_keys": True,
        "custom_tools": UNLIMITED,
        "integrations": UNLIMITED,
    },
}


COUNT_LIMITS: dict[str, tuple[Any, str]] = {
    "members": (OrgMember, "max_members"),
    "agents": (Agent, "max_agents"),
    "workflows": (Workflow, "max_workflows"),
    "custom_tools": (CustomTool, "custom_tools"),
    "integrations": (UserIntegration, "integrations"),
    "webhook_endpoints": (WebhookEndpoint, "webhooks"),
    "eval_suites": (EvalSuite, "eval_suites"),
    "api_keys": (ApiKey, "api_keys"),
}

FEATURE_FLAGS = {
    "memory_enabled",
    "parallel_execution",
    "webhooks",
    "scheduling",
    "version_history",
    "api_keys",
}


class PlanService:
    def _normalize_plan(self, plan: OrgPlan | str | None) -> OrgPlan:
        if isinstance(plan, OrgPlan):
            return plan
        try:
            return OrgPlan(plan or OrgPlan.free.value)
        except ValueError:
            return OrgPlan.free

    def get_limits(self, plan: OrgPlan) -> dict:
        return dict(PLAN_LIMITS[self._normalize_plan(plan)])

    def apply_plan_to_org(self, org: Organization, plan: OrgPlan | str) -> Organization:
        normalized_plan = self._normalize_plan(plan)
        limits = self.get_limits(normalized_plan)
        org.plan = normalized_plan
        org.max_members = int(limits["max_members"])
        org.max_agents = int(limits["max_agents"])
        org.max_workflows = int(limits["max_workflows"])
        org.max_monthly_executions = int(limits["max_monthly_executions"])
        return org

    def clear_caches(self, org_id: str | None = None) -> None:
        # Plan limits are evaluated from the database on demand today.
        # This hook exists so billing/webhook flows can invalidate caches later
        # without changing their integration points.
        return None

    async def check_limit(
        self,
        org: Organization,
        resource: str,
        db: AsyncSession,
    ) -> tuple[bool, str]:
        plan = self._normalize_plan(org.plan)
        limits = self.get_limits(plan)

        if resource == "executions":
            limit = int(limits["max_monthly_executions"])
            if limit >= UNLIMITED:
                return True, ""
            used = await self._monthly_execution_count(org.id, db)
            if used >= limit:
                return False, self.get_upgrade_message("executions", plan)
            return True, ""

        if resource in FEATURE_FLAGS:
            if not bool(limits.get(resource, False)):
                return False, self.get_upgrade_message(resource, plan)
            return True, ""

        if resource == "webhooks":
            if not bool(limits.get("webhooks", False)):
                return False, self.get_upgrade_message("webhooks", plan)
            return True, ""

        if resource in COUNT_LIMITS:
            model, limit_key = COUNT_LIMITS[resource]
            limit = limits.get(limit_key, UNLIMITED)
            if isinstance(limit, bool):
                if not limit:
                    return False, self.get_upgrade_message(resource, plan)
                return True, ""
            if int(limit) >= UNLIMITED:
                return True, ""
            used = await self._count_resource(org.id, model, db)
            if used >= int(limit):
                return False, self.get_upgrade_message(resource, plan)
            return True, ""

        return True, ""

    async def check_eval_case_limit(
        self,
        org: Organization,
        suite_id: str,
        additional_cases: int,
        db: AsyncSession,
    ) -> tuple[bool, str]:
        limits = self.get_limits(self._normalize_plan(org.plan))
        limit = int(limits.get("eval_cases_per_suite", UNLIMITED))
        if limit >= UNLIMITED:
            return True, ""

        used = await db.scalar(select(func.count(EvalCase.id)).where(EvalCase.suite_id == suite_id)) or 0
        if used + additional_cases > limit:
            return False, self.get_upgrade_message("eval_cases_per_suite", self._normalize_plan(org.plan))
        return True, ""

    async def get_usage_summary(
        self,
        org: Organization,
        db: AsyncSession,
    ) -> dict:
        limits = self.get_limits(self._normalize_plan(org.plan))
        counts = {
            "members": await self._count_resource(org.id, OrgMember, db),
            "agents": await self._count_resource(org.id, Agent, db),
            "workflows": await self._count_resource(org.id, Workflow, db),
            "executions": await self._monthly_execution_count(org.id, db),
            "custom_tools": await self._count_resource(org.id, CustomTool, db),
            "integrations": await self._count_resource(org.id, UserIntegration, db),
            "api_keys": await self._count_resource(org.id, ApiKey, db),
            "webhooks": await self._count_resource(org.id, WebhookEndpoint, db),
            "eval_suites": await self._count_resource(org.id, EvalSuite, db),
        }

        usage = {
            "members": self._usage(counts["members"], limits["max_members"]),
            "agents": self._usage(counts["agents"], limits["max_agents"]),
            "workflows": self._usage(counts["workflows"], limits["max_workflows"]),
            "executions": self._usage(counts["executions"], limits["max_monthly_executions"]),
            "custom_tools": self._usage(counts["custom_tools"], limits["custom_tools"]),
            "integrations": self._usage(counts["integrations"], limits["integrations"]),
            "api_keys": self._usage(counts["api_keys"], UNLIMITED if limits["api_keys"] else 0),
            "webhooks": self._usage(counts["webhooks"], UNLIMITED if limits["webhooks"] else 0),
            "eval_suites": self._usage(counts["eval_suites"], limits["eval_suites"]),
            "monthly_budget": self._usage(float(getattr(org, "monthly_budget_usd", 0) or 0), limits["max_monthly_budget_usd"]),
        }

        features = {}
        for feature in sorted(FEATURE_FLAGS):
            allowed = bool(limits.get(feature, False))
            features[feature] = {
                "allowed": allowed,
                "upgrade_to": None if allowed else "solo",
            }

        return {
            **usage,
            "features": features,
            "plan": self._normalize_plan(org.plan).value,
        }

    def get_upgrade_message(self, resource: str, current_plan: OrgPlan) -> str:
        plan = self._normalize_plan(current_plan)
        messages = {
            "agents": "You've used all 3 agents on the free plan. Upgrade to Solo ($29/mo) for unlimited agents.",
            "workflows": "You've used all 5 workflows on the free plan. Upgrade to Solo ($29/mo) for unlimited workflows.",
            "executions": "You've hit this month's execution limit. Upgrade to Solo for 2,000 monthly runs, or Team for 10,000.",
            "members": "This plan is limited to one seat. Upgrade to Team ($99/mo) to invite collaborators.",
            "custom_tools": "You've reached the custom tool limit. Upgrade to Solo for unlimited custom tools.",
            "integrations": "You've reached the integration limit for this plan. Upgrade to Solo for more connected apps.",
            "eval_suites": "You've reached the eval suite limit. Upgrade to Solo to run more quality checks.",
            "eval_cases_per_suite": "This eval suite has reached the case limit for your plan. Upgrade to Solo for larger eval suites.",
            "memory_enabled": "Persistent memory is available on Solo and above. Upgrade to let agents remember company context.",
            "parallel_execution": "Parallel execution is available on Solo and above. Upgrade to run multiple agents at once.",
            "webhooks": "Webhook triggers are available on Solo and above. Upgrade to connect external systems.",
            "scheduling": "Scheduled workflows are available on Solo and above. Upgrade to automate recurring work.",
            "version_history": "Workflow version history is available on Solo and above. Upgrade to unlock rollback safety.",
            "api_keys": "API keys are available on Solo and above. Upgrade to connect external automation securely.",
        }
        if resource in messages:
            return messages[resource]
        return f"Your {plan.value} plan does not include {resource}. Upgrade to unlock this feature."

    async def _count_resource(self, org_id: str, model: Any, db: AsyncSession) -> int:
        query = select(func.count(model.id)).where(model.org_id == org_id)
        if hasattr(model, "is_active"):
            query = query.where(model.is_active == True)  # noqa: E712
        return await db.scalar(query) or 0

    async def _monthly_execution_count(self, org_id: str, db: AsyncSession) -> int:
        now = datetime.utcnow()
        month_start = datetime(now.year, now.month, 1)
        return (
            await db.scalar(
                select(func.count(Execution.id)).where(
                    Execution.org_id == org_id,
                    Execution.started_at >= month_start,
                )
            )
            or 0
        )

    def _usage(self, used: int | float, limit: int | float | bool) -> dict:
        if isinstance(limit, bool):
            numeric_limit = UNLIMITED if limit else 0
        else:
            numeric_limit = limit
        percent = 0.0 if not numeric_limit else min(float(used) / float(numeric_limit) * 100, 100.0)
        return {"used": used, "limit": numeric_limit, "percent": round(percent, 1)}


plan_service = PlanService()

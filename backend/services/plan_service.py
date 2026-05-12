UNLIMITED = 999999

OPEN_SOURCE_LIMITS = {
    "max_members": UNLIMITED,
    "max_agents": UNLIMITED,
    "max_workflows": UNLIMITED,
    "max_monthly_executions": UNLIMITED,
    "max_monthly_budget_usd": UNLIMITED,
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
}

PLAN_LIMITS = {"open_source": OPEN_SOURCE_LIMITS}
FEATURE_FLAGS = {
    "memory_enabled",
    "parallel_execution",
    "webhooks",
    "scheduling",
    "version_history",
    "api_keys",
}


class PlanService:
    def get_limits(self, *args, **kwargs):
        return dict(OPEN_SOURCE_LIMITS)

    def apply_plan_to_org(self, org, plan=None):
        limits = self.get_limits()
        org.plan = "open_source"
        org.max_members = int(limits["max_members"])
        org.max_agents = int(limits["max_agents"])
        org.max_workflows = int(limits["max_workflows"])
        org.max_monthly_executions = int(limits["max_monthly_executions"])
        return org

    def clear_caches(self, org_id: str | None = None) -> None:
        return None

    async def check_limit(self, *args, **kwargs) -> tuple[bool, str]:
        return True, ""

    async def check_eval_case_limit(self, *args, **kwargs) -> tuple[bool, str]:
        return True, ""

    async def get_usage_summary(self, org, db) -> dict:
        unlimited_usage = {"used": 0, "limit": UNLIMITED, "percent": 0.0}
        features = {
            feature: {"allowed": True, "upgrade_to": None}
            for feature in sorted(FEATURE_FLAGS)
        }
        return {
            "members": dict(unlimited_usage),
            "agents": dict(unlimited_usage),
            "workflows": dict(unlimited_usage),
            "executions": dict(unlimited_usage),
            "custom_tools": dict(unlimited_usage),
            "integrations": dict(unlimited_usage),
            "api_keys": dict(unlimited_usage),
            "webhooks": dict(unlimited_usage),
            "eval_suites": dict(unlimited_usage),
            "monthly_budget": dict(unlimited_usage),
            "features": features,
            "plan": "open_source",
        }

    def get_upgrade_message(self, resource: str, current_plan=None) -> str:
        return "Open-source edition: all features are available."


plan_service = PlanService()

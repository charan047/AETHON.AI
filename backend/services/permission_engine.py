import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, AgentContract, AgentTrustScore


logger = logging.getLogger(__name__)


class PermissionResult(str, Enum):
    ALLOWED = "allowed"
    REQUIRES_APPROVAL = "requires_approval"
    FORBIDDEN = "forbidden"


@dataclass
class PermissionCheck:
    result: PermissionResult
    reason: str
    risk_level: str = "low"
    approval_type: Optional[str] = None
    blast_radius: Optional[str] = None
    recommendation: Optional[str] = None
    escalate_to_role: Optional[str] = None


ALWAYS_FORBIDDEN = frozenset(
    [
        "delete_production_database",
        "expose_api_secrets",
        "bypass_approval_system",
        "modify_guardrails",
        "access_other_org_data",
        "disable_audit_logging",
    ]
)

ALWAYS_REQUIRES_CEO = frozenset(
    [
        "production_deploy",
        "database_migration",
        "schema_deletion",
        "mass_data_deletion",
        "new_agent_hire",
        "budget_increase_large",
    ]
)

TOOL_TRUST_THRESHOLDS = {
    "web_search": 0,
    "web_scrape": 0,
    "news_search": 0,
    "firecrawl_scrape": 0,
    "firecrawl_crawl": 10,
    "external_agent_call": 55,
    "gmail_read": 30,
    "code_executor": 50,
    "google_docs_create": 40,
    "google_sheets_create": 40,
    "gmail_send": 65,
    "slack_post": 65,
}

BLAST_RADIUS_MAP = {
    "gmail_send": "Medium — email sent cannot be recalled",
    "slack_post": "Low — message visible to channel members",
    "code_executor": "Low-Medium — sandboxed, but code runs on server",
    "google_docs_create": "Low — creates new document only",
    "external_agent_call": "Medium — sends data to an external agent system",
    "database_migration": "High — affects all users",
    "production_deploy": "High — service disruption possible",
    "mass_data_deletion": "Critical — irreversible",
    "firecrawl_crawl": "Low — read-only external requests",
}


class PermissionEngine:
    @staticmethod
    def _canonical_tool_name(tool_name: str) -> str:
        if tool_name.startswith("agent:"):
            return "external_agent_call"
        return tool_name

    async def check(
        self,
        agent_id: str,
        action: str,
        context: dict,
        db: AsyncSession,
    ) -> PermissionCheck:
        try:
            action_category, action_name = action.split(":", 1)

            if action_name in ALWAYS_FORBIDDEN:
                return PermissionCheck(
                    result=PermissionResult.FORBIDDEN,
                    reason=f"'{action_name}' is permanently forbidden.",
                    risk_level="critical",
                )

            if action_name in ALWAYS_REQUIRES_CEO:
                return PermissionCheck(
                    result=PermissionResult.REQUIRES_APPROVAL,
                    reason=f"'{action_name}' always requires CEO approval.",
                    risk_level="high",
                    approval_type=action_name,
                    blast_radius=BLAST_RADIUS_MAP.get(action_name),
                )

            agent, contract, trust = await self._load_context(agent_id, db)
            if not agent:
                return PermissionCheck(
                    result=PermissionResult.FORBIDDEN,
                    reason="Agent not found.",
                    risk_level="critical",
                )

            if action_category == "tool":
                return self._check_tool(agent, contract, trust, action_name)
            if action_category == "action":
                return self._check_action(agent, contract, trust, action_name)

            return PermissionCheck(result=PermissionResult.ALLOWED, reason="Permitted.")
        except Exception as exc:
            logger.error(
                "PermissionEngine.check FAILED for agent '%s', action '%s': %s. "
                "Defaulting to REQUIRES_APPROVAL for safety.",
                agent_id,
                action,
                exc,
            )
            return PermissionCheck(
                result=PermissionResult.REQUIRES_APPROVAL,
                reason=(
                    f"Permission check failed: {type(exc).__name__}. "
                    "Action requires manual approval for safety."
                ),
                risk_level="medium",
                approval_type="permission_check_error",
            )

    def _check_tool(self, agent, contract, trust, tool_name) -> PermissionCheck:
        canonical_tool_name = self._canonical_tool_name(tool_name)

        if contract and (
            tool_name in (contract.forbidden_tools or [])
            or canonical_tool_name in (contract.forbidden_tools or [])
        ):
            return PermissionCheck(
                result=PermissionResult.FORBIDDEN,
                reason=f"Tool '{tool_name}' is forbidden by this agent's contract.",
                risk_level="high",
            )

        if (
            contract
            and contract.allowed_tools is not None
            and not tool_name.startswith("agent:")
            and tool_name not in contract.allowed_tools
        ):
            return PermissionCheck(
                result=PermissionResult.FORBIDDEN,
                reason=f"Tool '{tool_name}' is not in this agent's allowed tools.",
                risk_level="medium",
                recommendation=f"Add '{tool_name}' to allowed_tools in the agent's contract.",
            )

        min_trust = TOOL_TRUST_THRESHOLDS.get(canonical_tool_name, TOOL_TRUST_THRESHOLDS.get(tool_name, 0))
        current_trust = trust.overall_score if trust else getattr(agent, "trust_score", 50.0) or 50.0
        if current_trust < min_trust:
            return PermissionCheck(
                result=PermissionResult.REQUIRES_APPROVAL,
                reason=f"'{canonical_tool_name}' requires trust ≥ {min_trust}. This agent has {current_trust:.0f}.",
                risk_level="medium",
                approval_type="tool_use_low_trust",
                blast_radius=BLAST_RADIUS_MAP.get(canonical_tool_name) or BLAST_RADIUS_MAP.get(tool_name),
                recommendation=(
                    f"Agent needs {max(0, min_trust - current_trust):.0f} more trust points, "
                    "or approve this use manually."
                ),
            )

        autonomy = (
            contract.autonomy_level
            if contract and getattr(contract, "autonomy_level", None)
            else getattr(agent, "autonomy_level", "supervised")
        )
        if autonomy == "restricted":
            safe = {"web_search", "web_scrape", "news_search", "firecrawl_scrape"}
            if canonical_tool_name not in safe:
                return PermissionCheck(
                    result=PermissionResult.REQUIRES_APPROVAL,
                    reason="Agent is restricted — approval required for most tools.",
                    risk_level="medium",
                    approval_type="restricted_tool_use",
                )

        return PermissionCheck(result=PermissionResult.ALLOWED, reason="Tool use permitted.")

    def _check_action(self, agent, contract, trust, action_name) -> PermissionCheck:
        if not contract:
            return PermissionCheck(result=PermissionResult.ALLOWED, reason="No contract.")

        if action_name in (contract.forbidden_actions or []):
            return PermissionCheck(
                result=PermissionResult.FORBIDDEN,
                reason=f"Action '{action_name}' is forbidden by contract.",
                risk_level="high",
            )

        if action_name in (contract.requires_approval_for or []):
            return PermissionCheck(
                result=PermissionResult.REQUIRES_APPROVAL,
                reason=f"Action '{action_name}' requires approval per contract.",
                risk_level="high",
                approval_type=action_name,
                blast_radius=BLAST_RADIUS_MAP.get(action_name),
            )

        return PermissionCheck(result=PermissionResult.ALLOWED, reason="Permitted.")

    async def should_escalate(
        self,
        agent_id: str,
        trigger: str,
        db: AsyncSession,
    ) -> tuple[bool, Optional[str]]:
        try:
            r = await db.execute(select(AgentContract).where(AgentContract.agent_id == agent_id))
            contract = r.scalar_one_or_none()
            if not contract:
                return False, None
            if trigger in (contract.escalation_triggers or []):
                return True, contract.escalates_to_role
            return False, None
        except Exception:
            return False, None

    async def _load_context(self, agent_id: str, db: AsyncSession):
        agent_r = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_r.scalar_one_or_none()
        contract_r = await db.execute(select(AgentContract).where(AgentContract.agent_id == agent_id))
        contract = contract_r.scalar_one_or_none()
        trust_r = await db.execute(select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id))
        trust = trust_r.scalar_one_or_none()
        return agent, contract, trust


permission_engine = PermissionEngine()

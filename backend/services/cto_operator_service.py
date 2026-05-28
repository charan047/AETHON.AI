from dataclasses import dataclass
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, Client, CTOMemoryType, Workflow


def looks_like_cto_ownership_request(message: str) -> bool:
    normalized = " ".join((message or "").lower().split())
    if not normalized:
        return False
    signals = (
        "handle ",
        "own ",
        "take care of ",
        "take over ",
        "create a mission",
        "start a mission",
        "launch a mission",
        "report me back",
        "let me know when it's done",
        "let me know when it is done",
        "notify me when it's done",
        "notify me when it is done",
        "update me when it's done",
        "update me when it is done",
        "keep me posted",
        "weekly deliverables",
        "run this as a mission",
        "mission mode",
        "brief the whole agency",
    )
    return any(signal in normalized for signal in signals)


def _is_cto_status_request(message: str) -> bool:
    normalized = " ".join((message or "").lower().split())
    if not normalized:
        return False
    signals = (
        "any update",
        "update on ",
        "status on ",
        "how is that mission",
        "how's that mission",
        "how is this mission",
        "how's this mission",
        "did it finish",
        "is it done",
        "is that done",
        "is this done",
        "what are you handling",
        "what are you tracking",
        "what do you own",
        "cto status",
        "status of cto",
        "active cto tasks",
        "what are you working on right now",
    )
    return any(signal in normalized for signal in signals)


def _is_memory_query(message: str) -> bool:
    normalized = " ".join((message or "").lower().strip().split())
    return (
        normalized.endswith("?")
        or normalized.startswith("what do you remember")
        or normalized.startswith("do you remember")
        or normalized.startswith("tell me what you remember")
        or normalized.startswith("can you remember what")
    )


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_]+", (text or "").lower()))


@dataclass(frozen=True)
class DeterministicCTOPlan:
    kind: str
    response_text: str
    actions: list[dict[str, Any]]
    ensure_task: bool = False
    task_plan: str | None = None
    skip_generic_memory_extraction: bool = False


class CTOOperatorService:
    async def plan_request(
        self,
        message: str,
        org_id: str,
        context: dict[str, Any],
        db: AsyncSession,
    ) -> DeterministicCTOPlan | None:
        if _is_cto_status_request(message):
            return DeterministicCTOPlan(
                kind="status",
                response_text="Here's what I'm handling right now:",
                actions=[{"type": "cto_status"}],
            )

        memory_action = await self._memory_action(message, org_id, context, db)
        if memory_action:
            entity_name = memory_action.get("entity_name")
            suffix = f" for {entity_name}" if entity_name else ""
            return DeterministicCTOPlan(
                kind="memory",
                response_text=f"Locked in. I'll remember that{suffix}.",
                actions=[memory_action],
                skip_generic_memory_extraction=True,
            )

        if not looks_like_cto_ownership_request(message):
            return None

        workflow = self._match_workflow(message, context.get("workflows") or [])
        client_name = await self._match_client_name(message, org_id, db)
        if workflow:
            return DeterministicCTOPlan(
                kind="ownership",
                response_text=(
                    f'On it. I\'m taking ownership of this and starting the "{workflow.name}" workflow now. '
                    "I'll report back when it completes."
                ),
                actions=[
                    {
                        "type": "run_workflow",
                        "workflow_id": str(workflow.id),
                        "input": message,
                    }
                ],
                ensure_task=True,
                task_plan=(
                    f'1. Take ownership of the request 2. Run the "{workflow.name}" workflow '
                    "3. Report back proactively when the work completes"
                ),
            )

        mission_action: dict[str, Any] = {
            "type": "create_mission",
            "goal": message,
        }
        if client_name:
            mission_action["client_name"] = client_name
        return DeterministicCTOPlan(
            kind="ownership",
            response_text="On it. I'm taking ownership of this and starting a mission now. I'll report back when it completes.",
            actions=[mission_action],
            ensure_task=True,
            task_plan="1. Take ownership of the goal 2. Break it into a mission 3. Report back proactively when the work completes",
        )

    async def _memory_action(
        self,
        message: str,
        org_id: str,
        context: dict[str, Any],
        db: AsyncSession,
    ) -> dict[str, Any] | None:
        normalized = " ".join((message or "").lower().split())
        if not normalized or _is_memory_query(message):
            return None

        preference_signals = (
            "always ",
            "never ",
            "prefer ",
            "make sure ",
            "remember ",
            "from now on ",
        )
        if not any(signal in normalized for signal in preference_signals):
            return None

        clients = (
            await db.execute(
                select(Client).where(Client.org_id == org_id)
            )
        ).scalars().all()
        client = self._match_entity(message, clients, ("name", "company_name"))
        agent = self._match_entity(message, context.get("agents") or [], ("name", "persona_name"))

        if client:
            memory_type = CTOMemoryType.client_preference
            entity_name = client.name
            entity_type = "client"
        elif agent:
            memory_type = CTOMemoryType.agent_capability
            entity_name = getattr(agent, "persona_name", None) or agent.name
            entity_type = "agent"
        elif "approval" in normalized or "without my approval" in normalized or "without approval" in normalized:
            memory_type = CTOMemoryType.approval_pattern
            entity_name = None
            entity_type = "action_type"
        else:
            memory_type = CTOMemoryType.general
            entity_name = None
            entity_type = None

        return {
            "type": "cto_memory_add",
            "memory_type": memory_type.value,
            "content": message.strip()[:200],
            "entity_name": entity_name,
            "entity_type": entity_type,
        }

    def _match_workflow(self, message: str, workflows: list[Workflow]) -> Workflow | None:
        normalized = " ".join((message or "").lower().split())
        if "workflow" not in normalized and "playbook" not in normalized and "process" not in normalized:
            return None

        best_match: Workflow | None = None
        best_score = 0
        query_tokens = _tokenize(message)
        for workflow in workflows:
            name = (workflow.name or "").strip()
            if not name:
                continue
            lowered_name = name.lower()
            if lowered_name in normalized:
                return workflow
            overlap = len(_tokenize(name) & query_tokens)
            if overlap > best_score and overlap >= 2:
                best_match = workflow
                best_score = overlap
        return best_match

    async def _match_client_name(self, message: str, org_id: str, db: AsyncSession) -> str | None:
        clients = (
            await db.execute(
                select(Client).where(Client.org_id == org_id)
            )
        ).scalars().all()
        match = self._match_entity(message, clients, ("name", "company_name"))
        if not match:
            return None
        return match.name or match.company_name

    def _match_entity(
        self,
        message: str,
        records: list[Any],
        fields: tuple[str, ...],
    ) -> Any | None:
        normalized = " ".join((message or "").lower().split())
        query_tokens = _tokenize(message)
        best_match: Any | None = None
        best_score = 0
        for record in records:
            haystacks = [str(getattr(record, field, "") or "").strip() for field in fields]
            for value in haystacks:
                lowered = value.lower()
                if not lowered:
                    continue
                if lowered in normalized:
                    return record
                overlap = len(_tokenize(value) & query_tokens)
                if overlap > best_score and overlap >= 1:
                    best_match = record
                    best_score = overlap
        return best_match


cto_operator_service = CTOOperatorService()

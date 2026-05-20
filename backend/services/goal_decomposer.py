from __future__ import annotations

import json
import logging
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, AgentTrustScore, Client, Mission, MissionStatus, MissionTask
from services.model_service import model_service


logger = logging.getLogger(__name__)


DECOMPOSE_PROMPT = """
You are a mission planner for an AI agency. Break this goal into
3-6 concrete tasks that specialized AI agents can execute.

Goal: {goal}
Client: {client_name}
Agency context: {agency_context}

Available agents:
{agents_list}

Rules:
- Each task must be specific and actionable
- Tasks that depend on previous output must list dependencies
- CRITICAL: You MUST use the EXACT agent names listed below.
- Do NOT invent names like "Research Analyst" or "Data Expert".
- If no agent perfectly fits, assign the closest match anyway.
- Available agents (copy these names EXACTLY):
- {agents_list}
- Maximum 6 tasks total
- Tasks that can run in parallel should NOT depend on each other

Return ONLY valid JSON, no markdown:
{{
  "mission_title": "Short title for this mission (max 60 chars)",
  "tasks": [
    {{
      "sequence": 1,
      "title": "Research Acme Corp competitors",
      "description": "Search for the top 5 competitors...",
      "prompt": "Full task prompt for the agent",
      "agent_name": "Maya",
      "depends_on": [],
      "estimated_minutes": 8
    }}
  ]
}}
""".strip()


class GoalDecomposer:
    def _build_fallback_plan(
        self,
        *,
        goal: str,
        agent_display_name: str | None,
    ) -> dict:
        fallback_agent = agent_display_name or ""
        mission_title = " ".join(goal.strip().split())[:60] or "Mission plan"
        return {
            "mission_title": mission_title,
            "tasks": [
                {
                    "sequence": 1,
                    "title": "Research the request",
                    "description": f"Research the goal and gather the core facts needed to complete: {goal}",
                    "prompt": f"Research this goal and gather the essential facts: {goal}",
                    "agent_name": fallback_agent,
                    "depends_on": [],
                    "estimated_minutes": 8,
                },
                {
                    "sequence": 2,
                    "title": "Analyze findings",
                    "description": "Analyze the findings and identify the most important insights, risks, and opportunities.",
                    "prompt": "Analyze the research findings and identify the key insights, risks, and opportunities.",
                    "agent_name": fallback_agent,
                    "depends_on": [1],
                    "estimated_minutes": 8,
                },
                {
                    "sequence": 3,
                    "title": "Create final recommendations",
                    "description": "Turn the findings into a clear recommendation or report for the user.",
                    "prompt": "Create a clear final recommendation or report based on the findings and analysis.",
                    "agent_name": fallback_agent,
                    "depends_on": [1, 2],
                    "estimated_minutes": 8,
                },
            ],
        }

    def _parse_plan_content(
        self,
        *,
        content: str,
        goal: str,
        fallback_agent_name: str | None,
    ) -> dict:
        normalized = content.strip()
        if normalized.startswith("```"):
            parts = normalized.split("```")
            if len(parts) >= 2:
                normalized = parts[1]
            if normalized.startswith("json"):
                normalized = normalized[4:]
            normalized = normalized.strip()

        candidates = [normalized]
        start = normalized.find("{")
        end = normalized.rfind("}")
        if start != -1 and end != -1 and end > start:
            extracted = normalized[start : end + 1]
            if extracted not in candidates:
                candidates.append(extracted)

        for candidate in candidates:
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue

        logger.warning(
            "Mission planner returned non-JSON content. Falling back to deterministic plan. Preview: %s",
            normalized[:300],
        )
        return self._build_fallback_plan(goal=goal, agent_display_name=fallback_agent_name)

    async def decompose(
        self,
        goal: str,
        org_id: str,
        client_id: str | None,
        db: AsyncSession,
    ) -> dict:
        result = await db.execute(
            select(Agent, AgentTrustScore)
            .outerjoin(AgentTrustScore, AgentTrustScore.agent_id == Agent.id)
            .where(Agent.org_id == org_id, Agent.is_active == True)  # noqa: E712
        )
        agents = result.all()

        agents_list = "\n".join(
            [
                f"- {agent.persona_name or agent.name} "
                f"(role: {agent.role_slug or 'agent'}, "
                f"trust: {round(trust.overall_score if trust else 50, 0)}, "
                f"autonomy: {agent.autonomy_level or 'supervised'})"
                for agent, trust in agents
            ]
        )

        client_name = "unknown client"
        if client_id:
            client = await db.scalar(
                select(Client).where(Client.id == client_id, Client.org_id == org_id)
            )
            if client:
                client_name = client.company_name or client.name

        agency_context = (
            f"Agency has {len(agents)} active agents. "
            f"Working for client: {client_name}."
        )
        prompt = DECOMPOSE_PROMPT.format(
            goal=goal,
            client_name=client_name,
            agency_context=agency_context,
            agents_list=agents_list or "No agents available",
        )

        llm = model_service._build_from_settings(temperature=0.3, max_tokens=2000)
        response = await llm.ainvoke(prompt)
        content = getattr(response, "content", response)
        if not isinstance(content, str):
            content = str(content)
        content = content.strip()
        plan = self._parse_plan_content(
            content=content,
            goal=goal,
            fallback_agent_name=(agents[0][0].persona_name or agents[0][0].name) if agents else None,
        )

        agent_by_exact: dict[str, str] = {}
        agent_by_role: dict[str, str] = {}
        agent_list_raw: list[tuple[str, str, str]] = []

        for agent, _trust in agents:
            name = (agent.persona_name or agent.name or "").lower().strip()
            role = (agent.role_slug or agent.role or "").lower().strip()
            agent_id = str(agent.id)
            if name:
                agent_by_exact[name] = agent_id
            if role:
                agent_by_role[role] = agent_id
            agent_list_raw.append((agent_id, name, role))

        def _resolve_agent(agent_name: str) -> tuple[str | None, str]:
            """
            Returns (agent_id, match_method) or (None, 'none').
            Tries 5 levels before giving up.
            """
            if not agent_name:
                if agents:
                    best = max(
                        agents,
                        key=lambda row: row[1].overall_score if row[1] else 50,
                    )
                    return str(best[0].id), "default_best"
                return None, "no_agents"

            query = agent_name.lower().strip()

            for agent, _trust in agents:
                name = (agent.persona_name or agent.name or "").lower().strip()
                if query == name:
                    return str(agent.id), "exact"

            for agent, _trust in agents:
                role = (agent.role_slug or agent.role or "").lower().strip()
                if query == role or query.replace(" ", "_") == role:
                    return str(agent.id), "role_slug"

            for agent, _trust in agents:
                name = (agent.persona_name or agent.name or "").lower().strip()
                if query in name or name in query:
                    return str(agent.id), "partial"

            query_words = set(query.split())
            best_overlap = 0
            best_id: str | None = None
            for agent, _trust in agents:
                combined = (
                    (agent.persona_name or agent.name or "") + " " +
                    (agent.role_slug or agent.role or "")
                ).lower()
                overlap = len(query_words & set(combined.split()))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_id = str(agent.id)
            if best_overlap > 0:
                return best_id, "word_overlap"

            if agents:
                best = max(
                    agents,
                    key=lambda row: row[1].overall_score if row[1] else 50,
                )
                return str(best[0].id), "fallback_best"

            return None, "none"

        tasks = plan.get("tasks", [])
        for task in tasks:
            requested_agent_name = task.get("agent_name") or ""
            resolved_agent_id, match_mode = _resolve_agent(requested_agent_name)
            task["agent_id"] = resolved_agent_id
            if resolved_agent_id and match_mode != "exact":
                resolved_name = next(
                    (name for agent_id, name, _role in agent_list_raw if agent_id == resolved_agent_id),
                    "unknown",
                )
                logger.info(
                    "Mission task '%s': assigned to agent via fallback "
                    "(LLM said '%s', resolved via %s to '%s')",
                    task.get("title"),
                    requested_agent_name,
                    match_mode,
                    resolved_name,
                )

        return plan

    async def create_mission(
        self,
        goal: str,
        org_id: str,
        client_id: str | None,
        created_by: str,
        db: AsyncSession,
    ) -> Mission:
        plan = await self.decompose(goal, org_id, client_id, db)

        mission = Mission(
            id=str(uuid4()),
            org_id=org_id,
            client_id=client_id,
            goal=goal,
            title=(plan.get("mission_title") or goal[:60]).strip()[:255],
            status=MissionStatus.planning,
            created_by=created_by,
        )
        db.add(mission)
        await db.flush()

        normalized_tasks = sorted(plan.get("tasks", []), key=lambda item: item.get("sequence", 0))
        sequence_to_task_id: dict[int, str] = {}

        for index, task_data in enumerate(normalized_tasks, start=1):
            sequence = int(task_data.get("sequence") or index)
            task_id = str(uuid4())
            sequence_to_task_id[sequence] = task_id

        for index, task_data in enumerate(normalized_tasks, start=1):
            sequence = int(task_data.get("sequence") or index)
            depends = []
            for dep in task_data.get("depends_on", []) or []:
                try:
                    dep_sequence = int(dep)
                except (TypeError, ValueError):
                    continue
                mapped_task_id = sequence_to_task_id.get(dep_sequence)
                if mapped_task_id:
                    depends.append(mapped_task_id)
            task = MissionTask(
                id=sequence_to_task_id[sequence],
                mission_id=mission.id,
                org_id=org_id,
                sequence=sequence,
                title=(task_data.get("title") or f"Task {index}").strip()[:255],
                description=task_data.get("description"),
                agent_id=task_data.get("agent_id"),
                depends_on=",".join(depends) or None,
            )
            db.add(task)

        mission.status = MissionStatus.active
        await db.commit()
        await db.refresh(mission)
        return mission


goal_decomposer = GoalDecomposer()

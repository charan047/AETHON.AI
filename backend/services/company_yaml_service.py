import json
import re
from datetime import datetime
from typing import Any
from uuid import uuid4

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import Agent, CompanyProfile, Workflow


COMPANY_FIELDS = {"name", "mission", "industry", "stage", "monthly_revenue", "runway_months"}
TEAM_FIELDS = {
    "role",
    "name",
    "model",
    "memory_enabled",
    "tools",
    "responsibilities",
    "system_prompt_extra",
    "max_retries",
    "timeout",
}
WORKFLOW_FIELDS = {
    "name",
    "trigger",
    "description",
    "steps",
    "sequential",
    "hitl_before",
}
TRIGGER_FIELDS = {"type", "cron", "webhook_path"}
SETTINGS_FIELDS = {"default_model", "timezone", "notifications"}
NOTIFICATION_FIELDS = {"telegram", "email"}
TRIGGER_TYPES = {"manual", "schedule", "webhook", "message"}


class CompanyYamlError(ValueError):
    pass


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "node"


def _require_mapping(value: Any, path: str, errors: list[str]) -> dict:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object")
        return {}
    return value


def _require_list(value: Any, path: str, errors: list[str]) -> list:
    if not isinstance(value, list):
        errors.append(f"{path} must be a list")
        return []
    return value


class CompanyYamlService:
    def validate_yaml(self, yaml_content: str) -> dict:
        errors: list[str] = []
        warnings: list[str] = []

        try:
            document = yaml.safe_load(yaml_content) or {}
        except yaml.YAMLError as exc:
            return {"valid": False, "errors": [f"Invalid YAML: {exc}"], "warnings": []}

        root = _require_mapping(document, "root", errors)
        if not root:
            return {"valid": False, "errors": errors or ["YAML cannot be empty"], "warnings": warnings}

        allowed_root = {"company", "team", "workflows", "settings"}
        for key in root:
            if key not in allowed_root:
                warnings.append(f"Unknown top-level field '{key}' will be ignored")

        company = _require_mapping(root.get("company"), "company", errors)
        if company:
            for field in company:
                if field not in COMPANY_FIELDS:
                    warnings.append(f"Unknown company field '{field}' will be ignored")
            for field in ("name", "mission", "industry", "stage"):
                if not company.get(field):
                    errors.append(f"company.{field} is required")
            for field in ("monthly_revenue", "runway_months"):
                if field in company and company[field] is not None and not isinstance(company[field], int):
                    errors.append(f"company.{field} must be an integer")

        team = _require_list(root.get("team", []), "team", errors)
        roles: list[str] = []
        for index, item in enumerate(team):
            member = _require_mapping(item, f"team[{index}]", errors)
            if not member:
                continue
            for field in member:
                if field not in TEAM_FIELDS:
                    warnings.append(f"Unknown team[{index}] field '{field}' will be ignored")
            role = member.get("role")
            if not role or not isinstance(role, str):
                errors.append(f"team[{index}].role is required")
            else:
                roles.append(role)
            for field in ("tools", "responsibilities"):
                if field in member and not isinstance(member[field], list):
                    errors.append(f"team[{index}].{field} must be a list")
            if "max_retries" in member and not isinstance(member["max_retries"], int):
                errors.append(f"team[{index}].max_retries must be an integer")
            if "timeout" in member and member["timeout"] is not None and not isinstance(member["timeout"], int):
                errors.append(f"team[{index}].timeout must be an integer")

        duplicates = sorted({role for role in roles if roles.count(role) > 1})
        for role in duplicates:
            errors.append(f"Duplicate team role '{role}'")

        workflows = _require_list(root.get("workflows", []), "workflows", errors)
        for index, item in enumerate(workflows):
            workflow = _require_mapping(item, f"workflows[{index}]", errors)
            if not workflow:
                continue
            for field in workflow:
                if field not in WORKFLOW_FIELDS:
                    warnings.append(f"Unknown workflows[{index}] field '{field}' will be ignored")
            if not workflow.get("name"):
                errors.append(f"workflows[{index}].name is required")
            steps = workflow.get("steps", [])
            if not isinstance(steps, list) or not steps:
                errors.append(f"workflows[{index}].steps must be a non-empty list")
            else:
                for step in steps:
                    if step not in roles:
                        errors.append(f"workflows[{index}].steps references unknown role '{step}'")
            hitl_before = workflow.get("hitl_before", [])
            if hitl_before is not None and not isinstance(hitl_before, list):
                errors.append(f"workflows[{index}].hitl_before must be a list")
            elif isinstance(hitl_before, list):
                for step in hitl_before:
                    if step not in steps:
                        errors.append(f"workflows[{index}].hitl_before references unknown step '{step}'")

            trigger = _require_mapping(workflow.get("trigger", {"type": "manual"}), f"workflows[{index}].trigger", errors)
            for field in trigger:
                if field not in TRIGGER_FIELDS:
                    warnings.append(f"Unknown workflows[{index}].trigger field '{field}' will be ignored")
            trigger_type = trigger.get("type", "manual")
            if trigger_type not in TRIGGER_TYPES:
                errors.append(f"workflows[{index}].trigger.type must be one of {', '.join(sorted(TRIGGER_TYPES))}")
            if trigger_type == "schedule" and not trigger.get("cron"):
                errors.append(f"workflows[{index}].trigger.cron is required for schedule triggers")
            if trigger_type == "webhook" and not trigger.get("webhook_path"):
                errors.append(f"workflows[{index}].trigger.webhook_path is required for webhook triggers")

        yaml_settings = root.get("settings", {})
        if yaml_settings:
            yaml_settings = _require_mapping(yaml_settings, "settings", errors)
            for field in yaml_settings:
                if field not in SETTINGS_FIELDS:
                    warnings.append(f"Unknown settings field '{field}' will be ignored")
            notifications = yaml_settings.get("notifications", {})
            if notifications:
                notifications = _require_mapping(notifications, "settings.notifications", errors)
                for field in notifications:
                    if field not in NOTIFICATION_FIELDS:
                        warnings.append(f"Unknown settings.notifications field '{field}' will be ignored")

        return {"valid": not errors, "errors": errors, "warnings": warnings}

    async def parse_and_apply(self, yaml_content: str, user_id: str, db: AsyncSession, org_id: str | None = None) -> dict:
        validation = self.validate_yaml(yaml_content)
        if not validation["valid"]:
            raise CompanyYamlError("; ".join(validation["errors"]))

        document = yaml.safe_load(yaml_content) or {}
        summary = {
            "created_agents": [],
            "updated_agents": [],
            "created_workflows": [],
            "updated_workflows": [],
            "errors": [],
        }

        company_profile = await self._upsert_company_profile(document["company"], user_id, db, org_id=org_id)
        role_to_agent = await self._upsert_agents(document.get("team", []), company_profile, db, summary)
        await self._upsert_workflows(document.get("workflows", []), role_to_agent, db, summary)
        company_profile.onboarding_complete = True

        await db.commit()
        return summary

    async def preview_changes(self, yaml_content: str, user_id: str, db: AsyncSession, org_id: str | None = None) -> dict:
        validation = self.validate_yaml(yaml_content)
        if not validation["valid"]:
            return {
                "agents_to_create": [],
                "agents_to_update": [],
                "agents_unchanged": [],
                "workflows_to_create": [],
                "workflows_to_update": [],
                "validation": validation,
            }

        document = yaml.safe_load(yaml_content) or {}
        existing_agents = {
            agent.role: agent
            for agent in (await db.execute(select(Agent).where(Agent.org_id == org_id) if org_id else select(Agent))).scalars().all()
        }
        existing_workflows = {
            workflow.name: workflow
            for workflow in (await db.execute(select(Workflow).where(Workflow.org_id == org_id) if org_id else select(Workflow))).scalars().all()
        }

        agents_to_create: list[str] = []
        agents_to_update: list[str] = []
        agents_unchanged: list[str] = []
        company_data = document["company"]
        company = CompanyProfile(
            user_id=user_id,
            org_id=org_id or "",
            company_name=company_data.get("name", "Company"),
            mission=company_data.get("mission"),
            industry=company_data.get("industry"),
            stage=company_data.get("stage"),
            monthly_revenue=company_data.get("monthly_revenue", 0),
            runway_months=company_data.get("runway_months"),
        )

        for item in document.get("team", []):
            agent = existing_agents.get(item["role"])
            if not agent:
                agents_to_create.append(item["role"])
                continue
            desired = self._agent_payload(item, company)
            changed = any(getattr(agent, field) != value for field, value in desired.items())
            (agents_to_update if changed else agents_unchanged).append(item["role"])

        workflows_to_create: list[str] = []
        workflows_to_update: list[str] = []
        for item in document.get("workflows", []):
            if item["name"] in existing_workflows:
                workflows_to_update.append(item["name"])
            else:
                workflows_to_create.append(item["name"])

        return {
            "agents_to_create": agents_to_create,
            "agents_to_update": agents_to_update,
            "agents_unchanged": agents_unchanged,
            "workflows_to_create": workflows_to_create,
            "workflows_to_update": workflows_to_update,
            "validation": validation,
        }

    def generate_yaml_from_current_state(
        self,
        company_profile: CompanyProfile,
        agents: list[Agent],
        workflows: list[Workflow],
    ) -> str:
        payload = {
            "company": {
                "name": company_profile.company_name,
                "mission": company_profile.mission or "",
                "industry": company_profile.industry or "",
                "stage": company_profile.stage or "",
                "monthly_revenue": company_profile.monthly_revenue or 0,
                "runway_months": company_profile.runway_months or 0,
            },
            "team": [
                {
                    "role": agent.role,
                    "name": agent.name,
                    "model": agent.model,
                    "memory_enabled": agent.memory_enabled,
                    "tools": agent.tools or [],
                    "responsibilities": self._extract_responsibilities(agent.system_prompt),
                    "system_prompt_extra": "",
                    "max_retries": agent.max_retries,
                    "timeout": agent.timeout,
                }
                for agent in agents
            ],
            "workflows": [self._workflow_to_yaml(workflow, agents) for workflow in workflows],
            "settings": {
                "default_model": settings.default_model,
                "timezone": "UTC",
                "notifications": {"telegram": False, "email": ""},
            },
        }
        return yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)

    async def _upsert_company_profile(
        self,
        company: dict,
        user_id: str,
        db: AsyncSession,
        org_id: str | None = None,
    ) -> CompanyProfile:
        profile = await self._get_or_build_profile(company, user_id, db, persist=True, org_id=org_id)
        profile.company_name = company["name"]
        profile.mission = company["mission"]
        profile.industry = company["industry"]
        profile.stage = company["stage"]
        profile.monthly_revenue = company.get("monthly_revenue", 0)
        profile.runway_months = company.get("runway_months")
        profile.updated_at = datetime.utcnow()
        return profile

    async def _get_or_build_profile(
        self,
        company: dict,
        user_id: str,
        db: AsyncSession,
        persist: bool,
        org_id: str | None = None,
    ) -> CompanyProfile:
        query = select(CompanyProfile).where(CompanyProfile.user_id == user_id)
        if org_id:
            query = query.where(CompanyProfile.org_id == org_id)
        result = await db.execute(query)
        profile = result.scalar_one_or_none()
        if profile:
            return profile
        if persist and not org_id:
            raise CompanyYamlError("Organization context is required to create a company profile")
        profile = CompanyProfile(
            user_id=user_id,
            org_id=org_id or "",
            company_name=company.get("name", "Company"),
            mission=company.get("mission"),
            industry=company.get("industry"),
            stage=company.get("stage"),
            monthly_revenue=company.get("monthly_revenue", 0),
            runway_months=company.get("runway_months"),
            primary_tech_stack=json.dumps([]),
            goals=json.dumps([]),
        )
        if persist:
            db.add(profile)
            await db.flush()
        return profile

    async def _upsert_agents(
        self,
        team: list[dict],
        company_profile: CompanyProfile,
        db: AsyncSession,
        summary: dict,
    ) -> dict[str, Agent]:
        existing = {
            agent.role: agent
            for agent in (await db.execute(select(Agent).where(Agent.org_id == company_profile.org_id))).scalars().all()
        }
        role_to_agent: dict[str, Agent] = {}

        for item in team:
            agent = existing.get(item["role"])
            payload = self._agent_payload(item, company_profile)
            if agent:
                for field, value in payload.items():
                    setattr(agent, field, value)
                agent.updated_at = datetime.utcnow()
                summary["updated_agents"].append(agent.role)
            else:
                agent = Agent(id=str(uuid4()), org_id=company_profile.org_id, role=item["role"], **payload)
                db.add(agent)
                summary["created_agents"].append(agent.role)
            role_to_agent[item["role"]] = agent

        await db.flush()
        return role_to_agent

    def _agent_payload(self, item: dict, company_profile: CompanyProfile) -> dict:
        responsibilities = item.get("responsibilities") or []
        prompt_lines = "\n".join(f"- {responsibility}" for responsibility in responsibilities)
        extra = item.get("system_prompt_extra") or ""
        company_context = (
            f"Company: {company_profile.company_name}\n"
            f"Mission: {company_profile.mission or 'Not specified'}\n"
            f"Industry: {company_profile.industry or 'Not specified'}\n"
            f"Stage: {company_profile.stage or 'Not specified'}\n"
            f"Monthly revenue: ${company_profile.monthly_revenue or 0}\n"
            f"Runway months: {company_profile.runway_months or 'Not specified'}"
        )
        system_prompt = f"""You are {item.get("name") or item["role"]}, the {item["role"]} for this AI company.

{company_context}

Responsibilities:
{prompt_lines or "- Own your role with senior judgment and practical execution."}

Operating rules:
- Use company context in every recommendation.
- Produce concrete artifacts, not vague advice.
- Ask for clarification only when missing information blocks execution.
{extra}
""".strip()

        return {
            "name": item.get("name") or item["role"],
            "description": f"{item['role']} for {company_profile.company_name}",
            "system_prompt": system_prompt,
            "model": item.get("model") or settings.default_model,
            "tools": item.get("tools") or [],
            "memory_enabled": item.get("memory_enabled", True),
            "memory_window": 20,
            "max_tokens": 2500,
            "temperature": 0.4,
            "max_iterations": 10,
            "timeout": item.get("timeout") or 180,
            "max_retries": item.get("max_retries", 3),
            "retry_delay_seconds": 5,
            "retry_backoff_multiplier": 2.0,
            "retry_on_timeout": True,
            "telegram_enabled": False,
            "is_active": True,
        }

    async def _upsert_workflows(
        self,
        workflows: list[dict],
        role_to_agent: dict[str, Agent],
        db: AsyncSession,
        summary: dict,
    ) -> None:
        existing = {
            workflow.name: workflow
            for workflow in (await db.execute(select(Workflow).where(Workflow.org_id == next(iter(role_to_agent.values())).org_id) if role_to_agent else select(Workflow))).scalars().all()
        }

        for item in workflows:
            workflow = existing.get(item["name"])
            nodes, edges = self._build_workflow_graph(item, role_to_agent)
            trigger = item.get("trigger", {"type": "manual"})
            payload = {
                "description": item.get("description", ""),
                "nodes": nodes,
                "edges": edges,
                "trigger": trigger.get("type", "manual"),
                "schedule": trigger.get("cron"),
                "execution_mode": "sequential" if item.get("sequential", True) else "orchestrator",
                "orchestration_prompt": "",
                "updated_at": datetime.utcnow(),
            }
            if workflow:
                for field, value in payload.items():
                    setattr(workflow, field, value)
                summary["updated_workflows"].append(workflow.name)
            else:
                workflow = Workflow(
                    id=str(uuid4()),
                    org_id=next(iter(role_to_agent.values())).org_id,
                    name=item["name"],
                    status="draft",
                    created_at=datetime.utcnow(),
                    **payload,
                )
                db.add(workflow)
                summary["created_workflows"].append(workflow.name)

    def _build_workflow_graph(self, workflow: dict, role_to_agent: dict[str, Agent]) -> tuple[list[dict], list[dict]]:
        nodes: list[dict] = []
        edges: list[dict] = []
        hitl_before = set(workflow.get("hitl_before") or [])
        previous_id: str | None = None
        x_position = 100

        for index, role in enumerate(workflow.get("steps", []), start=1):
            if role in hitl_before:
                approval_id = f"approval-{_slug(role)}-{index}"
                nodes.append(
                    {
                        "id": approval_id,
                        "type": "approval",
                        "position": {"x": x_position, "y": 80},
                        "data": {
                            "label": "Human approval",
                            "title": f"Review required before {role}",
                            "description": f"Approve before the workflow continues to {role}.",
                            "timeout_hours": 24,
                            "auto_approve_on_timeout": False,
                        },
                    }
                )
                if previous_id:
                    edges.append(self._edge(previous_id, approval_id))
                previous_id = approval_id
                x_position += 260

            agent = role_to_agent[role]
            node_id = f"agent-{_slug(role)}-{index}"
            nodes.append(
                {
                    "id": node_id,
                    "type": "agentNode",
                    "position": {"x": x_position, "y": 220},
                    "data": {
                        "label": agent.name,
                        "agent_id": agent.id,
                        "role": agent.role,
                    },
                }
            )
            if previous_id:
                edges.append(self._edge(previous_id, node_id))
            previous_id = node_id
            x_position += 260

        return nodes, edges

    def _edge(self, source: str, target: str) -> dict:
        return {
            "id": f"e-{source}-{target}",
            "source": source,
            "target": target,
            "animated": True,
        }

    def _workflow_to_yaml(self, workflow: Workflow, agents: list[Agent]) -> dict:
        agent_by_id = {agent.id: agent for agent in agents}
        steps = []
        hitl_before = []
        pending_approval = False
        for node in workflow.nodes or []:
            if node.get("type") == "approval":
                pending_approval = True
                continue
            agent_id = (node.get("data") or {}).get("agent_id")
            if agent_id in agent_by_id:
                role = agent_by_id[agent_id].role
                steps.append(role)
                if pending_approval:
                    hitl_before.append(role)
                    pending_approval = False
        return {
            "name": workflow.name,
            "trigger": {"type": workflow.trigger or "manual", "cron": workflow.schedule},
            "description": workflow.description or "",
            "steps": steps,
            "sequential": workflow.execution_mode != "orchestrator",
            "hitl_before": hitl_before,
        }

    def _extract_responsibilities(self, system_prompt: str) -> list[str]:
        responsibilities = []
        in_section = False
        for line in system_prompt.splitlines():
            stripped = line.strip()
            if stripped.lower().startswith("responsibilities"):
                in_section = True
                continue
            if in_section and stripped.startswith("- "):
                responsibilities.append(stripped[2:])
            elif in_section and stripped:
                break
        return responsibilities or ["Own this role with senior judgment and practical execution."]

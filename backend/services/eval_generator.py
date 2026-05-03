import json
import logging
import uuid

from langchain_core.messages import HumanMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import Agent, CompanyProfile, EvalCase, EvalSuite, Execution, ExecutionStatus, ScoringMethod, Workflow
from runtime.agent_runner import _extract_text, build_llm


logger = logging.getLogger(__name__)


class EvalGenerator:
    """Generates eval suites/cases from successful execution history."""

    async def generate_cases_from_history(
        self,
        agent_id: str,
        suite_id: str,
        count: int = 10,
        db: AsyncSession = None,
    ) -> list[EvalCase]:
        if db is None:
            raise ValueError("db session is required")

        agent = await db.get(Agent, agent_id)
        suite = await db.get(EvalSuite, suite_id)
        if not agent or not suite:
            raise ValueError("Agent or eval suite not found")

        executions = await self._get_agent_executions(agent_id, db)
        if not executions:
            return []

        created: list[EvalCase] = []
        llm = build_llm(settings.default_model, temperature=0.2, max_tokens=1800)
        for batch in self._chunks(executions[:50], 10):
            if len(created) >= count:
                break

            formatted = "\n\n".join(
                f"Interaction {idx + 1}\nInput: {execution.input_message}\nOutput: {execution.output_message}"
                for idx, execution in enumerate(batch)
            )
            prompt = f"""
Review these Aethon teammate interactions.
For each one, create an eval test case.
Each case should test something specific.
Vary the scoring methods: use exact_match for factual outputs,
llm_judge for quality assessments, contains for required elements.

Interactions:
{formatted}

Return JSON array of eval cases:
[
  {{
    "name": "...",
    "input": "...",
    "expected_output": "...",
    "scoring_method": "llm_judge",
    "scoring_config": {{}},
    "tags": "regression"
  }}
]
"""
            try:
                response = await llm.ainvoke([HumanMessage(content=prompt)])
                cases = self._parse_cases(_extract_text(response.content))
            except Exception as exc:
                logger.warning("Eval case generation failed: %s", exc)
                cases = []

            for item in cases:
                if len(created) >= count:
                    break
                scoring_method = item.get("scoring_method") or ScoringMethod.llm_judge.value
                if scoring_method not in {method.value for method in ScoringMethod}:
                    scoring_method = ScoringMethod.llm_judge.value
                case = EvalCase(
                    id=str(uuid.uuid4()),
                    suite_id=suite_id,
                    name=item.get("name") or f"Generated case {len(created) + 1}",
                    description=item.get("description"),
                    input=item.get("input") or "",
                    expected_output=item.get("expected_output"),
                    scoring_method=scoring_method,
                    scoring_config=json.dumps(item.get("scoring_config") or {}),
                    weight=float(item.get("weight") or 1.0),
                    tags=item.get("tags") or "generated,regression",
                )
                if not case.input:
                    continue
                db.add(case)
                created.append(case)

        await db.commit()
        for case in created:
            await db.refresh(case)
        return created

    async def generate_regression_suite(
        self,
        agent_id: str,
        org_id: str | None = None,
        db: AsyncSession = None,
    ) -> EvalSuite:
        if db is None:
            raise ValueError("db session is required")

        agent = await db.get(Agent, agent_id)
        if not agent:
            raise ValueError("Agent not found")

        user_id = await self._infer_user_id(db)
        if not user_id:
            raise ValueError("Unable to infer suite owner")

        suite = EvalSuite(
            id=str(uuid.uuid4()),
            org_id=org_id or agent.org_id,
            user_id=user_id,
            agent_id=agent_id,
            name=f"Regression Suite - {agent.name}",
            description="Automatically generated from successful execution history.",
            pass_threshold=0.85,
        )
        db.add(suite)
        await db.commit()
        await db.refresh(suite)
        await self.generate_cases_from_history(agent_id, suite.id, count=20, db=db)
        return suite

    async def _get_agent_executions(self, agent_id: str, db: AsyncSession) -> list[Execution]:
        result = await db.execute(
            select(Execution, Workflow)
            .join(Workflow, Execution.workflow_id == Workflow.id)
            .where(Execution.status == ExecutionStatus.completed)
            .order_by(Execution.completed_at.desc())
            .limit(100)
        )
        matches = []
        for execution, workflow in result.all():
            if self._workflow_contains_agent(workflow, agent_id):
                matches.append(execution)
            if len(matches) >= 50:
                break
        return matches

    def _workflow_contains_agent(self, workflow: Workflow, agent_id: str) -> bool:
        for node in workflow.nodes or []:
            data = node.get("data") or {}
            if data.get("agent_id") == agent_id:
                return True
            if agent_id in (data.get("agent_ids") or node.get("agent_ids") or []):
                return True
        return False

    async def _infer_user_id(self, db: AsyncSession) -> str | None:
        result = await db.execute(select(CompanyProfile.user_id).limit(1))
        user_id = result.scalar_one_or_none()
        if user_id:
            return user_id
        result = await db.execute(select(EvalSuite.user_id).limit(1))
        return result.scalar_one_or_none()

    def _parse_cases(self, raw: str) -> list[dict]:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            import re

            match = re.search(r"\[[\s\S]*\]", raw)
            if not match:
                return []
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return []
        return parsed if isinstance(parsed, list) else []

    def _chunks(self, items: list, size: int):
        for index in range(0, len(items), size):
            yield items[index : index + size]

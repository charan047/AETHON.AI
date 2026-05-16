import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    EvalCase,
    EvalCaseResult,
    EvalRun,
    EvalRunStatus,
    EvalSuite,
    InAppNotification,
    ModelConfig,
    NotificationPriority,
)
from runtime.agent_runner import AgentRunner
from services.cost_tracker import cost_tracker
from services.scoring_service import ScoringService
from services.websocket_manager import ws_manager
from utils.secret_scanner import redact_secrets


logger = logging.getLogger(__name__)


class EvalRunner:
    """Executes eval suites and records per-case scores."""

    batch_size = 5

    async def run_suite(
        self,
        suite_id: str,
        user_id: str,
        triggered_by: str = "manual",
        git_commit: str = None,
        db: AsyncSession = None,
        model_config_id: str | None = None,
        comparison_group_id: str | None = None,
        comparison_slot: str | None = None,
    ) -> EvalRun:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            suite = await db.get(EvalSuite, suite_id)
            if not suite or suite.user_id != user_id:
                raise ValueError("Eval suite not found")

            cases_result = await db.execute(
                select(EvalCase)
                .where(EvalCase.suite_id == suite_id)
                .order_by(EvalCase.created_at.asc())
            )
            cases = cases_result.scalars().all()
            if not cases:
                raise ValueError("Eval suite has no cases")

            agent = await db.get(Agent, suite.agent_id)
            if not agent:
                raise ValueError("Eval suite agent not found")

            started = time.monotonic()
            run = EvalRun(
                id=str(uuid.uuid4()),
                suite_id=suite_id,
                user_id=user_id,
                model_config_id=model_config_id,
                status=EvalRunStatus.running,
                triggered_by=triggered_by,
                total_cases=len(cases),
                git_commit=git_commit,
                comparison_group_id=comparison_group_id,
                comparison_slot=comparison_slot,
            )
            db.add(run)
            await db.commit()
            await db.refresh(run)

            await ws_manager.broadcast(
                {
                    "type": "eval_run_started",
                    "run_id": run.id,
                    "suite_name": suite.name,
                    "total_cases": len(cases),
                }
            )

            case_results = []
            for index in range(0, len(cases), self.batch_size):
                batch = cases[index : index + self.batch_size]
                batch_results = await asyncio.gather(
                    *[
                        self._run_case(
                            suite_id=suite_id,
                            run_id=run.id,
                            case_id=case.id,
                            agent_id=agent.id,
                            user_id=user_id,
                            model_config_id=model_config_id,
                        )
                        for case in batch
                    ],
                    return_exceptions=True,
                )
                case_results.extend(batch_results)

            weighted_score = 0.0
            total_weight = 0.0
            passed_cases = 0
            failed_cases = 0
            error_cases = 0
            total_cost = 0.0

            for case, result in zip(cases, case_results):
                weight = float(case.weight or 1.0)
                total_weight += weight
                if isinstance(result, Exception):
                    logger.exception("Eval case task failed", exc_info=result)
                    failed_cases += 1
                    error_cases += 1
                    continue

                score = float(result.get("score") or 0.0)
                weighted_score += score * weight
                total_cost += float(result.get("cost_usd") or 0.0)
                if result.get("error"):
                    error_cases += 1
                if result.get("passed"):
                    passed_cases += 1
                else:
                    failed_cases += 1

            suite_score = weighted_score / total_weight if total_weight else 0.0
            passed = suite_score >= float(suite.pass_threshold or 0.8)

            run.status = EvalRunStatus.completed
            run.passed_cases = passed_cases
            run.failed_cases = failed_cases
            run.error_cases = error_cases
            run.suite_score = suite_score
            run.passed = passed
            run.duration_seconds = int(time.monotonic() - started)
            run.total_cost_usd = round(total_cost, 8)
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(run)

            total_cases = len(cases)
            pass_rate = (passed_cases / total_cases * 100) if total_cases > 0 else 0.0
            try:
                from services.trust_score_service import trust_score_service

                await trust_score_service.record_eval_completed(
                    agent_id=str(suite.agent_id),
                    pass_rate=pass_rate,
                    total_cases=total_cases,
                    passed_cases=passed_cases,
                    db=db,
                )
            except Exception as exc:
                logger.warning("Trust score eval update failed: %s", exc)

            await ws_manager.broadcast(
                {
                    "type": "eval_run_completed",
                    "org_id": suite.org_id,
                    "run_id": run.id,
                    "suite_score": suite_score,
                    "passed": passed,
                    "passed_count": passed_cases,
                    "failed_count": failed_cases,
                }
            )

            if not passed:
                db.add(
                    InAppNotification(
                        id=str(uuid.uuid4()),
                        org_id=suite.org_id,
                        user_id=user_id,
                        title=f"Eval suite '{suite.name}' failed",
                        message=(
                            f"Eval suite '{suite.name}' FAILED - score {suite_score:.1%} "
                            f"(threshold: {float(suite.pass_threshold or 0.8):.1%}). "
                            "Review results before deploying."
                        ),
                        priority=NotificationPriority.urgent,
                        action_url=f"/evals/runs/{run.id}",
                    )
                )
                await db.commit()

            return run
        except Exception:
            if "run" in locals():
                run.status = EvalRunStatus.failed
                run.completed_at = datetime.now(timezone.utc)
                run.notes = "Eval run failed before completion"
                await db.commit()
            raise
        finally:
            if owns_session:
                await db.close()

    async def _run_case(
        self,
        suite_id: str,
        run_id: str,
        case_id: str,
        agent_id: str,
        user_id: str,
        model_config_id: str | None = None,
    ) -> dict:
        async with AsyncSessionLocal() as db:
            case = await db.get(EvalCase, case_id)
            suite = await db.get(EvalSuite, suite_id)
            agent = await db.get(Agent, agent_id)
            if not case or not suite or not agent:
                raise ValueError("Eval case, suite, or agent was not found")

            result = EvalCaseResult(
                id=str(uuid.uuid4()),
                run_id=run_id,
                case_id=case_id,
            )
            db.add(result)
            await db.commit()
            await db.refresh(result)

            started = time.monotonic()
            actual_output = ""
            tokens_used = 0
            cost_usd = 0.0
            score = 0.0
            details = {}
            passed = False
            error_message = None

            try:
                # Eval runs must not contaminate long-term production memory.
                memory_config = SimpleNamespace(
                    memory_enabled=False,
                    max_memories_per_query=0,
                    memory_window_days=0,
                )
                runner_agent = agent
                if model_config_id:
                    override_cfg = await db.scalar(
                        select(ModelConfig).where(
                            ModelConfig.id == model_config_id,
                            ModelConfig.org_id == getattr(agent, "org_id", None),
                        )
                    )
                    if override_cfg:
                        # Eval-only override: omit the persisted agent id so AgentRunner
                        # uses the supplied model directly instead of the saved assignment.
                        runner_agent = SimpleNamespace(
                            **{
                                key: value
                                for key, value in agent.__dict__.items()
                                if not key.startswith("_")
                            }
                        )
                        runner_agent.id = None
                        runner_agent.model = override_cfg.model_id
                        runner_agent.model_config_id = override_cfg.id
                        runner_agent.org_id = None

                runner = AgentRunner(runner_agent, memory_config=memory_config)
                actual_output, tokens_used = await runner.run(
                    case.input,
                    user_id=user_id,
                    thread_id=f"eval_{run_id}_{case.id}",
                    workflow_id=None,
                    execution_id=None,
                    org_id=getattr(agent, "org_id", None),
                )

                score, details = await ScoringService().score(case, actual_output)
                pass_threshold = self._case_pass_threshold(case, suite)
                passed = score >= pass_threshold
                input_tokens = int((tokens_used or 0) * 0.6)
                output_tokens = int(tokens_used or 0) - input_tokens
                cost_model = getattr(runner_agent, "model", None) or agent.model
                cost_usd = cost_tracker.calculate_cost(cost_model, input_tokens, output_tokens)
                details.setdefault("pass_threshold", pass_threshold)
            except Exception as exc:
                error_message = str(exc)
                details = {"error": error_message}

            result.actual_output = redact_secrets(actual_output)
            result.score = score
            result.passed = passed
            result.scoring_details = json.dumps(details, default=str)
            result.error_message = error_message
            result.duration_seconds = time.monotonic() - started
            result.tokens_used = tokens_used or 0
            result.cost_usd = cost_usd
            await db.commit()

            await ws_manager.broadcast(
                {
                    "type": "eval_case_completed",
                    "run_id": run_id,
                    "case_name": case.name,
                    "score": score,
                    "passed": passed,
                    "error": error_message,
                }
            )

            return {
                "case_id": case_id,
                "score": score,
                "passed": passed,
                "error": error_message,
                "tokens_used": tokens_used or 0,
                "cost_usd": cost_usd,
            }

    def _case_pass_threshold(self, case: EvalCase, suite: EvalSuite) -> float:
        try:
            config = json.loads(case.scoring_config or "{}")
            if isinstance(config, dict) and "pass_threshold" in config:
                return float(config["pass_threshold"])
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
        return float(suite.pass_threshold or 0.8)

    async def run_suite_background(
        self,
        suite_id: str,
        user_id: str,
        **kwargs,
    ):
        from tasks.eval_tasks import run_eval_suite_task

        task = run_eval_suite_task.delay(suite_id, user_id, **kwargs)
        return task

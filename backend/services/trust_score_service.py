import logging
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, AgentTrustScore


logger = logging.getLogger(__name__)


TOOL_SKILL_MAP = {
    "web_search": "research",
    "web_scrape": "research",
    "news_search": "research",
    "firecrawl_scrape": "research",
    "firecrawl_crawl": "research",
    "gmail_read": "communication",
    "gmail_send": "communication",
    "slack_post": "communication",
    "slack_read": "communication",
    "google_docs_create": "productivity",
    "google_sheets_create": "productivity",
    "code_executor": "code",
}

AUTONOMY_THRESHOLDS = {
    "restricted": (0, 35),
    "supervised": (35, 62),
    "semi_autonomous": (62, 78),
    "autonomous": (78, 100),
}

AUTONOMY_EVAL_REQUIREMENTS = {
    "autonomous": 80.0,
}

OVERALL_SCORE_WEIGHTS = {
    "task_success_rate": 0.40,
    "review_pass_rate": 0.20,
    "risky_action_rate": 0.08,
    "on_time_rate": 0.10,
    "cost_efficiency": 0.07,
    "eval_pass_rate": 0.15,
}


class TrustScoreService:
    async def record_task_completed(
        self,
        agent_id: str,
        success: bool,
        on_time: bool,
        cost_cents: int,
        budget_cents: int,
        tools_used: list[str],
        db: AsyncSession,
    ) -> None:
        try:
            score = await self._get_or_create(agent_id, db)
            old_autonomy_score = score.overall_score

            score.total_tasks += 1
            if success:
                score.successful_tasks += 1
            else:
                score.failed_tasks += 1
            score.task_success_rate = score.successful_tasks / score.total_tasks * 100

            n = score.total_tasks
            score.on_time_rate = (score.on_time_rate * (n - 1) + (100 if on_time else 0)) / n

            if budget_cents > 0:
                eff = max(0, 100 - max(0, cost_cents - budget_cents) / budget_cents * 100)
                score.cost_efficiency = (score.cost_efficiency * (n - 1) + eff) / n

            skill_scores = dict(score.skill_scores or {})
            touched_domains = set()
            for tool in tools_used:
                domain = TOOL_SKILL_MAP.get(tool)
                if domain:
                    touched_domains.add(domain)

            for domain in touched_domains:
                current = float(skill_scores.get(domain, 50.0))
                if success:
                    skill_scores[domain] = round(min(100, current + (100 - current) * 0.1), 1)
                else:
                    skill_scores[domain] = round(max(0, current - current * 0.15), 1)
            score.skill_scores = skill_scores

            await self._recalculate(score, agent_id, old_autonomy_score, db)
            await db.commit()

        except Exception as exc:
            logger.warning("trust_score record_task_completed failed: %s", exc)

    async def record_review_result(
        self,
        agent_id: str,
        passed: bool,
        db: AsyncSession,
    ) -> None:
        try:
            score = await self._get_or_create(agent_id, db)
            score.total_reviews += 1
            if passed:
                score.passed_reviews += 1
            score.review_pass_rate = score.passed_reviews / score.total_reviews * 100
            await self._recalculate(score, agent_id, score.overall_score, db)
            await db.commit()
        except Exception as exc:
            logger.warning("trust_score record_review failed: %s", exc)

    async def record_human_override(self, agent_id: str, db: AsyncSession) -> None:
        try:
            score = await self._get_or_create(agent_id, db)
            score.human_overrides += 1
            await self._recalculate(score, agent_id, score.overall_score, db)
            await db.commit()
        except Exception as exc:
            logger.warning("trust_score record_override failed: %s", exc)

    async def record_eval_completed(
        self,
        agent_id: str,
        pass_rate: float,
        total_cases: int,
        passed_cases: int,
        db: AsyncSession,
    ) -> dict:
        """
        Update trust score after an eval run.

        Eval pass rate contributes to the overall score and gates future
        autonomy promotions so agents need evidence before graduating.
        """
        del total_cases, passed_cases
        score = await self._get_or_create(agent_id, db)
        old_score = score.overall_score

        score.eval_pass_rate = max(0.0, min(100.0, float(pass_rate or 0.0)))
        score.eval_runs_count = int(score.eval_runs_count or 0) + 1

        await self._recalculate(score, agent_id, old_score, db, learning_rate_override=1.0)
        await db.commit()

        return {
            "overall_score": round(score.overall_score, 1),
            "eval_pass_rate": round(score.eval_pass_rate, 1),
            "eval_runs_count": score.eval_runs_count,
        }

    async def get_details(self, agent_id: str, db: AsyncSession) -> dict:
        score = await self._get_or_create(agent_id, db)
        current_level = self._score_to_autonomy(score.overall_score)

        next_threshold = None
        for level, (lo, _hi) in sorted(AUTONOMY_THRESHOLDS.items(), key=lambda item: item[1][0]):
            if score.overall_score < lo:
                next_threshold = (level, lo)
                break

        return {
            "overall_score": round(score.overall_score, 1),
            "autonomy_level": current_level,
            "trajectory": score.trajectory,
            "trajectory_delta": round(score.trajectory_delta, 1),
            "skill_scores": score.skill_scores or {},
            "eval_pass_rate": round(score.eval_pass_rate or 0, 1),
            "eval_runs_count": score.eval_runs_count or 0,
            "components": {
                "task_success_rate": round(score.task_success_rate, 1),
                "review_pass_rate": round(score.review_pass_rate, 1),
                "risky_action_rate": round(score.risky_action_rate, 1),
                "on_time_rate": round(score.on_time_rate, 1),
                "cost_efficiency": round(score.cost_efficiency, 1),
                "eval_pass_rate": round(score.eval_pass_rate or 0, 1),
            },
            "counters": {
                "total_tasks": score.total_tasks,
                "successful_tasks": score.successful_tasks,
                "failed_tasks": score.failed_tasks,
            },
            "next_level": (
                {
                    "level": next_threshold[0],
                    "points_needed": round(next_threshold[1] - score.overall_score, 1),
                }
                if next_threshold
                else None
            ),
            "autonomy_history": score.autonomy_history or [],
            "last_calculated": score.last_calculated.isoformat() if score.last_calculated else None,
        }

    async def _recalculate(
        self,
        score: AgentTrustScore,
        agent_id: str,
        old_score: float,
        db: AsyncSession,
        learning_rate_override: float | None = None,
    ) -> None:
        evidence_count = max(
            int(score.total_tasks or 0),
            int(score.total_reviews or 0),
            int(score.eval_runs_count or 0),
        )

        if evidence_count == 0:
            score.overall_score = 50.0
        else:
            raw_score = (
                (score.task_success_rate * OVERALL_SCORE_WEIGHTS["task_success_rate"])
                + (score.review_pass_rate * OVERALL_SCORE_WEIGHTS["review_pass_rate"])
                + (score.risky_action_rate * OVERALL_SCORE_WEIGHTS["risky_action_rate"])
                + (score.on_time_rate * OVERALL_SCORE_WEIGHTS["on_time_rate"])
                + (score.cost_efficiency * OVERALL_SCORE_WEIGHTS["cost_efficiency"])
                + (score.eval_pass_rate * OVERALL_SCORE_WEIGHTS["eval_pass_rate"])
                + (max(0, 100 - (score.human_overrides * 5)) * 0.05)
            )
            learning_rate = (
                learning_rate_override
                if learning_rate_override is not None
                else (0.15 if (score.total_tasks or 0) <= 20 else 0.05)
            )
            score.overall_score = round(
                min(
                    100,
                    max(0, (old_score * (1 - learning_rate)) + (raw_score * learning_rate)),
                ),
                1,
            )

        if score.total_tasks >= 5:
            delta = score.overall_score - old_score
            if delta > 3:
                score.trajectory = "rising"
                score.trajectory_delta = round(delta, 1)
            elif delta < -3:
                score.trajectory = "falling"
                score.trajectory_delta = round(abs(delta), 1)
            else:
                score.trajectory = "stable"
                score.trajectory_delta = 0.0

        score.last_calculated = datetime.utcnow()

        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        current_level = getattr(agent, "autonomy_level", None) or self._score_to_autonomy(old_score)
        candidate_level = self._score_to_autonomy(score.overall_score)
        if self._autonomy_rank(candidate_level) > self._autonomy_rank(current_level):
            if not self._passes_eval_gate(candidate_level, score):
                candidate_level = current_level

        new_level = candidate_level
        old_level = current_level

        await db.execute(
            update(Agent)
            .where(Agent.id == agent_id)
            .values(trust_score=score.overall_score, autonomy_level=new_level)
        )

        if old_level != new_level:
            await self._on_autonomy_change(score, agent_id, old_level, new_level, db)

    async def _on_autonomy_change(
        self,
        score: AgentTrustScore,
        agent_id: str,
        old_level: str,
        new_level: str,
        db: AsyncSession,
    ) -> None:
        direction = "promoted" if self._autonomy_rank(new_level) > self._autonomy_rank(old_level) else "restricted"

        history = list(score.autonomy_history or [])
        history.append(
            {
                "from": old_level,
                "to": new_level,
                "direction": direction,
                "score_at_change": score.overall_score,
                "at": datetime.utcnow().isoformat(),
            }
        )
        score.autonomy_history = history

        try:
            agent_r = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_r.scalar_one_or_none()
            if agent:
                from services.websocket_manager import ws_manager
                from services.notification_email_service import notification_email_service

                await ws_manager.broadcast_to_channel(
                    f"org:{agent.org_id}",
                    {
                        "event": "agent_autonomy_changed",
                        "agent_id": agent_id,
                        "agent_name": agent.name,
                        "old_level": old_level,
                        "new_level": new_level,
                        "direction": direction,
                        "new_score": round(score.overall_score, 1),
                    },
                )
                await notification_email_service.send_autonomy_changed(
                    org_id=agent.org_id,
                    agent_name=agent.name,
                    old_level=old_level,
                    new_level=new_level,
                    score=score.overall_score,
                )
        except Exception as exc:
            logger.warning("WebSocket autonomy notification failed: %s", exc)

    def _score_to_autonomy(self, score: float) -> str:
        ordered = sorted(AUTONOMY_THRESHOLDS.items(), key=lambda item: item[1][0])
        for level, (lo, hi) in ordered:
            if lo <= score < hi:
                return level
        return ordered[-1][0] if score >= ordered[-1][1][0] else ordered[0][0]

    def _passes_eval_gate(self, level: str, score: AgentTrustScore) -> bool:
        required = AUTONOMY_EVAL_REQUIREMENTS.get(level)
        if required is None:
            return True
        return (score.eval_runs_count or 0) > 0 and (score.eval_pass_rate or 0.0) >= required

    def _autonomy_rank(self, level: str) -> int:
        return {
            "restricted": 0,
            "supervised": 1,
            "semi_autonomous": 2,
            "autonomous": 3,
        }.get(level, 0)

    async def _get_or_create(self, agent_id: str, db: AsyncSession) -> AgentTrustScore:
        r = await db.execute(select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id))
        score = r.scalar_one_or_none()
        if not score:
            score = AgentTrustScore(
                id=str(uuid4()),
                agent_id=agent_id,
                task_success_rate=0.0,
                review_pass_rate=0.0,
                overall_score=50.0,
                risky_action_rate=100.0,
                cost_efficiency=100.0,
                on_time_rate=100.0,
                eval_pass_rate=0.0,
                total_tasks=0,
                successful_tasks=0,
                failed_tasks=0,
                total_reviews=0,
                passed_reviews=0,
                eval_runs_count=0,
            )
            db.add(score)
            await db.flush()
        return score


trust_score_service = TrustScoreService()

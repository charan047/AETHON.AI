import json
from datetime import datetime
from uuid import uuid4

from langchain_core.messages import HumanMessage
import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import Agent, AgentFeedback, AgentReputation, FeedbackType
from services.distributed_lock import DistributedLock


class ReputationService:
    async def record_feedback(
        self,
        agent_id: str,
        execution_id: str,
        user_id: str,
        feedback_type: FeedbackType,
        original_output: str,
        edited_output: str = None,
        comment: str = None,
        task_description: str = None,
        db: AsyncSession = None,
    ) -> None:
        if db is None:
            async with AsyncSessionLocal() as session:
                await self.record_feedback(
                    agent_id=agent_id,
                    execution_id=execution_id,
                    user_id=user_id,
                    feedback_type=feedback_type,
                    original_output=original_output,
                    edited_output=edited_output,
                    comment=comment,
                    task_description=task_description,
                    db=session,
                )
                return

        feedback = AgentFeedback(
            id=str(uuid4()),
            agent_id=agent_id,
            execution_id=execution_id,
            user_id=user_id,
            feedback_type=feedback_type,
            original_output=original_output,
            edited_output=edited_output,
            comment=comment,
            task_description=task_description,
        )
        db.add(feedback)
        await db.flush()
        await self._update_reputation(agent_id, db)
        if edited_output:
            await self._extract_learning(agent_id, feedback, db)
        await db.commit()

    async def _update_reputation(self, agent_id: str, db: AsyncSession) -> None:
        redis_client = redis.from_url(settings.redis_url, decode_responses=True)
        try:
            async with DistributedLock(redis_client, f"reputation:{agent_id}", ttl=10):
                await self._recompute_reputation(agent_id, db)
        except Exception:
            # Reputation updates should continue to work even if Redis is unavailable.
            await self._recompute_reputation(agent_id, db)
        finally:
            await redis_client.aclose()

    async def _recompute_reputation(self, agent_id: str, db: AsyncSession) -> None:
        result = await db.execute(select(AgentFeedback).where(AgentFeedback.agent_id == agent_id))
        feedback_items = result.scalars().all()
        total_tasks = len(feedback_items)
        approved_count = sum(1 for item in feedback_items if item.feedback_type == FeedbackType.approved)
        rejected_count = sum(1 for item in feedback_items if item.feedback_type == FeedbackType.rejected)
        edited_count = sum(1 for item in feedback_items if item.feedback_type == FeedbackType.edited)
        approval_rate = approved_count / total_tasks if total_tasks else 0.0

        distances = [
            self._normalized_edit_distance(item.original_output, item.edited_output)
            for item in feedback_items
            if item.edited_output
        ]
        avg_edit_distance = sum(distances) / len(distances) if distances else 0.0

        reputation = await self.get_reputation(agent_id, db)
        reputation.total_tasks = total_tasks
        reputation.approved_count = approved_count
        reputation.rejected_count = rejected_count
        reputation.edited_count = edited_count
        reputation.approval_rate = approval_rate
        reputation.avg_edit_distance = avg_edit_distance
        reputation.last_updated = datetime.utcnow()

        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        if agent:
            # Phase 9 trust is sourced from AgentTrustScore and execution outcomes.
            # Reputation still powers learning context, but should not overwrite the
            # task-level trust score maintained by TrustScoreService.
            agent.updated_at = datetime.utcnow()

        await db.flush()

    async def _extract_learning(
        self,
        agent_id: str,
        feedback: AgentFeedback,
        db: AsyncSession,
    ) -> None:
        learning = await self._generate_learning_note(feedback)
        if not learning:
            return

        reputation = await self.get_reputation(agent_id, db)
        notes = self._parse_learning_notes(reputation.learning_notes)
        notes.append({"note": learning, "created_at": datetime.utcnow().isoformat()})
        reputation.learning_notes = json.dumps(notes[-20:])
        reputation.last_updated = datetime.utcnow()
        await db.flush()

    async def get_reputation(self, agent_id: str, db: AsyncSession) -> AgentReputation:
        result = await db.execute(select(AgentReputation).where(AgentReputation.agent_id == agent_id))
        reputation = result.scalar_one_or_none()
        if reputation:
            return reputation

        reputation = AgentReputation(id=str(uuid4()), agent_id=agent_id, learning_notes=json.dumps([]))
        db.add(reputation)
        await db.flush()
        return reputation

    async def get_learning_context(self, agent_id: str, db: AsyncSession) -> str:
        reputation = await self.get_reputation(agent_id, db)
        notes = self._parse_learning_notes(reputation.learning_notes)
        if not notes:
            return ""

        bullets = "\n".join(f"- {item.get('note') or item}" for item in notes if item)
        return f"LEARNED PREFERENCES (from past human feedback):\n{bullets}" if bullets else ""

    def _parse_learning_notes(self, value: str | None) -> list:
        if not value:
            return []
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []

    async def _generate_learning_note(self, feedback: AgentFeedback) -> str:
        fallback = "Prefer the edited structure, tone, and level of detail from the human revision."
        if not settings.openai_compatible_api_key:
            return fallback

        prompt = (
            "An Aethon teammate produced output A. A human edited it to output B.\n"
            "In one sentence, what preference or style can we learn from this edit?\n"
            "Be specific and actionable. Output only the learning, nothing else.\n\n"
            f"A = {feedback.original_output[:500]}\n\n"
            f"B = {(feedback.edited_output or '')[:500]}"
        )
        try:
            from runtime.agent_runner import _extract_text, build_llm

            llm = build_llm(settings.default_model, temperature=0.2, max_tokens=120)
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            return _extract_text(response.content).strip() or fallback
        except Exception:
            return fallback

    def _normalized_edit_distance(self, original: str, edited: str | None) -> float:
        if not edited:
            return 0.0
        max_len = max(len(original), len(edited), 1)
        return self._levenshtein(original, edited) / max_len

    def _calculate_trust_score(
        self,
        *,
        total_tasks: int,
        approval_rate: float,
        rejected_count: int,
        edited_count: int,
        avg_edit_distance: float,
    ) -> float:
        if total_tasks <= 0:
            return 50.0

        rejected_rate = rejected_count / total_tasks
        edited_rate = edited_count / total_tasks

        score = (
            45.0
            + min(total_tasks, 20) * 1.5
            + approval_rate * 25.0
            - rejected_rate * 25.0
            - edited_rate * 10.0
            - avg_edit_distance * 15.0
        )
        return max(0.0, min(100.0, round(score, 1)))

    def _levenshtein(self, a: str, b: str) -> int:
        if a == b:
            return 0
        if not a:
            return len(b)
        if not b:
            return len(a)

        previous = list(range(len(b) + 1))
        for i, char_a in enumerate(a, start=1):
            current = [i]
            for j, char_b in enumerate(b, start=1):
                insert = current[j - 1] + 1
                delete = previous[j] + 1
                replace = previous[j - 1] + (char_a != char_b)
                current.append(min(insert, delete, replace))
            previous = current
        return previous[-1]

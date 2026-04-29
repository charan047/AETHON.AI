import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    CompanyProfile,
    Execution,
    ExecutionCostLog,
    InAppNotification,
    NotificationPriority,
    Workflow,
)
from services.websocket_manager import ws_manager


MODEL_COSTS = {
    "gpt-4o": {"input": 5.00, "output": 15.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3-haiku": {"input": 0.25, "output": 1.25},
    "claude-3-opus": {"input": 15.00, "output": 75.00},
    "llama-3.3-70b-versatile": {"input": 0.59, "output": 0.79},
    "llama-3.1-8b-instant": {"input": 0.05, "output": 0.08},
    "mixtral-8x7b-32768": {"input": 0.24, "output": 0.24},
    "gemini-1.5-pro": {"input": 3.50, "output": 10.50},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
}


class CostTracker:
    def __init__(self):
        self.logger = logging.getLogger("cost_tracker")

    def calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        pricing = MODEL_COSTS.get(model)
        if not pricing:
            self.logger.warning("No pricing configured for model %s; using default $0.001 / 1k tokens", model)
            cost = ((input_tokens or 0) + (output_tokens or 0)) / 1000 * 0.001
        else:
            cost = ((input_tokens or 0) / 1_000_000 * pricing["input"]) + (
                (output_tokens or 0) / 1_000_000 * pricing["output"]
            )
        return round(cost, 8)

    async def record_execution_cost(
        self,
        execution_id: str,
        agent_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        db: AsyncSession,
        user_id: str | None = None,
    ) -> float:
        cost = self.calculate_cost(model, input_tokens, output_tokens)
        execution = await db.get(Execution, execution_id)
        if not execution:
            return cost

        user_id = user_id or await self._infer_user_id(execution, db)
        if not user_id:
            return cost

        execution.cost = round((execution.cost or 0) + cost, 8)
        db.add(
            ExecutionCostLog(
                id=str(uuid.uuid4()),
                execution_id=execution_id,
                agent_id=agent_id,
                user_id=user_id,
                model=model,
                input_tokens=input_tokens or 0,
                output_tokens=output_tokens or 0,
                cost_usd=cost,
            )
        )
        await db.commit()
        await self.check_budget_alert(user_id, db)
        return cost

    async def get_user_costs(
        self,
        user_id: str,
        period_days: int = 30,
        db: AsyncSession | None = None,
    ) -> dict:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            since = datetime.now(timezone.utc) - timedelta(days=period_days)
            result = await db.execute(
                select(ExecutionCostLog, Agent.name, Workflow.name)
                .outerjoin(Agent, ExecutionCostLog.agent_id == Agent.id)
                .outerjoin(Execution, ExecutionCostLog.execution_id == Execution.id)
                .outerjoin(Workflow, Execution.workflow_id == Workflow.id)
                .where(
                    ExecutionCostLog.user_id == user_id,
                    ExecutionCostLog.created_at >= since,
                )
                .order_by(ExecutionCostLog.created_at.asc())
            )
            rows = result.all()

            total = 0.0
            by_agent = defaultdict(float)
            by_model = defaultdict(float)
            by_workflow = defaultdict(float)
            daily = defaultdict(float)

            for log, agent_name, workflow_name in rows:
                total += log.cost_usd or 0
                by_agent[agent_name or log.agent_id or "Unknown"] += log.cost_usd or 0
                by_model[log.model] += log.cost_usd or 0
                by_workflow[workflow_name or "Unknown workflow"] += log.cost_usd or 0
                day = log.created_at.date().isoformat() if log.created_at else datetime.utcnow().date().isoformat()
                daily[day] += log.cost_usd or 0

            projected = (total / max(period_days, 1)) * 30
            return {
                "total_cost": round(total, 8),
                "by_agent": {key: round(value, 8) for key, value in by_agent.items()},
                "by_model": {key: round(value, 8) for key, value in by_model.items()},
                "by_workflow": {key: round(value, 8) for key, value in by_workflow.items()},
                "daily_breakdown": [
                    {"date": key, "cost": round(value, 8)}
                    for key, value in sorted(daily.items())
                ],
                "projected_monthly": round(projected, 8),
                "period_days": period_days,
            }
        finally:
            if owns_session:
                await db.close()

    async def check_budget_alert(self, user_id: str, db: AsyncSession | None = None) -> None:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            profile = await db.scalar(select(CompanyProfile).where(CompanyProfile.user_id == user_id))
            budget = float(getattr(profile, "monthly_budget_usd", 50.0) or 50.0)
            month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            spend = await db.scalar(
                select(func.coalesce(func.sum(ExecutionCostLog.cost_usd), 0.0)).where(
                    ExecutionCostLog.user_id == user_id,
                    ExecutionCostLog.created_at >= month_start,
                )
            ) or 0.0

            if spend <= budget * 0.8:
                return

            event_type = "budget_exceeded" if spend > budget else "budget_warning"
            await ws_manager.broadcast(
                {
                    "type": event_type,
                    "user_id": user_id,
                    "monthly_spend": round(spend, 4),
                    "monthly_budget": budget,
                }
            )

            if spend > budget:
                db.add(
                    InAppNotification(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        title="Monthly AI budget exceeded",
                        message=f"This month's AI spend is ${spend:.2f}, above your ${budget:.2f} budget.",
                        priority=NotificationPriority.urgent,
                        action_url="/analytics",
                    )
                )
                await db.commit()
        finally:
            if owns_session:
                await db.close()

    async def _infer_user_id(self, execution: Execution, db: AsyncSession) -> str | None:
        # Workflows are currently global in this schema. Prefer an existing cost
        # owner for this execution, otherwise fall back to the first company owner.
        existing = await db.scalar(
            select(ExecutionCostLog.user_id)
            .where(ExecutionCostLog.execution_id == execution.id)
            .limit(1)
        )
        if existing:
            return existing
        profile = await db.scalar(select(CompanyProfile).limit(1))
        return profile.user_id if profile else None


cost_tracker = CostTracker()

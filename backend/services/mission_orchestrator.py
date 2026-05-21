from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.executions import enqueue_workflow_execution
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    Client,
    Execution,
    ExecutionStatus,
    ExecutionStep,
    Mission,
    MissionStatus,
    MissionTask,
    MissionTaskStatus,
    Workflow,
)
from services.model_service import model_service
from services.websocket_manager import ws_manager


logger = logging.getLogger(__name__)


class MissionOrchestrator:
    @staticmethod
    def _looks_like_capability_mismatch(output_summary: str | None, agent: Agent | None) -> bool:
        if not output_summary or not agent:
            return False
        normalized = output_summary.lower()
        search_tools = {"web_search", "web_scrape", "news_search", "firecrawl_scrape", "firecrawl_crawl"}
        if not search_tools.intersection(set(agent.tools or [])):
            return False
        mismatch_markers = (
            "no applicable search or browsing tool is available",
            "unable to perform the required research because",
            "i'm unable to perform the required research because",
            "i’m unable to perform the required research because",
            "cannot access the web",
            "can't access the web",
        )
        return any(marker in normalized for marker in mismatch_markers)

    async def run(self, mission_id: str, db: AsyncSession | None = None) -> None:
        mission = None
        if db is not None:
            mission = await db.scalar(select(Mission).where(Mission.id == mission_id))
        if mission is None:
            async with AsyncSessionLocal() as lookup_db:
                mission = await lookup_db.scalar(select(Mission).where(Mission.id == mission_id))

        if not mission:
            logger.error("Mission %s not found", mission_id)
            return

        try:
            await self._orchestrate(mission.id)
        except Exception as exc:
            logger.exception("Mission %s failed: %s", mission_id, exc)
            async with AsyncSessionLocal() as fail_db:
                current = await fail_db.scalar(select(Mission).where(Mission.id == mission_id))
                if current:
                    current.status = MissionStatus.failed
                    await fail_db.commit()

    async def _orchestrate(self, mission_id: str) -> None:
        while True:
            async with AsyncSessionLocal() as loop_db:
                mission = await loop_db.scalar(select(Mission).where(Mission.id == mission_id))
                if not mission:
                    return

                tasks = (
                    await loop_db.execute(
                        select(MissionTask)
                        .where(MissionTask.mission_id == mission_id, MissionTask.org_id == mission.org_id)
                        .order_by(MissionTask.sequence.asc(), MissionTask.id.asc())
                    )
                ).scalars().all()

            if tasks:
                await self._reconcile_running_tasks(mission_id, mission.org_id)
                async with AsyncSessionLocal() as refresh_db:
                    tasks = (
                        await refresh_db.execute(
                            select(MissionTask)
                            .where(MissionTask.mission_id == mission_id, MissionTask.org_id == mission.org_id)
                            .order_by(MissionTask.sequence.asc(), MissionTask.id.asc())
                        )
                    ).scalars().all()

            statuses = {task.status for task in tasks}
            terminal = {
                MissionTaskStatus.completed,
                MissionTaskStatus.failed,
                MissionTaskStatus.skipped,
            }
            if tasks and statuses <= terminal:
                await self._finalize_mission(mission_id, tasks)
                return

            completed_ids = {task.id for task in tasks if task.status == MissionTaskStatus.completed}
            failed_ids = {task.id for task in tasks if task.status == MissionTaskStatus.failed}
            skipped_ids = {task.id for task in tasks if task.status == MissionTaskStatus.skipped}
            blocked_ids = failed_ids | skipped_ids

            ready_tasks: list[MissionTask] = []

            for task in tasks:
                if task.status != MissionTaskStatus.pending:
                    continue

                dep_ids = {dep for dep in (task.depends_on or "").split(",") if dep}
                if dep_ids & blocked_ids:
                    await self._mark_task_skipped(task.id, "Dependency failed or was skipped.")
                    continue
                if dep_ids and not dep_ids.issubset(completed_ids):
                    continue
                ready_tasks.append(task)

            if ready_tasks:
                async with AsyncSessionLocal() as mission_db:
                    mission = await mission_db.scalar(select(Mission).where(Mission.id == mission_id))
                    if mission:
                        await asyncio.gather(
                            *(self._dispatch_task(task, tasks, mission) for task in ready_tasks)
                        )

            await asyncio.sleep(8)

    async def _reconcile_running_tasks(self, mission_id: str, org_id: str) -> None:
        async with AsyncSessionLocal() as db:
            running_tasks = (
                await db.execute(
                    select(MissionTask)
                    .where(
                        MissionTask.mission_id == mission_id,
                        MissionTask.org_id == org_id,
                        MissionTask.status == MissionTaskStatus.running,
                        MissionTask.execution_id.is_not(None),
                    )
                )
            ).scalars().all()

            if not running_tasks:
                return

            execution_ids = [task.execution_id for task in running_tasks if task.execution_id]
            executions = (
                await db.execute(
                    select(Execution).where(
                        Execution.id.in_(execution_ids),
                        Execution.org_id == org_id,
                    )
                )
            ).scalars().all()
            execution_map = {execution.id: execution for execution in executions}
            agent_ids = [task.agent_id for task in running_tasks if task.agent_id]
            agents = (
                await db.execute(
                    select(Agent).where(
                        Agent.id.in_(agent_ids),
                        Agent.org_id == org_id,
                    )
                )
            ).scalars().all() if agent_ids else []
            agent_map = {agent.id: agent for agent in agents}
            mission = await db.scalar(select(Mission).where(Mission.id == mission_id))
            changed = False

            for task in running_tasks:
                execution = execution_map.get(task.execution_id)
                if not execution or execution.status not in {
                    ExecutionStatus.completed,
                    ExecutionStatus.failed,
                    ExecutionStatus.cancelled,
                    ExecutionStatus.timed_out,
                }:
                    continue

                output_summary = await self._extract_output_summary(execution, db)
                task_failed_for_capability = (
                    execution.status == ExecutionStatus.completed
                    and self._looks_like_capability_mismatch(output_summary, agent_map.get(task.agent_id))
                )
                task.status = (
                    MissionTaskStatus.failed
                    if task_failed_for_capability
                    else MissionTaskStatus.completed
                    if execution.status == ExecutionStatus.completed
                    else MissionTaskStatus.failed
                )
                task.output_summary = output_summary
                task.completed_at = execution.completed_at or datetime.utcnow()
                changed = True

            if mission and mission.status == MissionStatus.paused and changed:
                mission.status = MissionStatus.active

            if changed:
                await db.commit()

    async def _mark_task_skipped(self, task_id: str, reason: str) -> None:
        async with AsyncSessionLocal() as db:
            task = await db.scalar(select(MissionTask).where(MissionTask.id == task_id))
            if task and task.status == MissionTaskStatus.pending:
                task.status = MissionTaskStatus.skipped
                task.output_summary = reason[:1200]
                task.completed_at = datetime.utcnow()
                await db.commit()

    async def _find_or_create_workflow_for_agent(
        self,
        *,
        agent: Agent,
        mission: Mission,
        db: AsyncSession,
    ) -> Workflow:
        workflows = (
            await db.execute(
                select(Workflow)
                .where(Workflow.org_id == mission.org_id)
                .where(Workflow.status != "deleted")
                .order_by(Workflow.created_at.desc())
            )
        ).scalars().all()

        for workflow in workflows:
            for node in (workflow.nodes or []):
                data = node.get("data", {}) or {}
                if data.get("agent_id") == agent.id:
                    return workflow

        workflow = Workflow(
            id=str(uuid4()),
            org_id=mission.org_id,
            name=f"{agent.persona_name or agent.name} Mission Workflow",
            description=f"Auto-generated single-agent workflow for mission task execution.",
            nodes=[
                {
                    "id": "mission_agent_node_1",
                    "type": "agentNode",
                    "position": {"x": 180, "y": 180},
                    "data": {
                        "agent_id": agent.id,
                        "label": agent.persona_name or agent.name,
                        "role": agent.role_slug or agent.role,
                    },
                }
            ],
            edges=[],
            status="draft",
            trigger="manual",
            created_by_user_id=mission.created_by,
            execution_mode="sequential",
        )
        db.add(workflow)
        await db.flush()
        return workflow

    async def _dispatch_task(
        self,
        task: MissionTask,
        all_tasks: list[MissionTask],
        mission: Mission,
    ) -> None:
        context_parts = [f"Goal: {mission.goal}"]
        dep_ids = {dep for dep in (task.depends_on or "").split(",") if dep}
        for dep_id in dep_ids:
            dep_task = next((item for item in all_tasks if item.id == dep_id), None)
            if dep_task and dep_task.output_summary:
                context_parts.append(
                    f"Previous research ({dep_task.title}):\n{dep_task.output_summary[:800]}"
                )

        async with AsyncSessionLocal() as exec_db:
            current_task = await exec_db.scalar(
                select(MissionTask).where(
                    MissionTask.id == task.id,
                    MissionTask.mission_id == mission.id,
                    MissionTask.org_id == mission.org_id,
                )
            )
            current_mission = await exec_db.scalar(select(Mission).where(Mission.id == mission.id))
            if not current_task or current_task.status != MissionTaskStatus.pending or not current_mission:
                return

            if not current_task.agent_id:
                fallback_agent = await exec_db.scalar(
                    select(Agent)
                    .where(
                        Agent.org_id == mission.org_id,
                        Agent.is_active == True,  # noqa: E712
                    )
                    .order_by(Agent.trust_score.desc(), Agent.created_at.asc())
                    .limit(1)
                )

                if fallback_agent:
                    current_task.agent_id = str(fallback_agent.id)
                    await exec_db.commit()
                    task.agent_id = str(fallback_agent.id)
                    logger.info(
                        "Mission task '%s' — no match for '%s', using fallback agent %s",
                        current_task.title,
                        current_task.title,
                        fallback_agent.persona_name or fallback_agent.name,
                    )
                else:
                    await exec_db.rollback()
                    await self._mark_task_skipped(task.id, "No active agents in this agency.")
                    return

            agent = await exec_db.scalar(
                select(Agent).where(
                    Agent.id == current_task.agent_id,
                    Agent.org_id == mission.org_id,
                    Agent.is_active == True,  # noqa: E712
                )
            )
            if not agent:
                current_task.status = MissionTaskStatus.skipped
                current_task.output_summary = "Assigned agent not found or inactive."
                current_task.completed_at = datetime.utcnow()
                await exec_db.commit()
                return

            available_tools = ", ".join(agent.tools or []) or "none"
            tool_guidance = (
                f"Available tools for you: {available_tools}.\n"
                "If a search or browsing tool is listed, you should use it when the task requires research.\n"
                "Do not claim that web access or browsing is unavailable if the tool list includes web_search, web_scrape, news_search, or firecrawl tools."
            )
            enriched_prompt = (
                "\n\n---\n".join(context_parts)
                + f"\n\n---\n{tool_guidance}"
                + f"\n\n---\nYour task: {task.description or task.title}"
            )

            workflow = await self._find_or_create_workflow_for_agent(agent=agent, mission=current_mission, db=exec_db)
            execution = Execution(
                id=str(uuid4()),
                org_id=mission.org_id,
                workflow_id=workflow.id,
                client_id=mission.client_id,
                trigger="mission",
                status=ExecutionStatus.pending,
                input_message=enriched_prompt,
                started_at=datetime.utcnow(),
            )
            exec_db.add(execution)

            current_task.status = MissionTaskStatus.running
            current_task.execution_id = execution.id
            current_task.started_at = datetime.utcnow()
            if current_mission.status == MissionStatus.paused:
                current_mission.status = MissionStatus.active
            await exec_db.commit()

        try:
            await enqueue_workflow_execution(
                execution.id,
                workflow.id,
                enriched_prompt,
                mission.created_by,
                mission.org_id,
            )
        except Exception as exc:
            logger.exception("Mission task dispatch failed for %s: %s", task.id, exc)
            async with AsyncSessionLocal() as fail_db:
                failed_execution = await fail_db.scalar(select(Execution).where(Execution.id == execution.id))
                failed_task = await fail_db.scalar(select(MissionTask).where(MissionTask.id == task.id))
                if failed_execution:
                    failed_execution.status = ExecutionStatus.failed
                    failed_execution.error = str(exc)[:1000]
                    failed_execution.completed_at = datetime.utcnow()
                if failed_task:
                    failed_task.status = MissionTaskStatus.failed
                    failed_task.output_summary = str(exc)[:1200]
                    failed_task.completed_at = datetime.utcnow()
                await fail_db.commit()
            return

        asyncio.create_task(
            self._monitor_task_completion(task.id, execution.id, mission.id)
        )

        await ws_manager.broadcast_to_channel(
            f"org:{mission.org_id}",
            {
                "event": "mission_task_started",
                "mission_id": mission.id,
                "task_id": task.id,
                "task_title": task.title,
                "agent_name": agent.persona_name or agent.name,
            },
        )

    async def _monitor_task_completion(
        self,
        task_id: str,
        execution_id: str,
        mission_id: str,
    ) -> None:
        timeout_seconds = 3600
        started = asyncio.get_event_loop().time()

        while asyncio.get_event_loop().time() - started < timeout_seconds:
            async with AsyncSessionLocal() as db:
                execution = await db.scalar(select(Execution).where(Execution.id == execution_id))
                mission = await db.scalar(select(Mission).where(Mission.id == mission_id))
                if not execution or not mission:
                    return

                if execution.status == ExecutionStatus.waiting_approval and mission.status != MissionStatus.paused:
                    mission.status = MissionStatus.paused
                    await db.commit()

                if execution.status in {
                    ExecutionStatus.completed,
                    ExecutionStatus.failed,
                    ExecutionStatus.cancelled,
                    ExecutionStatus.timed_out,
                }:
                    output_summary = await self._extract_output_summary(execution, db)
                    task = await db.scalar(select(MissionTask).where(MissionTask.id == task_id))
                    if task:
                        task.status = (
                            MissionTaskStatus.completed
                            if execution.status == ExecutionStatus.completed
                            else MissionTaskStatus.failed
                        )
                        task.output_summary = output_summary
                        task.completed_at = datetime.utcnow()
                    if mission.status == MissionStatus.paused:
                        mission.status = MissionStatus.active
                    await db.commit()

                    await ws_manager.broadcast_to_channel(
                        f"org:{execution.org_id}",
                        {
                            "event": "mission_task_completed",
                            "mission_id": mission_id,
                            "task_id": task_id,
                            "status": execution.status.value,
                        },
                    )
                    return

            await asyncio.sleep(5)

        async with AsyncSessionLocal() as db:
            task = await db.scalar(select(MissionTask).where(MissionTask.id == task_id))
            if task and task.status == MissionTaskStatus.running:
                task.status = MissionTaskStatus.failed
                task.output_summary = "Task timed out while waiting for execution completion."
                task.completed_at = datetime.utcnow()
                await db.commit()

    async def _extract_output_summary(
        self,
        execution: Execution,
        db: AsyncSession,
    ) -> str | None:
        if execution.output_message:
            return str(execution.output_message)[:1200]

        last_step = await db.scalar(
            select(ExecutionStep)
            .where(
                ExecutionStep.execution_id == execution.id,
                ExecutionStep.step_type == "final_answer",
            )
            .order_by(ExecutionStep.created_at.desc())
            .limit(1)
        )
        if last_step:
            return str(last_step.content)[:1200]
        return None

    async def _finalize_mission(
        self,
        mission_id: str,
        tasks: list[MissionTask],
    ) -> None:
        completed_tasks = [task for task in tasks if task.status == MissionTaskStatus.completed]
        failed_tasks = [task for task in tasks if task.status == MissionTaskStatus.failed]

        async with AsyncSessionLocal() as db:
            mission = await db.scalar(select(Mission).where(Mission.id == mission_id))
            if not mission:
                return

            if not completed_tasks:
                mission.status = MissionStatus.failed
                mission.completed_at = datetime.utcnow()
                await db.commit()
                return

            report = await self._generate_report(mission, completed_tasks)
            mission.report = report
            mission.completed_at = datetime.utcnow()
            mission.status = MissionStatus.failed if failed_tasks else MissionStatus.completed

            await db.commit()

        await ws_manager.broadcast_to_channel(
            f"org:{tasks[0].org_id if tasks else ''}",
            {
                "event": "mission_completed",
                "mission_id": mission_id,
                "title": mission.title if 'mission' in locals() and mission else "",
                "tasks_completed": len(completed_tasks),
                "report_preview": (report or "")[:200] if 'report' in locals() else "",
            },
        )

    async def _generate_report(
        self,
        mission: Mission,
        completed_tasks: list[MissionTask],
    ) -> str:
        try:
            llm = model_service._build_from_settings(temperature=0.4, max_tokens=1500)
            task_summaries = "\n\n".join(
                f"Task: {task.title}\n{task.output_summary or 'No output'}"
                for task in completed_tasks
            )
            prompt = (
                "Create a professional report for this completed mission.\n\n"
                f"Original goal: {mission.goal}\n\n"
                f"Completed tasks and outputs:\n{task_summaries}\n\n"
                "Write a clear, professional report (400-600 words) that:\n"
                "- Summarizes what was accomplished\n"
                "- Presents key findings and insights\n"
                "- Includes concrete recommendations\n"
                "- Is written for a non-technical client\n"
                "- Uses markdown headers for structure"
            )
            response = await llm.ainvoke(prompt)
            content = getattr(response, "content", response)
            if not isinstance(content, str):
                content = str(content)
            return content.strip()
        except Exception as exc:
            logger.warning("Report generation failed: %s", exc)
            return "\n\n".join(
                f"## {task.title}\n{task.output_summary or 'Task completed'}"
                for task in completed_tasks
            )


mission_orchestrator = MissionOrchestrator()

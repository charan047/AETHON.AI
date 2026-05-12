from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from typing import TypedDict, Annotated
import json
import re
import logging
from datetime import datetime
from uuid import uuid4
from sqlalchemy import select

from runtime.agent_runner import AgentRunner, build_llm, _extract_text
from runtime.condition_evaluator import ConditionEvaluator
from runtime.parallel_executor import ParallelExecutor
from config import settings
from database.db import AsyncSessionLocal
from database.models import Execution, ExecutionStatus, ExecutionStep
from services.hitl_service import HITLService

logger = logging.getLogger(__name__)


class WorkflowState(TypedDict):
    messages: Annotated[list, add_messages]
    execution_id: str
    current_node: str
    agent_outputs: dict


class WorkflowExecutionStopped(Exception):
    def __init__(self, status: str, output: str):
        self.status = status
        self.output = output
        super().__init__(output)


class WorkflowExecutor:
    def __init__(
        self,
        workflow,
        agents_map: dict,
        ws_manager=None,
        user_id: str | None = None,
        custom_tool_defs=None,
        memory_service=None,
        memory_configs=None,
        hitl_service=None,
    ):
        self.workflow = workflow
        self.agents_map = agents_map
        self.ws_manager = ws_manager
        self.user_id = user_id
        self._custom_tool_defs = custom_tool_defs or []
        self.memory_service = memory_service
        self.memory_configs = memory_configs or {}
        self.hitl_service = hitl_service or HITLService()
        self._runners: dict[str, AgentRunner] = {}

    @staticmethod
    def _is_standup_execution(input_message: str) -> bool:
        normalized = (input_message or "").upper()
        return "MORNING STANDUP" in normalized or "DAILY TEAM STANDUP" in normalized

    def _build_agent_task(
        self,
        *,
        input_message: str,
        previous_output: str,
        agent_outputs: dict[str, str],
        agent_name: str,
    ) -> str:
        if self._is_standup_execution(input_message):
            if agent_outputs:
                prior_updates = "\n\n".join(
                    f"**{name}**: {output}" for name, output in agent_outputs.items()
                )
                previous_speaker = list(agent_outputs.keys())[-1]
                return (
                    f"{input_message}\n\n"
                    f"--- Standup so far ---\n"
                    f"{prior_updates}\n\n"
                    f"--- Your turn ---\n"
                    f"You are {agent_name}. Give your update now. "
                    f"If relevant, briefly acknowledge or respond to what {previous_speaker} "
                    f"said before giving your own update."
                )
            return (
                f"{input_message}\n\n"
                f"You are {agent_name}. You're going first in the standup. Give your update."
            )

        if agent_outputs:
            context = "\n\n".join(
                f"[{name} output]:\n{output}" for name, output in agent_outputs.items()
            )
            return f"Previous agent outputs:\n{context}\n\nOriginal task: {input_message}"
        return previous_output

    async def _broadcast_agent_spoke(
        self,
        *,
        execution_id: str,
        agent_name: str,
        agent_id: str,
        message: str,
        ordering_hint: int,
    ) -> None:
        if not self.ws_manager:
            return
        logger.info(
            "broadcast_to_channel execution:%s agent_spoke %s",
            execution_id,
            agent_name,
        )
        await self.ws_manager.broadcast_to_channel(
            f"execution:{execution_id}",
            {
                "event": "agent_spoke",
                "execution_id": execution_id,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "message": message,
                "step_index": ordering_hint,
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

    async def _save_standup_summary(
        self,
        *,
        execution_id: str,
        input_message: str,
        agent_outputs: dict[str, str],
    ) -> str:
        updates_text = "\n\n".join(
            f"{name}: {output}" for name, output in agent_outputs.items()
        )
        timestamp = datetime.utcnow()
        human_timestamp = timestamp.strftime("%Y-%m-%d %H:%M UTC")
        summary_prompt = (
            "You are the chief of staff summarizing a live standup for the CEO.\n\n"
            f"Standup task:\n{input_message}\n\n"
            f"Agent updates:\n{updates_text}\n\n"
            "Write a concise standup summary with:\n"
            "1. What got done\n"
            "2. What is happening today\n"
            "3. Blockers or asks for the CEO\n\n"
            "Keep it under 180 words and make it sound like an executive recap, not raw notes."
        )
        summary_llm = build_llm(settings.default_model, temperature=0.2, max_tokens=500)
        try:
            summary_response = await summary_llm.ainvoke([HumanMessage(content=summary_prompt)])
            summary_body = _extract_text(summary_response.content).strip()
        except Exception as exc:
            logger.warning("Standup summary synthesis failed for execution %s: %s", execution_id, exc)
            summary_body = (
                "Standup recap:\n"
                + "\n".join(f"- {name}: {output[:160]}" for name, output in agent_outputs.items())
            )

        summary_content = f"Standup summary • {human_timestamp}\n\n{summary_body}"

        async with AsyncSessionLocal() as db:
            execution = await db.scalar(select(Execution).where(Execution.id == execution_id))
            if not execution:
                return summary_content

            existing_steps = execution.steps or []
            next_step_index = max((step.step_index for step in existing_steps), default=-1) + 1
            step = ExecutionStep(
                id=str(uuid4()),
                execution_id=execution_id,
                org_id=execution.org_id,
                step_type="update",
                content=summary_content,
                step_index=next_step_index,
                created_at=timestamp,
            )
            db.add(step)
            await db.commit()

            if self.ws_manager:
                await self.ws_manager.broadcast_to_channel(
                    f"execution:{execution_id}",
                    {
                        "event": "execution_step",
                        "execution_id": execution_id,
                        "step": {
                            "id": step.id,
                            "step_type": "update",
                            "content": summary_content,
                            "tool_name": None,
                            "tool_input": None,
                            "tool_output": None,
                            "tool_success": True,
                            "step_index": next_step_index,
                            "duration_ms": None,
                            "tokens_used": None,
                            "timestamp": timestamp.isoformat(),
                            "agent_id": None,
                            "agent_name": "Standup Summary",
                        },
                    },
                )

        return summary_content

    def _get_runner(self, agent_id: str) -> AgentRunner:
        if agent_id not in self._runners:
            self._runners[agent_id] = AgentRunner(
                self.agents_map[agent_id],
                self._custom_tool_defs,
                memory_service=self.memory_service,
                memory_config=self.memory_configs.get(agent_id),
            )
        return self._runners[agent_id]

    async def _broadcast_org_event(self, message: dict) -> None:
        if not self.ws_manager:
            return
        await self.ws_manager.broadcast_to_channel(
            f"org:{self.workflow.org_id}",
            message,
        )

    @staticmethod
    def _is_hitl_node(node: dict) -> bool:
        data = node.get("data", {}) or {}
        node_config = node.get("config", {}) or {}
        data_config = data.get("config", {}) or {}
        return node.get("type") == "approval" or bool(
            node.get("hitl_enabled")
            or node_config.get("hitl_enabled")
            or data.get("hitl_enabled")
            or data_config.get("hitl_enabled")
        )

    def _is_executable_node(self, node: dict) -> bool:
        if node.get("type") == "condition":
            return True
        if node.get("type") == "parallel_group":
            return True
        if self._is_hitl_node(node):
            return True
        return node.get("data", {}).get("agent_id") in self.agents_map

    @staticmethod
    def _parallel_agent_ids(node: dict) -> list[str]:
        data = node.get("data", {}) or {}
        agent_ids = data.get("agent_ids") or node.get("agent_ids") or []
        return [agent_id for agent_id in agent_ids if agent_id]

    def _node_by_id(self) -> dict[str, dict]:
        return {node["id"]: node for node in self.workflow.nodes or []}

    def _edge_map(self) -> dict[str, str]:
        return {edge["source"]: edge["target"] for edge in self.workflow.edges or []}

    def _first_node(self) -> dict | None:
        nodes = self.workflow.nodes or []
        if not nodes:
            return None
        node_by_id = {node["id"]: node for node in nodes}
        targets = {edge["target"] for edge in self.workflow.edges or []}
        for node in nodes:
            if self._is_executable_node(node) and node["id"] not in targets:
                return node
        for node in nodes:
            if self._is_executable_node(node):
                return node
        return None

    def _ordered_nodes(self) -> list[dict]:
        nodes = self.workflow.nodes or []
        edges = self.workflow.edges or []
        if not nodes:
            return []

        node_by_id = {node["id"]: node for node in nodes}
        edge_map = {edge["source"]: edge["target"] for edge in edges}
        executable_ids = {node["id"] for node in nodes if self._is_executable_node(node)}
        targets = set(edge_map.values())
        start_candidates = [node["id"] for node in nodes if node["id"] in executable_ids and node["id"] not in targets]
        start_node = start_candidates[0] if start_candidates else next(iter(executable_ids), None)

        ordered = []
        seen = set()
        current = start_node
        while current and current not in seen:
            if current in executable_ids:
                ordered.append(node_by_id[current])
            seen.add(current)
            current = edge_map.get(current)

        for node in nodes:
            if node["id"] in executable_ids and node["id"] not in seen:
                ordered.append(node)
        return ordered

    async def _update_execution_status(
        self,
        execution_id: str,
        status: str,
        output_message: str | None = None,
        completed: bool = False,
    ) -> None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Execution).where(Execution.id == execution_id))
            execution = result.scalar_one_or_none()
            if not execution:
                return
            execution.status = status
            if output_message is not None:
                execution.output_message = output_message
            if completed:
                execution.completed_at = datetime.utcnow()
            await db.commit()

    async def _handle_hitl_node(
        self,
        node: dict,
        execution_id: str,
        previous_output: str,
        agent_outputs: dict[str, str],
    ) -> None:
        data = node.get("data", {}) or {}
        hitl_config = {
            **(node.get("config") or {}),
            **(node.get("hitl_config") or {}),
            **(data.get("config") or {}),
            **(data.get("hitl_config") or {}),
        }
        title = data.get("title") or hitl_config.get("title") or "Review required before continuing"
        description = data.get("description") or hitl_config.get("description") or ""
        timeout_hours = data.get("timeout_hours") or hitl_config.get("timeout_hours")
        context_data = {
            "previous_output": previous_output,
            "agent_outputs": agent_outputs,
        }

        approval = await self.hitl_service.create_approval_request(
            workflow_id=self.workflow.id,
            execution_id=execution_id,
            node_id=node["id"],
            title=title,
            description=description,
            context_data=context_data,
            agent_id=data.get("agent_id") or hitl_config.get("agent_id"),
            timeout_hours=timeout_hours,
        )

        if self.ws_manager:
            await self._broadcast_org_event(
                {
                    "type": "workflow_paused",
                    "execution_id": execution_id,
                    "approval_id": approval.id,
                    "node_id": node["id"],
                }
            )
        await self._update_execution_status(execution_id, ExecutionStatus.waiting_approval.value)

        timeout_seconds = int((timeout_hours or settings.hitl_timeout_hours) * 3600)
        decision = await self.hitl_service.wait_for_decision(
            approval_id=approval.id,
            resume_token=approval.resume_token,
            timeout_seconds=timeout_seconds,
        )

        if decision.get("decision") == "approved":
            await self._update_execution_status(execution_id, ExecutionStatus.running.value)
            if self.ws_manager:
                await self._broadcast_org_event(
                    {
                        "type": "workflow_resumed",
                        "execution_id": execution_id,
                        "approval_id": approval.id,
                        "node_id": node["id"],
                    }
                )
            return

        if decision.get("decision") == "rejected":
            reason = decision.get("comment") or "Rejected by reviewer"
            output = f"Workflow rejected: {reason}"
            await self._update_execution_status(
                execution_id,
                ExecutionStatus.rejected.value,
                output_message=output,
                completed=True,
            )
            if self.ws_manager:
                await self._broadcast_org_event(
                    {
                        "type": "workflow_rejected",
                        "execution_id": execution_id,
                        "approval_id": approval.id,
                        "reason": reason,
                    }
                )
            raise WorkflowExecutionStopped(ExecutionStatus.rejected.value, output)

        output = "Workflow timed out waiting for human approval."
        await self._update_execution_status(
            execution_id,
            ExecutionStatus.timed_out.value,
            output_message=output,
            completed=True,
        )
        if self.ws_manager:
            await self._broadcast_org_event(
                {
                    "type": "workflow_timed_out",
                    "execution_id": execution_id,
                    "approval_id": approval.id,
                }
            )
        raise WorkflowExecutionStopped(ExecutionStatus.timed_out.value, output)

    def _build_graph(self):
        nodes = self.workflow.nodes or []
        edges = self.workflow.edges or []

        if not nodes:
            return None, []

        edge_map = {e["source"]: e["target"] for e in edges}

        valid_node_ids = {
            n["id"] for n in nodes
            if n.get("data", {}).get("agent_id") in self.agents_map
        }

        targets = set(edge_map.values())
        start_candidates = [nid for nid in valid_node_ids if nid not in targets]

        if not start_candidates:
            ordered = [n["id"] for n in nodes if n["id"] in valid_node_ids]
            start_node = ordered[0] if ordered else None
        else:
            ordered = [n["id"] for n in nodes if n["id"] in start_candidates]
            start_node = ordered[0]

        if not start_node:
            return None, []

        execution_order = []
        seen = set()
        cur = start_node
        while cur and cur not in seen:
            if cur in valid_node_ids:
                execution_order.append(cur)
            seen.add(cur)
            cur = edge_map.get(cur)

        for n in nodes:
            nid = n["id"]
            if nid in valid_node_ids and nid not in seen:
                execution_order.append(nid)

        if not execution_order:
            return None, []

        plan = []
        for nid in execution_order:
            node_data = next((n for n in nodes if n["id"] == nid), {})
            agent_id = node_data.get("data", {}).get("agent_id")
            agent_name = self.agents_map[agent_id].name if agent_id in self.agents_map else "?"
            plan.append({"node_id": nid, "agent": agent_name})

        logger.info(f"Workflow plan: {[p['agent'] for p in plan]}")

        graph = StateGraph(WorkflowState)

        for nid in execution_order:
            node_data = next(n for n in nodes if n["id"] == nid)
            agent_id = node_data.get("data", {}).get("agent_id")
            runner = self._get_runner(agent_id)
            agent_name = self.agents_map[agent_id].name

            def make_node_fn(r, name, node_id):
                async def node_fn(state: WorkflowState):
                    prev_outputs = state.get("agent_outputs", {})
                    last_message = state["messages"][-1].content if state["messages"] else ""
                    last_message = _extract_text(last_message)
                    task = self._build_agent_task(
                        input_message=last_message,
                        previous_output=last_message,
                        agent_outputs=prev_outputs,
                        agent_name=name,
                    )

                    execution_id = state.get("execution_id", "")

                    async def broadcast(event):
                        if self.ws_manager:
                            await self._broadcast_org_event(
                                {
                                    **event,
                                    "execution_id": execution_id,
                                    "node_id": node_id,
                                }
                            )

                    response, tokens = await r.run(
                        task,
                        user_id=self.user_id,
                        thread_id=f"{execution_id}-{node_id}",
                        broadcast=broadcast,
                        workflow_id=self.workflow.id,
                        execution_id=execution_id,
                        org_id=self.workflow.org_id,
                    )

                    if self.ws_manager:
                        await self._broadcast_org_event(
                            {
                                "type": "agent_done",
                                "agent": name,
                                "node_id": node_id,
                                "response": response[:500],
                                "tokens": tokens,
                                "execution_id": execution_id,
                            }
                        )
                        await self._broadcast_agent_spoke(
                            execution_id=execution_id,
                            agent_name=name,
                            agent_id=r.config.id,
                            message=response,
                            ordering_hint=tokens,
                        )

                    return {
                        "messages": [AIMessage(content=response, name=name)],
                        "current_node": node_id,
                        "agent_outputs": {**prev_outputs, name: response},
                    }
                return node_fn

            graph.add_node(nid, make_node_fn(runner, agent_name, nid))

        graph.add_edge(START, execution_order[0])
        for i in range(len(execution_order) - 1):
            graph.add_edge(execution_order[i], execution_order[i + 1])
        graph.add_edge(execution_order[-1], END)

        return graph.compile(), plan

    async def _run_orchestrator(self, input_message: str, execution_id: str) -> tuple[str, int]:
        """Plan-execute-synthesize orchestration.

        Step 1 — LLM produces a plain-text execution plan (agent names in order).
        Step 2 — Run each chosen agent via AgentRunner (same as sequential, but order is LLM-driven).
        Step 3 — LLM synthesizes all agent outputs into the final answer.

        This avoids requiring the model to emit valid tool-call JSON, which open-source
        models on Groq frequently fail at when given custom schemas.
        """
        nodes = self.workflow.nodes or []
        valid_agents = []
        for node in nodes:
            agent_id = node.get("data", {}).get("agent_id")
            if agent_id not in self.agents_map:
                continue
            agent = self.agents_map[agent_id]
            valid_agents.append({"node_id": node["id"], "agent_id": agent_id, "agent": agent})

        if not valid_agents:
            return "No valid agents found in this workflow.", 0

        orchestration_prompt = getattr(self.workflow, "orchestration_prompt", "") or ""
        agent_names = [va["agent"].name for va in valid_agents]

        if self.ws_manager:
            await self._broadcast_org_event(
                {
                    "type": "workflow_plan",
                    "execution_id": execution_id,
                    "plan": agent_names,
                    "mode": "orchestrator",
                }
            )

        planner_llm = build_llm(settings.default_model, temperature=0.2, max_tokens=256)
        total_tokens = 0

        # ── Step 1: planning ─────────────────────────────────────────────────────
        agent_list_str = "\n".join(
            f"- {va['agent'].name}: {va['agent'].role}"
            + (f" — {va['agent'].description}" if va['agent'].description else "")
            for va in valid_agents
        )
        plan_prompt = (
            f"{orchestration_prompt or 'You are an AI orchestrator coordinating specialist agents.'}\n\n"
            f"Available agents:\n{agent_list_str}\n\n"
            f"User task: {input_message}\n\n"
            "Reply with ONLY a JSON array of agent names in the order they should run.\n"
            'Example: ["Agent A", "Agent B"]'
        )

        planned_names = agent_names  # default: run all in definition order
        try:
            plan_resp = await planner_llm.ainvoke([HumanMessage(content=plan_prompt)])
            plan_text = _extract_text(plan_resp.content).strip()
            match = re.search(r'\[.*?\]', plan_text, re.DOTALL)
            if match:
                parsed = json.loads(match.group())
                # Only keep names that actually exist
                valid_names = {va["agent"].name for va in valid_agents}
                planned_names = [n for n in parsed if n in valid_names] or agent_names
        except Exception as e:
            logger.warning(f"Orchestrator planning step failed ({e}), running all agents in order")

        # ── Step 2: execute agents in planned order ───────────────────────────────
        agent_outputs: dict[str, str] = {}
        for name in planned_names:
            va = next((v for v in valid_agents if v["agent"].name == name), None)
            if not va:
                continue
            runner = self._get_runner(va["agent_id"])
            node_id = va["node_id"]

            context_parts = [f"User task: {input_message}"]
            if agent_outputs:
                prev = "\n\n".join(f"[{k}]:\n{v}" for k, v in agent_outputs.items())
                context_parts.append(f"Previous agent outputs:\n{prev}")
            task = "\n\n".join(context_parts)

            async def _broadcast(event, _eid=execution_id, _nid=node_id):
                if self.ws_manager:
                    await self._broadcast_org_event(
                        {**event, "execution_id": _eid, "node_id": _nid}
                    )

            response, tokens = await runner.run(
                task,
                user_id=self.user_id,
                thread_id=f"{execution_id}-{node_id}",
                broadcast=_broadcast,
                workflow_id=self.workflow.id,
                execution_id=execution_id,
                org_id=self.workflow.org_id,
            )
            total_tokens += tokens
            agent_outputs[name] = response

            if self.ws_manager:
                await self._broadcast_org_event(
                    {
                        "type": "agent_done",
                        "agent": name,
                        "node_id": node_id,
                        "response": response[:500],
                        "tokens": tokens,
                        "execution_id": execution_id,
                    }
                )

        if not agent_outputs:
            return "No agents completed successfully.", total_tokens

        # Single agent — return directly, no synthesis needed
        if len(agent_outputs) == 1:
            return list(agent_outputs.values())[0], total_tokens

        # ── Step 3: synthesize ────────────────────────────────────────────────────
        synth_llm = build_llm(settings.default_model, temperature=0.5, max_tokens=2000)
        outputs_text = "\n\n".join(f"[{k}]:\n{v}" for k, v in agent_outputs.items())
        synth_human = (
            f"Original task: {input_message}\n\n"
            f"Agent outputs:\n{outputs_text}\n\n"
            "Synthesize the above into a single, comprehensive final answer."
        )
        synth_sys = orchestration_prompt or (
            "You are an AI synthesizer. Combine the agent outputs into a coherent, well-structured final answer."
        )
        try:
            synth_resp = await synth_llm.ainvoke([
                SystemMessage(content=synth_sys),
                HumanMessage(content=synth_human),
            ])
            return _extract_text(synth_resp.content), total_tokens
        except Exception as e:
            logger.error(f"Orchestrator synthesis failed: {e}")
            return outputs_text, total_tokens

    async def execute(self, input_message: str, execution_id: str) -> tuple[str, int]:
        mode = getattr(self.workflow, "execution_mode", "sequential") or "sequential"

        if mode == "orchestrator":
            return await self._run_orchestrator(input_message, execution_id)

        # --- Sequential / dynamically routed pipeline execution ---
        current_node = self._first_node()
        if not current_node:
            return "No valid workflow graph could be built. Make sure all nodes have agents assigned and the workflow is saved.", 0

        node_by_id = self._node_by_id()
        edge_map = self._edge_map()
        condition_evaluator = ConditionEvaluator(ws_broadcaster=self.ws_manager)
        max_cycles = int(getattr(self.workflow, "max_cycles", 10) or 10)
        visit_counts: dict[str, int] = {}

        def get_next_node(current_id: str) -> dict | None:
            next_node_id = edge_map.get(current_id)
            return node_by_id.get(next_node_id) if next_node_id else None

        plan = []
        for node in self.workflow.nodes or []:
            if not self._is_executable_node(node):
                continue
            data = node.get("data", {}) or {}
            if node.get("type") == "condition":
                plan.append(data.get("label") or "Condition")
            elif node.get("type") == "parallel_group":
                plan.append(data.get("label") or "Parallel group")
            elif self._is_hitl_node(node):
                plan.append(data.get("title") or "Human approval")
            else:
                agent_id = data.get("agent_id")
                plan.append(self.agents_map[agent_id].name)

        if self.ws_manager:
            await self._broadcast_org_event(
                {
                    "type": "workflow_plan",
                    "execution_id": execution_id,
                    "plan": plan,
                }
            )

        total_tokens = 0
        previous_output = input_message
        agent_outputs: dict[str, str] = {}
        last_response_content: str | None = None
        identical_response_streak = 0
        max_identical_responses = 3

        while current_node is not None:
            node_id = current_node["id"]
            visit_counts[node_id] = visit_counts.get(node_id, 0) + 1
            if visit_counts[node_id] > max_cycles:
                raise RuntimeError("Workflow cycle limit exceeded")

            if current_node.get("type") == "condition":
                data = {**(current_node.get("data", {}) or {}), "id": node_id}
                target_node_id = await condition_evaluator.evaluate(data, previous_output)
                current_node = node_by_id.get(target_node_id) if target_node_id else get_next_node(node_id)
                continue

            if current_node.get("type") == "parallel_group":
                data = current_node.get("data", {}) or {}
                parallel_agent_ids = self._parallel_agent_ids(current_node)
                if agent_outputs:
                    context = "\n\n".join(f"[{name} output]:\n{output}" for name, output in agent_outputs.items())
                    task = f"Previous agent outputs:\n{context}\n\nOriginal task: {input_message}"
                else:
                    task = previous_output

                parallel_executor = ParallelExecutor(
                    ws_broadcaster=self.ws_manager,
                    custom_tool_defs=self._custom_tool_defs,
                    memory_service=self.memory_service,
                    memory_configs=self.memory_configs,
                    user_id=self.user_id,
                )
                response = await parallel_executor.execute_parallel_group(
                    agent_ids=parallel_agent_ids,
                    input_message=task,
                    thread_id=f"{execution_id}-{node_id}",
                    execution_id=execution_id,
                    workflow_id=self.workflow.id,
                    merge_strategy=data.get("merge_strategy", "concatenate"),
                    merge_separator=data.get("merge_separator", "\n\n---\n\n"),
                )
                total_tokens += parallel_executor.last_token_count
                previous_output = response
                agent_outputs[data.get("label") or node_id] = response

                if self.ws_manager:
                    await self._broadcast_org_event(
                        {
                            "type": "parallel_group_done",
                            "node_id": node_id,
                            "label": data.get("label") or "Parallel group",
                            "response": response[:500],
                            "tokens": parallel_executor.last_token_count,
                            "execution_id": execution_id,
                        }
                    )
                current_node = get_next_node(node_id)
                continue

            if self._is_hitl_node(current_node):
                await self._handle_hitl_node(
                    node=current_node,
                    execution_id=execution_id,
                    previous_output=previous_output,
                    agent_outputs=agent_outputs,
                )
                current_node = get_next_node(node_id)
                continue

            agent_id = current_node.get("data", {}).get("agent_id")
            runner = self._get_runner(agent_id)
            agent_name = self.agents_map[agent_id].name
            task = self._build_agent_task(
                input_message=input_message,
                previous_output=previous_output,
                agent_outputs=agent_outputs,
                agent_name=agent_name,
            )

            async def broadcast(event, _node_id=node_id):
                if self.ws_manager:
                    await self._broadcast_org_event(
                        {
                            **event,
                            "execution_id": execution_id,
                            "node_id": _node_id,
                        }
                    )

            response, tokens = await runner.run(
                task,
                user_id=self.user_id,
                thread_id=f"{execution_id}-{node_id}",
                broadcast=broadcast,
                workflow_id=self.workflow.id,
                execution_id=execution_id,
                org_id=self.workflow.org_id,
            )
            total_tokens += tokens
            previous_output = response
            agent_outputs[agent_name] = response

            if response.strip() == (last_response_content or "").strip():
                identical_response_streak += 1
                if identical_response_streak >= max_identical_responses:
                    raise WorkflowExecutionStopped(
                        status=ExecutionStatus.failed.value,
                        output=(
                            f"Workflow stopped: agent '{agent_name}' produced "
                            f"identical output {max_identical_responses} consecutive times. "
                            "This typically means the agent is stuck or looping. "
                            "Check the agent's system prompt and tools."
                        ),
                    )
            else:
                identical_response_streak = 0
                last_response_content = response

            if self.ws_manager:
                await self._broadcast_org_event(
                    {
                        "type": "agent_done",
                        "agent": agent_name,
                        "node_id": node_id,
                        "response": response[:500],
                        "tokens": tokens,
                        "execution_id": execution_id,
                    }
                )
                await self._broadcast_agent_spoke(
                    execution_id=execution_id,
                    agent_name=agent_name,
                    agent_id=agent_id,
                    message=response,
                    ordering_hint=total_tokens,
                )
            current_node = get_next_node(node_id)

        if self._is_standup_execution(input_message) and len(agent_outputs) >= 2:
            summary_output = await self._save_standup_summary(
                execution_id=execution_id,
                input_message=input_message,
                agent_outputs=agent_outputs,
            )
            return summary_output, total_tokens

        return previous_output, total_tokens

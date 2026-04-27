from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from typing import TypedDict, Annotated
import json
import re
import logging

from runtime.agent_runner import AgentRunner, build_llm, _extract_text
from config import settings

logger = logging.getLogger(__name__)


class WorkflowState(TypedDict):
    messages: Annotated[list, add_messages]
    execution_id: str
    current_node: str
    agent_outputs: dict


class WorkflowExecutor:
    def __init__(self, workflow, agents_map: dict, ws_manager=None, custom_tool_defs=None):
        self.workflow = workflow
        self.agents_map = agents_map
        self.ws_manager = ws_manager
        self._custom_tool_defs = custom_tool_defs or []
        self._runners: dict[str, AgentRunner] = {}

    def _get_runner(self, agent_id: str) -> AgentRunner:
        if agent_id not in self._runners:
            self._runners[agent_id] = AgentRunner(self.agents_map[agent_id], self._custom_tool_defs)
        return self._runners[agent_id]

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

                    if prev_outputs:
                        context = "\n\n".join(
                            f"[{k} output]:\n{v}" for k, v in prev_outputs.items()
                        )
                        task = f"Previous agent outputs:\n{context}\n\nOriginal task: {last_message}"
                    else:
                        task = last_message

                    execution_id = state.get("execution_id", "")

                    async def broadcast(event):
                        if self.ws_manager:
                            await self.ws_manager.broadcast({
                                **event,
                                "execution_id": execution_id,
                                "node_id": node_id,
                            })

                    response, tokens = await r.run(
                        task, thread_id=f"{execution_id}-{node_id}", broadcast=broadcast
                    )

                    if self.ws_manager:
                        await self.ws_manager.broadcast({
                            "type": "agent_done",
                            "agent": name,
                            "node_id": node_id,
                            "response": response[:500],
                            "tokens": tokens,
                            "execution_id": execution_id,
                        })

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
            await self.ws_manager.broadcast({
                "type": "workflow_plan",
                "execution_id": execution_id,
                "plan": agent_names,
                "mode": "orchestrator",
            })

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
                    await self.ws_manager.broadcast({**event, "execution_id": _eid, "node_id": _nid})

            response, tokens = await runner.run(task, thread_id=f"{execution_id}-{node_id}", broadcast=_broadcast)
            total_tokens += tokens
            agent_outputs[name] = response

            if self.ws_manager:
                await self.ws_manager.broadcast({
                    "type": "agent_done",
                    "agent": name,
                    "node_id": node_id,
                    "response": response[:500],
                    "tokens": tokens,
                    "execution_id": execution_id,
                })

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

        # --- Sequential / pipeline execution ---
        graph, plan = self._build_graph()

        if not graph:
            return "No valid workflow graph could be built. Make sure all nodes have agents assigned and the workflow is saved.", 0

        if self.ws_manager:
            await self.ws_manager.broadcast({
                "type": "workflow_plan",
                "execution_id": execution_id,
                "plan": [p["agent"] for p in plan],
            })

        initial_state: WorkflowState = {
            "messages": [HumanMessage(content=input_message)],
            "execution_id": execution_id,
            "current_node": "",
            "agent_outputs": {},
        }

        total_tokens = 0
        final_output = ""

        async for chunk in graph.astream(initial_state, {"recursion_limit": 50}):
            for node_id, node_state in chunk.items():
                if node_id == "__end__":
                    continue
                msgs = node_state.get("messages", [])
                if msgs:
                    last = msgs[-1]
                    if hasattr(last, "content"):
                        final_output = _extract_text(last.content)

        return final_output, total_tokens

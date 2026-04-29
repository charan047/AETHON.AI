import json
import re

from langchain_core.messages import HumanMessage

from config import settings
from runtime.agent_runner import _extract_text, build_llm
from services.websocket_manager import ws_manager


class ConditionEvaluator:
    def __init__(self, ws_broadcaster=None):
        self.ws_manager = ws_broadcaster or ws_manager

    async def evaluate(
        self,
        node_data: dict,
        agent_output: str,
    ) -> str:
        matched_condition = None
        target_node_id = node_data.get("default_target_node_id")

        for condition in node_data.get("conditions", []) or []:
            mode = condition.get("mode") or node_data.get("evaluation_mode") or "llm"
            if mode == "llm":
                matched = await self._evaluate_llm(condition, agent_output)
            elif mode == "contains":
                matched = self._evaluate_contains(condition, agent_output)
            elif mode == "regex":
                matched = self._evaluate_regex(condition, agent_output)
            elif mode == "length_gt":
                matched = self._evaluate_length_gt(condition, agent_output)
            elif mode == "json_field":
                matched = self._evaluate_json_field(condition, agent_output)
            else:
                matched = False

            if matched:
                matched_condition = condition.get("id") or condition.get("label")
                target_node_id = condition.get("target_node_id")
                break

        await self.ws_manager.broadcast(
            {
                "type": "condition_evaluated",
                "node_id": node_data.get("id"),
                "matched_condition": matched_condition,
                "target_node_id": target_node_id,
            }
        )
        return target_node_id

    async def _evaluate_llm(self, condition: dict, text: str) -> bool:
        prompt = condition.get("prompt") or "Does this condition match? Answer only YES or NO."
        llm = build_llm(settings.default_model, temperature=0.0, max_tokens=16)
        response = await llm.ainvoke([HumanMessage(content=f"{prompt}\n\nText: {text}")])
        return _extract_text(response.content).strip().upper().startswith("YES")

    def _evaluate_contains(self, condition: dict, text: str) -> bool:
        value = condition.get("value")
        return bool(value is not None and str(value).lower() in text.lower())

    def _evaluate_regex(self, condition: dict, text: str) -> bool:
        pattern = condition.get("pattern")
        if not pattern:
            return False
        return bool(re.search(pattern, text, re.IGNORECASE))

    def _evaluate_length_gt(self, condition: dict, text: str) -> bool:
        try:
            return len(text) > int(condition.get("value", 0))
        except (TypeError, ValueError):
            return False

    def _evaluate_json_field(self, condition: dict, text: str) -> bool:
        try:
            value = json.loads(text)
            for part in (condition.get("field") or "").split("."):
                if not part:
                    continue
                if isinstance(value, dict):
                    value = value[part]
                elif isinstance(value, list):
                    value = value[int(part)]
                else:
                    return False

            if "equals" in condition:
                return value == condition["equals"]
            if "contains" in condition:
                return str(condition["contains"]).lower() in str(value).lower()
            return bool(value)
        except (ValueError, KeyError, IndexError, TypeError):
            return False

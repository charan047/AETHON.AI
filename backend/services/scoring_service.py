import asyncio
import json
import math
import re
import textwrap
from typing import Any

from langchain_core.messages import HumanMessage

from config import settings
from database.models import EvalCase, ScoringMethod
from runtime.agent_runner import _extract_text, build_llm


class ScoringService:
    """Scores eval case outputs using deterministic, model-based, and custom methods."""

    def __init__(self):
        self._embedding_model = None

    async def score(
        self,
        case: EvalCase,
        actual_output: str,
    ) -> tuple[float, dict]:
        method = case.scoring_method
        if hasattr(method, "value"):
            method = method.value
        config = self._parse_config(case.scoring_config)
        actual = actual_output or ""
        expected = case.expected_output or ""

        if method == ScoringMethod.exact_match.value:
            return self._score_exact_match(expected, actual)
        if method == ScoringMethod.contains.value:
            return self._score_contains(config, actual, expected)
        if method == ScoringMethod.regex.value:
            return self._score_regex(config, actual)
        if method == ScoringMethod.llm_judge.value:
            return await self._score_llm_judge(case, actual)
        if method == ScoringMethod.rouge_l.value:
            return self._score_rouge_l(expected, actual)
        if method == ScoringMethod.semantic_similarity.value:
            return await self._score_semantic_similarity(expected, actual)
        if method == ScoringMethod.json_schema.value:
            return self._score_json_schema(config, actual)
        if method == ScoringMethod.custom_function.value:
            return await self._score_custom_function(config, case, actual)

        return 0.0, {"error": f"Unsupported scoring method: {method}"}

    def _parse_config(self, raw: str | None) -> dict:
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {"_parse_error": "scoring_config is not valid JSON"}
        return parsed if isinstance(parsed, dict) else {"value": parsed}

    def _clamp_score(self, value: Any) -> float:
        try:
            score = float(value)
        except (TypeError, ValueError):
            return 0.0
        if math.isnan(score) or math.isinf(score):
            return 0.0
        return max(0.0, min(1.0, score))

    def _score_exact_match(self, expected: str, actual: str) -> tuple[float, dict]:
        expected_normalized = (expected or "").strip().lower()
        actual_normalized = (actual or "").strip().lower()
        match = expected_normalized == actual_normalized
        return (1.0 if match else 0.0), {
            "match": match,
            "expected_normalized": expected_normalized,
            "actual_normalized": actual_normalized,
        }

    def _score_contains(self, config: dict, actual: str, expected: str = "") -> tuple[float, dict]:
        strings = config.get("strings") or []
        if not strings and expected:
            strings = [expected]
        if isinstance(strings, str):
            strings = [strings]
        strings = [str(item) for item in strings if str(item)]
        mode = str(config.get("mode") or "all").lower()

        if not strings:
            return 0.0, {"error": "No strings configured", "found": [], "missing": []}

        actual_lower = (actual or "").lower()
        found = [item for item in strings if item.lower() in actual_lower]
        missing = [item for item in strings if item not in found]

        if mode == "any":
            score = 1.0 if found else 0.0
        elif mode == "all":
            score = 1.0 if not missing else len(found) / len(strings)
        else:
            score = len(found) / len(strings)

        return self._clamp_score(score), {
            "mode": mode,
            "found": found,
            "missing": missing,
            "required": strings,
        }

    def _score_regex(self, config: dict, actual: str) -> tuple[float, dict]:
        pattern = config.get("pattern")
        if not pattern:
            return 0.0, {"error": "No regex pattern configured", "match": None}

        flags = 0
        flag_text = str(config.get("flags") or "")
        if "i" in flag_text.lower():
            flags |= re.IGNORECASE
        if "m" in flag_text.lower():
            flags |= re.MULTILINE
        if "s" in flag_text.lower():
            flags |= re.DOTALL

        try:
            match = re.search(str(pattern), actual or "", flags)
        except re.error as exc:
            return 0.0, {"error": f"Invalid regex: {exc}", "match": None}

        return (1.0 if match else 0.0), {
            "pattern": pattern,
            "match": match.group(0) if match else None,
            "groups": match.groupdict() if match else {},
        }

    async def _score_llm_judge(
        self,
        case: EvalCase,
        actual: str,
    ) -> tuple[float, dict]:
        config = self._parse_config(case.scoring_config)
        criteria = config.get("criteria", "accuracy, completeness, clarity, relevance")
        prompt = f"""
You are an expert evaluator. Score this AI response.

TASK GIVEN TO AI:
{case.input}

EXPECTED OUTPUT (reference answer):
{case.expected_output or 'No specific expected output - judge quality'}

ACTUAL AI RESPONSE:
{actual}

EVALUATION CRITERIA:
{criteria}

Respond ONLY with a JSON object:
{{
  "score": 0.0,
  "reasoning": "one sentence explanation",
  "strengths": ["what was good"],
  "weaknesses": ["what was missing or wrong"],
  "verdict": "pass"
}}
"""
        try:
            llm = build_llm(settings.default_model, temperature=0.0, max_tokens=500)
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            raw = _extract_text(response.content).strip()
            details = self._parse_llm_json(raw)
            score = self._clamp_score(details.get("score"))
            details.setdefault("raw_response", raw)
            details.setdefault("criteria", criteria)
            return score, details
        except Exception as exc:
            return 0.0, {
                "error": f"LLM judge failed: {exc}",
                "criteria": criteria,
                "verdict": "fail",
            }

    def _parse_llm_json(self, raw: str) -> dict:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", raw)
            if not match:
                return {"score": 0.0, "reasoning": "Judge did not return JSON", "raw_response": raw}
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return {"score": 0.0, "reasoning": "Judge returned invalid JSON", "raw_response": raw}
        return parsed if isinstance(parsed, dict) else {"score": 0.0, "raw_response": raw}

    def _score_rouge_l(
        self,
        expected: str,
        actual: str,
    ) -> tuple[float, dict]:
        if not expected:
            return 0.0, {"error": "ROUGE-L requires expected_output"}
        try:
            from rouge_score import rouge_scorer

            scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
            score = scorer.score(expected, actual or "")["rougeL"]
            return self._clamp_score(score.fmeasure), {
                "precision": score.precision,
                "recall": score.recall,
                "fmeasure": score.fmeasure,
            }
        except Exception as exc:
            return 0.0, {"error": f"ROUGE-L scoring failed: {exc}"}

    async def _score_semantic_similarity(
        self,
        expected: str,
        actual: str,
    ) -> tuple[float, dict]:
        if not expected:
            return 0.0, {"error": "Semantic similarity requires expected_output"}

        try:
            import numpy as np

            model = await self._get_embedding_model()
            expected_embedding, actual_embedding = await asyncio.to_thread(
                lambda: model.encode([expected, actual or ""], convert_to_numpy=True)
            )
            denominator = float(np.linalg.norm(expected_embedding) * np.linalg.norm(actual_embedding))
            similarity = 0.0 if denominator == 0 else float(np.dot(expected_embedding, actual_embedding) / denominator)
            score = (similarity + 1.0) / 2.0
            return self._clamp_score(score), {"cosine_similarity": similarity, "normalized_score": score}
        except Exception as exc:
            return 0.0, {"error": f"Semantic similarity scoring failed: {exc}"}

    async def _get_embedding_model(self):
        if self._embedding_model is None:
            from sentence_transformers import SentenceTransformer

            self._embedding_model = await asyncio.to_thread(
                SentenceTransformer,
                settings.embedding_model,
            )
        return self._embedding_model

    def _score_json_schema(
        self,
        config: dict,
        actual: str,
    ) -> tuple[float, dict]:
        schema = config.get("schema")
        if not schema:
            return 0.0, {"error": "No JSON schema configured"}

        try:
            parsed = json.loads(actual)
        except json.JSONDecodeError as exc:
            return 0.0, {"valid": False, "error": f"Actual output is not valid JSON: {exc}"}

        try:
            import jsonschema

            jsonschema.validate(instance=parsed, schema=schema)
            return 1.0, {"valid": True, "parsed": parsed}
        except ImportError:
            return self._basic_json_schema_score(schema, parsed)
        except Exception as exc:
            return 0.0, {"valid": False, "error": str(exc), "parsed": parsed}

    def _basic_json_schema_score(self, schema: dict, parsed: Any) -> tuple[float, dict]:
        """Minimal fallback validator when jsonschema is unavailable."""
        expected_type = schema.get("type")
        if expected_type == "object" and not isinstance(parsed, dict):
            return 0.0, {"valid": False, "error": "Expected JSON object", "parsed": parsed}
        if expected_type == "array" and not isinstance(parsed, list):
            return 0.0, {"valid": False, "error": "Expected JSON array", "parsed": parsed}
        required = schema.get("required") or []
        missing = [field for field in required if not isinstance(parsed, dict) or field not in parsed]
        if missing:
            return 0.0, {"valid": False, "missing_required": missing, "parsed": parsed}
        return 1.0, {"valid": True, "warning": "Validated with basic fallback only", "parsed": parsed}

    async def _score_custom_function(
        self,
        config: dict,
        case: EvalCase,
        actual: str,
    ) -> tuple[float, dict]:
        code = config.get("code")
        if not code:
            return 0.0, {"error": "No custom scoring code configured"}

        payload = {
            "input": case.input,
            "expected": case.expected_output,
            "actual": actual,
        }
        runner_code = f"""
import json

{code}

payload = {json.dumps(payload)}
result = score(payload["input"], payload["expected"], payload["actual"])
if isinstance(result, tuple):
    score_value, details = result
else:
    score_value, details = result, {{}}
print(json.dumps({{"score": score_value, "details": details}}, default=str))
"""
        try:
            output = await self._run_custom_code_in_docker(runner_code, timeout=10)
            parsed = json.loads(output.strip().splitlines()[-1])
            details = parsed.get("details") if isinstance(parsed.get("details"), dict) else {"details": parsed.get("details")}
            return self._clamp_score(parsed.get("score")), details
        except Exception as exc:
            return 0.0, {"error": f"Custom scoring failed: {exc}"}

    async def _run_custom_code_in_docker(self, code: str, timeout: int = 10) -> str:
        import docker

        client = docker.from_env()

        def run_container() -> str:
            output = client.containers.run(
                image=settings.docker_execution_image,
                command=["python", "-c", textwrap.dedent(code)],
                mem_limit="128m",
                cpu_period=100000,
                cpu_quota=50000,
                network_disabled=True,
                remove=True,
                stdout=True,
                stderr=True,
                timeout=timeout,
                read_only=True,
                security_opt=["no-new-privileges"],
                cap_drop=["ALL"],
                tmpfs={"/tmp": "rw,noexec,nosuid,size=16m"},
                environment={
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "PYTHONUNBUFFERED": "1",
                },
            )
            return output.decode("utf-8", errors="replace")

        return await asyncio.wait_for(asyncio.to_thread(run_container), timeout=timeout + 5)

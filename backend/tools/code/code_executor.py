from __future__ import annotations

from tools.base import BaseTool, ToolCategory, ToolOutput


class CodeExecutorRegistryTool(BaseTool):
    name = "code_execution"
    display_name = "Code Execution"
    description = "Execute Python code in an isolated environment."
    category = ToolCategory.code_execution

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        code = str(input_data.get("code", "")).strip()
        timeout_seconds = max(1, min(int(input_data.get("timeout_seconds", 30) or 30), 30))
        if not code:
            return ToolOutput(success=False, error="Code is required")

        from tools.implementations.code_executor import CodeExecutorTool

        executor = CodeExecutorTool(user_id=user_id, config=self.config)
        result = await executor._execute_code(code, timeout_seconds)
        return ToolOutput(
            success=True,
            result=result,
            metadata={"timeout_seconds": timeout_seconds},
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python code to execute"},
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Execution timeout in seconds",
                    "default": 30,
                },
            },
            "required": ["code"],
        }


def register_tool(registry) -> None:
    registry.register(CodeExecutorRegistryTool())


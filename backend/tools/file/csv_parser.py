from __future__ import annotations

import csv
import io
from pathlib import Path

from tools.base import BaseTool, ToolCategory, ToolOutput


class CsvParserTool(BaseTool):
    name = "csv_parser"
    display_name = "CSV Parser"
    description = "Parse CSV content or a CSV file path into structured rows."
    category = ToolCategory.file

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        csv_content = str(input_data.get("csv_content", "")).strip()
        file_path = str(input_data.get("file_path", "")).strip()
        max_rows = max(1, min(int(input_data.get("max_rows", 100) or 100), 500))

        if not csv_content and not file_path:
            return ToolOutput(success=False, error="Provide either csv_content or file_path")

        if file_path:
            csv_content = Path(file_path).read_text(encoding="utf-8")

        reader = csv.DictReader(io.StringIO(csv_content))
        rows = []
        for index, row in enumerate(reader):
            if index >= max_rows:
                break
            rows.append(row)

        return ToolOutput(
            success=True,
            result=rows,
            metadata={"row_count": len(rows), "headers": reader.fieldnames or []},
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "csv_content": {"type": "string", "description": "Raw CSV text"},
                "file_path": {"type": "string", "description": "Optional local path to a CSV file"},
                "max_rows": {
                    "type": "integer",
                    "description": "Maximum rows to parse",
                    "default": 100,
                },
            },
            "required": [],
        }


def register_tool(registry) -> None:
    registry.register(CsvParserTool())


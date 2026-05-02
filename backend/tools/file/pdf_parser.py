from __future__ import annotations

from pathlib import Path

from tools.base import BaseTool, ToolCategory, ToolOutput


class PdfParserTool(BaseTool):
    name = "pdf_parser"
    display_name = "PDF Parser"
    description = "Extract text from a local PDF file."
    category = ToolCategory.file

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        file_path = str(input_data.get("file_path", "")).strip()
        if not file_path:
            return ToolOutput(success=False, error="file_path is required")

        pdf_path = Path(file_path)
        if not pdf_path.exists():
            return ToolOutput(success=False, error=f"PDF file not found: {file_path}")

        try:
            from PyPDF2 import PdfReader
        except ImportError:  # pragma: no cover
            return ToolOutput(success=False, error="PyPDF2 is not installed")

        reader = PdfReader(str(pdf_path))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")

        return ToolOutput(
            success=True,
            result="\n\n".join(pages).strip(),
            metadata={"page_count": len(reader.pages)},
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Local path to the PDF file"},
            },
            "required": ["file_path"],
        }


def register_tool(registry) -> None:
    registry.register(PdfParserTool())

from langchain_core.tools import tool, Tool, StructuredTool
from pydantic import create_model
from typing import Optional, Any
from datetime import datetime
import importlib
import builtins
import httpx
import ast
import json
from bs4 import BeautifulSoup

from config import settings

# Modules users are allowed to import inside custom tool code
_ALLOWED_IMPORTS = {
    "json", "math", "re", "datetime", "hashlib", "base64",
    "random", "string", "time", "collections", "itertools",
    "functools", "typing", "httpx", "urllib", "html", "textwrap",
}

# Type-string → Python type mapping for function annotations
_TYPE_MAP: dict[str, type] = {
    "str": str, "string": str, "text": str,
    "int": int, "integer": int,
    "float": float, "number": float, "double": float,
    "bool": bool, "boolean": bool,
    "list": list, "List": list, "array": list,
    "dict": dict, "Dict": dict, "object": dict,
}


def _make_safe_importer():
    def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".")[0]
        if root in _ALLOWED_IMPORTS:
            return importlib.__import__(name, globals, locals, fromlist, level)
        raise ImportError(
            f"Import of '{name}' is not allowed in custom tools. "
            f"Allowed: {', '.join(sorted(_ALLOWED_IMPORTS))}"
        )
    return _safe_import


def _build_safe_namespace() -> dict:
    safe = {k: getattr(builtins, k) for k in dir(builtins) if not k.startswith("_")}
    for dangerous in ("eval", "exec", "compile", "open", "breakpoint", "input", "__import__"):
        safe.pop(dangerous, None)
    safe["__import__"] = _make_safe_importer()
    return safe


def _is_dangerous_call(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id in {"__import__", "open", "eval", "exec", "compile", "input", "breakpoint"}
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return (func.value.id, func.attr) in {
            ("os", "system"),
            ("os", "popen"),
            ("subprocess", "run"),
            ("subprocess", "Popen"),
            ("subprocess", "call"),
            ("subprocess", "check_output"),
            ("pathlib", "Path"),
        }
    return False


def validate_custom_tool_code(code: str) -> str | None:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return f"Syntax error in tool code: {exc}"

    has_run_function = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            has_run_function = True
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            module_names = []
            if isinstance(node, ast.Import):
                module_names = [alias.name.split(".")[0] for alias in node.names]
            else:
                if node.module:
                    module_names = [node.module.split(".")[0]]
            for module_name in module_names:
                if module_name not in _ALLOWED_IMPORTS:
                    return (
                        f"Import of '{module_name}' is not allowed in custom tools. "
                        f"Allowed: {', '.join(sorted(_ALLOWED_IMPORTS))}"
                    )
        if isinstance(node, ast.Call) and _is_dangerous_call(node):
            return "Dangerous file system or shell operations are not allowed in custom tools."

    if not has_run_function:
        return "Code must define a callable 'run(...)' function"
    return None


def parse_tool_params(code: str) -> list[dict]:
    """Parse the `run()` function signature from tool code using AST.

    Returns a list of dicts: {name, type, required, default}.
    Falls back to a single `input: str` param if parsing fails.
    """
    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "run":
                args = node.args
                defaults_offset = len(args.args) - len(args.defaults)
                params = []
                for i, arg in enumerate(args.args):
                    type_str = "str"
                    if arg.annotation:
                        try:
                            type_str = ast.unparse(arg.annotation)
                        except Exception:
                            pass

                    required = True
                    default = None
                    di = i - defaults_offset
                    if di >= 0 and di < len(args.defaults):
                        required = False
                        try:
                            default = ast.literal_eval(args.defaults[di])
                        except Exception:
                            default = None

                    params.append({"name": arg.arg, "type": type_str, "required": required, "default": default})
                return params
    except Exception:
        pass
    return [{"name": "input", "type": "str", "required": True, "default": None}]


def execute_custom_tool_code(code: str, **kwargs) -> tuple[str, str | None]:
    """Execute custom tool code in the Docker execution sandbox.

    Returns (output_string, error_string_or_None).
    """
    validation_error = validate_custom_tool_code(code)
    if validation_error:
        return "", validation_error

    try:
        import docker
    except ImportError:
        return "", "Docker SDK is not installed. Run pip install -r requirements.txt."

    invocation = f"""
import json

_tool_kwargs = {json.dumps(kwargs, default=str)}
_tool_result = run(**_tool_kwargs)
if isinstance(_tool_result, str):
    print(_tool_result)
else:
    print(json.dumps(_tool_result, default=str))
"""
    wrapped_code = f"{code}\n\n{invocation}"

    try:
        client = docker.DockerClient(base_url="unix:///var/run/docker.sock")
        try:
            client.images.get(settings.docker_execution_image)
        except Exception:
            return "", (
                f"Docker execution image '{settings.docker_execution_image}' is missing. "
                "Build it with: docker build -t platform-executor:latest -f backend/tools/docker/Dockerfile.execution backend/tools/docker/"
            )

        container = None
        try:
            container = client.containers.run(
                image=settings.docker_execution_image,
                command=["python", "-c", wrapped_code],
                mem_limit="128m",
                cpu_period=100000,
                cpu_quota=50000,
                network_disabled=True,
                detach=True,
                stdout=True,
                stderr=True,
                environment={
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "PYTHONUNBUFFERED": "1",
                },
                security_opt=["no-new-privileges"],
                cap_drop=["ALL"],
                read_only=True,
                tmpfs={"/tmp": "rw,noexec,nosuid,size=32m"},
            )
            result = container.wait(timeout=30)
            output = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")[:10000]
            if result.get("StatusCode", 1) != 0:
                return "", output
            return output, None
        finally:
            if container is not None:
                try:
                    container.remove(force=True)
                except Exception:
                    pass
    except Exception as e:
        return "", str(e)


def execute_custom_tool_code_in_process(code: str, **kwargs) -> tuple[str, str | None]:
    """Legacy in-process executor kept only for local debugging; runtime uses Docker."""
    namespace: dict = {"__builtins__": _build_safe_namespace()}
    try:
        exec(code, namespace)  # noqa: S102
        run_fn = namespace.get("run")
        if not callable(run_fn):
            return "", "Code must define a callable 'run(...)' function"
        result = run_fn(**kwargs)
        return str(result), None
    except Exception as e:
        return "", str(e)


def make_custom_tool(tool_def) -> StructuredTool | Tool:
    """Create a typed LangChain StructuredTool from a CustomTool ORM object.

    Parameters are inferred from the `run()` function signature via AST so the
    LLM sees named, typed fields rather than a single opaque string.
    """
    name = tool_def.name
    description = tool_def.description
    code = tool_def.code

    params = parse_tool_params(code)

    # Build a Pydantic model that matches the function signature
    fields: dict[str, Any] = {}
    for p in params:
        py_type = _TYPE_MAP.get(p["type"], str)
        if p["required"]:
            fields[p["name"]] = (py_type, ...)
        elif p["default"] is not None:
            fields[p["name"]] = (py_type, p["default"])
        else:
            fields[p["name"]] = (Optional[py_type], None)

    if not fields:
        fields["input"] = (str, ...)

    try:
        InputSchema = create_model(f"_{name}_schema", **fields)
    except Exception:
        InputSchema = create_model(f"_{name}_schema", input=(str, ...))

    def runner(**kwargs) -> str:
        output, error = execute_custom_tool_code(code, **kwargs)
        return error if error else output

    try:
        return StructuredTool.from_function(
            func=runner,
            name=name,
            description=description,
            args_schema=InputSchema,
        )
    except Exception as e:
        return Tool(name=name, description=f"[BROKEN] {description}", func=lambda _: f"Tool load error: {e}")


def _search_results_html(query: str, max_results: int = 5) -> list[dict[str, str]]:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; AethonBot/1.0)"}
    with httpx.Client(timeout=20, follow_redirects=True, headers=headers) as client:
        response = client.get("https://www.bing.com/search", params={"q": query})
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    results: list[dict[str, str]] = []
    for container in soup.select("li.b_algo")[:max_results]:
        title_anchor = container.select_one("h2 a")
        snippet_node = container.select_one(".b_caption p")
        if not title_anchor:
            continue
        results.append(
            {
                "title": title_anchor.get_text(" ", strip=True),
                "snippet": snippet_node.get_text(" ", strip=True) if snippet_node else "",
                "url": title_anchor.get("href", ""),
            }
        )
    return results


@tool
def web_search(query: str) -> str:
    """Search the internet for information about a topic."""
    try:
        results = _search_results_html(query, max_results=5)
        if not results:
            return f"No results found for '{query}'."
        formatted = []
        for r in results:
            formatted.append(f"**{r.get('title', '')}**\n{r.get('snippet', '')}\nURL: {r.get('url', '')}")
        return "\n\n".join(formatted)
    except Exception as e:
        return f"Search error: {str(e)}"


@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression safely. Examples: '2 + 2', 'sqrt(16)'."""
    try:
        import math
        allowed = {k: v for k, v in vars(math).items() if not k.startswith('_')}
        allowed.update({'abs': abs, 'round': round, 'int': int, 'float': float})
        result = eval(expression, {"__builtins__": {}}, allowed)
        return f"Result: {result}"
    except Exception as e:
        return f"Calculation error: {str(e)}"


@tool
def http_request(url: str) -> str:
    """Make an HTTP GET request to a URL and return the response body (max 2000 chars)."""
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return f"Status: {resp.status_code}\nBody: {resp.text[:2000]}"
    except Exception as e:
        return f"Request failed: {str(e)}"


@tool
def datetime_tool(timezone: str = "UTC") -> str:
    """Get the current date and time."""
    now = datetime.utcnow()
    return f"Current UTC datetime: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}"


@tool
def text_analysis(text: str) -> str:
    """Analyze text: return word count, sentence count, and key statistics."""
    words = text.split()
    sentences = text.count('.') + text.count('!') + text.count('?')
    return (
        f"Text Analysis:\n"
        f"- Characters: {len(text)}\n"
        f"- Words: {len(words)}\n"
        f"- Sentences: {sentences}\n"
        f"- Avg words/sentence: {len(words) / max(sentences, 1):.1f}"
    )


SEARCH_ORG_FILES_DEFINITION = {
    "name": "search_org_files",
    "description": (
        "Search the organization's file storage for documents, "
        "research briefs, reports, and other files. "
        "Use this when you need to find previous work, research, "
        "or documents created by other agents."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to search for. Be specific: e.g. 'Acme Corp competitor research Q2'",
            },
            "client_name": {
                "type": "string",
                "description": "Optional: filter results to a specific client name",
            },
        },
        "required": ["query"],
    },
}


READ_ORG_FILE_DEFINITION = {
    "name": "read_org_file",
    "description": (
        "Read the full content of a specific file from storage. "
        "Use the file_id returned by search_org_files."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "The file ID to read (from search_org_files results)",
            },
        },
        "required": ["file_id"],
    },
}


TOOL_REGISTRY = {
    "web_search": web_search,
    "calculator": calculator,
    "http_request": http_request,
    "datetime_tool": datetime_tool,
    "text_analysis": text_analysis,
}

SPECIAL_TOOL_IDS = {
    "github",
    "email",
    "slack",
    "telegram",
    "notifications",
    "code_execution",
    "code_review",
    "web_intelligence",
    "research",
}
BUILTIN_TOOL_IDS = set(TOOL_REGISTRY.keys()) | SPECIAL_TOOL_IDS
BUILTIN_TOOL_IDS.update({"search_org_files", "read_org_file"})

EXTERNAL_AGENT_TOOL_PREFIX = "agent:"


def is_external_agent_tool(tool_id: str) -> bool:
    return bool(tool_id) and tool_id.startswith(EXTERNAL_AGENT_TOOL_PREFIX)


def is_builtin_tool_id(tool_id: str) -> bool:
    return tool_id in BUILTIN_TOOL_IDS or is_external_agent_tool(tool_id)


def get_tools(tool_ids: list[str], custom_tool_defs: list = None):
    """Return LangChain tool objects for the given IDs."""
    custom_by_id = {d.id: d for d in (custom_tool_defs or [])}
    tools = []
    for tid in tool_ids:
        if tid in TOOL_REGISTRY:
            tools.append(TOOL_REGISTRY[tid])
        elif tid in custom_by_id:
            tools.append(make_custom_tool(custom_by_id[tid]))
    return tools

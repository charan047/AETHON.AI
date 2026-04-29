import asyncio
import uuid

try:
    import docker
except ImportError:  # pragma: no cover - dependency is installed from requirements in deployed envs
    docker = None

from langchain_core.tools import tool

from config import settings
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


@tool_registry.register
class CodeExecutorTool(BaseTool):
    name = "code_execution"
    description = "Execute Python code in a secure isolated Docker container"
    category = ToolCategory.code_execution
    requires_auth = False
    rate_limit_per_minute = 20

    EXECUTION_IMAGE = settings.docker_execution_image
    MEMORY_LIMIT = "128m"
    CPU_QUOTA = 50000
    NETWORK_DISABLED = True
    BASE_TIMEOUT = 30

    AVAILABLE_PACKAGES = [
        "requests",
        "json",
        "math",
        "datetime",
        "re",
        "os",
        "sys",
        "collections",
        "itertools",
        "functools",
        "typing",
        "csv",
        "io",
        "base64",
        "hashlib",
        "random",
        "string",
        "urllib",
        "http",
        "pandas",
        "numpy",
        "matplotlib",
        "scipy",
        "openpyxl",
    ]

    def __init__(self, user_id: str, config: dict | None = None):
        super().__init__(user_id, config)
        self._docker_client = None
        self._ensure_image_pulled = False

    def _get_docker_client(self):
        if docker is None:
            raise RuntimeError("Docker SDK is not installed. Run pip install -r requirements.txt.")
        if self._docker_client is None:
            self._docker_client = docker.DockerClient(base_url="unix:///var/run/docker.sock")
        return self._docker_client

    async def get_langchain_tools(self) -> list:
        return [self._make_run_code_tool(), self._make_run_script_tool()]

    def _make_run_code_tool(self):
        executor = self

        @tool
        async def run_python_code(code: str, timeout_seconds: int = 30) -> str:
            """
            Execute Python code in an isolated Docker container.
            Returns stdout output. Automatically handles errors.
            Available packages: json, math, datetime, re, requests, csv, io.
            No internet access. No file system access outside /tmp.
            Max execution time: 30 seconds. Max memory: 128MB.
            """
            result = await executor.execute_with_tracking(
                "run_python_code",
                executor._execute_code,
                code,
                max(1, min(timeout_seconds, executor.BASE_TIMEOUT)),
            )
            if result.success:
                return result.result
            return f"Execution failed: {result.error}"

        return run_python_code

    def _make_run_script_tool(self):
        executor = self

        @tool
        async def run_data_analysis(data_json: str, analysis_code: str) -> str:
            """
            Run data analysis code on JSON data.
            The JSON data is automatically available as 'data' variable.
            Returns analysis results as string.
            """
            wrapped_code = f"""
import json
data = {data_json}

{analysis_code}
"""
            result = await executor.execute_with_tracking(
                "run_data_analysis",
                executor._execute_code,
                wrapped_code,
                executor.BASE_TIMEOUT,
            )
            if result.success:
                return result.result
            return f"Analysis failed: {result.error}"

        return run_data_analysis

    async def _ensure_image(self, client) -> None:
        if self._ensure_image_pulled:
            return

        loop = asyncio.get_running_loop()

        def _pull_or_get():
            try:
                client.images.get(self.EXECUTION_IMAGE)
            except Exception:
                client.images.pull(self.EXECUTION_IMAGE)

        await loop.run_in_executor(None, _pull_or_get)
        self._ensure_image_pulled = True

    async def _execute_code(self, code: str, timeout: int) -> str:
        """Core Docker execution logic."""
        client = self._get_docker_client()
        await self._ensure_image(client)

        execution_id = str(uuid.uuid4())[:8]
        loop = asyncio.get_running_loop()

        def _run_container():
            container = None
            try:
                container = client.containers.run(
                    image=self.EXECUTION_IMAGE,
                    command=["python", "-c", code],
                    name=f"platform-exec-{execution_id}",
                    mem_limit=self.MEMORY_LIMIT,
                    cpu_period=100000,
                    cpu_quota=self.CPU_QUOTA,
                    network_disabled=self.NETWORK_DISABLED,
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
                result = container.wait(timeout=timeout)
                output = container.logs(stdout=True, stderr=True)
                status_code = result.get("StatusCode", 1)
                decoded = output.decode("utf-8", errors="replace")[:10000]
                if status_code != 0:
                    raise RuntimeError(f"Code exited with status {status_code}:\n{decoded}")
                return decoded
            except docker.errors.ContainerError as exc:
                stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else str(exc)
                raise RuntimeError(f"Code error:\n{stderr}") from exc
            except Exception as exc:
                raise RuntimeError(f"Container failed: {exc}") from exc
            finally:
                if container is not None:
                    try:
                        container.remove(force=True)
                    except Exception:
                        pass

        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, _run_container),
                timeout=timeout + 5,
            )
            return result
        except asyncio.TimeoutError as exc:
            raise RuntimeError(f"Execution timed out after {timeout}s") from exc

    async def health_check(self) -> tuple[ToolHealth, str]:
        """Verify Docker is accessible and image is available."""
        try:
            client = self._get_docker_client()
            client.ping()
            result = await self._execute_code("print('health_check_ok')", 10)
            if "health_check_ok" in result:
                return ToolHealth.healthy, "Docker accessible, execution working"
            return ToolHealth.degraded, "Docker accessible but execution returned unexpected output"
        except Exception as exc:
            return ToolHealth.unhealthy, f"Docker unavailable: {exc}"

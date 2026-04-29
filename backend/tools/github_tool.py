import base64
from typing import Any

import httpx
from langchain_core.tools import StructuredTool

from tools.base import BaseTool, ToolCategory, ToolHealth


class GitHubTool(BaseTool):
    name = "github"
    description = "Read and modify GitHub repositories, branches, files, pull requests, issues, and commits."
    category = ToolCategory.version_control
    requires_auth = True
    rate_limit_per_minute = 30

    def __init__(self, user_id: str = "system", config: dict | None = None):
        if isinstance(user_id, dict) and config is None:
            config = user_id
            user_id = "system"
        super().__init__(user_id=user_id, config=config)
        self.access_token = self.config.get("access_token", "")
        self.default_repo = self.config.get("default_repo", "")
        self.base_url = "https://api.github.com"

    @property
    def headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def get_tools(self) -> list[StructuredTool]:
        return [
            StructuredTool.from_function(self.read_file),
            StructuredTool.from_function(self.list_files),
            StructuredTool.from_function(self.create_branch),
            StructuredTool.from_function(self.create_or_update_file),
            StructuredTool.from_function(self.create_pull_request),
            StructuredTool.from_function(self.get_open_issues),
            StructuredTool.from_function(self.get_recent_commits),
        ]

    async def get_langchain_tools(self) -> list[StructuredTool]:
        return self.get_tools()

    async def health_check(self) -> tuple[ToolHealth, str]:
        if not self.access_token:
            return ToolHealth.degraded, "GitHub token is not configured for this user"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(f"{self.base_url}/user", headers=self.headers)
            if response.status_code < 400:
                return ToolHealth.healthy, "GitHub API is reachable"
            return ToolHealth.unhealthy, f"GitHub API returned {response.status_code}"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)

    def _repo(self, repo: str) -> str:
        return repo or self.default_repo

    def _request(self, method: str, path: str, **kwargs) -> Any:
        try:
            with httpx.Client(timeout=20) as client:
                response = client.request(method, f"{self.base_url}{path}", headers=self.headers, **kwargs)
            if response.status_code >= 400:
                detail = response.json().get("message", response.text)
                return f"GitHub API error ({response.status_code}): {detail}"
            return response.json()
        except Exception as exc:
            return f"GitHub request failed: {exc}"

    def read_file(self, repo: str, path: str, branch: str = "main") -> str:
        """Read a file from a GitHub repo. repo format: owner/name."""
        repo = self._repo(repo)
        data = self._request("GET", f"/repos/{repo}/contents/{path}", params={"ref": branch})
        if isinstance(data, str):
            return data
        if data.get("type") != "file":
            return f"Path '{path}' is not a file."
        try:
            return base64.b64decode(data.get("content", "")).decode("utf-8")
        except Exception as exc:
            return f"Failed to decode file content: {exc}"

    def list_files(self, repo: str, path: str = "", branch: str = "main") -> list | str:
        """List files and directories in a GitHub repo path."""
        repo = self._repo(repo)
        data = self._request("GET", f"/repos/{repo}/contents/{path}", params={"ref": branch})
        if isinstance(data, str):
            return data
        items = data if isinstance(data, list) else [data]
        return [
            {
                "name": item.get("name"),
                "path": item.get("path"),
                "type": item.get("type"),
                "size": item.get("size"),
            }
            for item in items
        ]

    def create_branch(self, repo: str, branch_name: str, from_branch: str = "main") -> str:
        """Create a branch from another branch."""
        repo = self._repo(repo)
        ref = self._request("GET", f"/repos/{repo}/git/ref/heads/{from_branch}")
        if isinstance(ref, str):
            return ref
        sha = ref.get("object", {}).get("sha")
        if not sha:
            return f"Could not find source branch '{from_branch}'."
        created = self._request(
            "POST",
            f"/repos/{repo}/git/refs",
            json={"ref": f"refs/heads/{branch_name}", "sha": sha},
        )
        if isinstance(created, str):
            return created
        return created.get("url") or f"Created branch {branch_name}"

    def create_or_update_file(self, repo: str, path: str, content: str, message: str, branch: str) -> str:
        """Create or update a file in a GitHub repo branch."""
        repo = self._repo(repo)
        existing = self._request("GET", f"/repos/{repo}/contents/{path}", params={"ref": branch})
        payload = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
            "branch": branch,
        }
        if isinstance(existing, dict) and existing.get("sha"):
            payload["sha"] = existing["sha"]
        updated = self._request("PUT", f"/repos/{repo}/contents/{path}", json=payload)
        if isinstance(updated, str):
            return updated
        return updated.get("commit", {}).get("html_url") or "File committed successfully."

    def create_pull_request(self, repo: str, title: str, body: str, head: str, base: str = "main") -> str:
        """Create a pull request."""
        repo = self._repo(repo)
        data = self._request("POST", f"/repos/{repo}/pulls", json={"title": title, "body": body, "head": head, "base": base})
        if isinstance(data, str):
            return data
        return data.get("html_url") or "Pull request created."

    def get_open_issues(self, repo: str, limit: int = 10) -> list | str:
        """Get open GitHub issues."""
        repo = self._repo(repo)
        data = self._request("GET", f"/repos/{repo}/issues", params={"state": "open", "per_page": limit})
        if isinstance(data, str):
            return data
        return [
            {
                "number": issue.get("number"),
                "title": issue.get("title"),
                "labels": [label.get("name") for label in issue.get("labels", [])],
                "body": issue.get("body"),
            }
            for issue in data
            if "pull_request" not in issue
        ]

    def get_recent_commits(self, repo: str, branch: str = "main", limit: int = 10) -> list | str:
        """Get recent commits from a branch."""
        repo = self._repo(repo)
        data = self._request("GET", f"/repos/{repo}/commits", params={"sha": branch, "per_page": limit})
        if isinstance(data, str):
            return data
        return [
            {
                "message": commit.get("commit", {}).get("message"),
                "author": commit.get("commit", {}).get("author", {}).get("name"),
                "timestamp": commit.get("commit", {}).get("author", {}).get("date"),
                "url": commit.get("html_url"),
            }
            for commit in data
        ]

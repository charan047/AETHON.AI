import asyncio
import base64
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


SKIP_DIRS = {"node_modules", ".git", "__pycache__", "dist", "build", ".next"}


class ReadFileInput(BaseModel):
    repo: str = ""
    path: str
    branch: str = "main"


class ListRepositoryStructureInput(BaseModel):
    repo: str = ""
    path: str = ""
    depth: int = Field(default=3, ge=1, le=5)


class SearchCodebaseInput(BaseModel):
    repo: str = ""
    query: str
    file_extension: str | None = None


class RecentCommitsInput(BaseModel):
    repo: str = ""
    branch: str = "main"
    limit: int = Field(default=10, ge=1, le=30)


class OpenIssuesInput(BaseModel):
    repo: str = ""
    label: str | None = None
    limit: int = Field(default=15, ge=1, le=50)


class PullRequestsInput(BaseModel):
    repo: str = ""
    state: str = "open"


class CreateBranchInput(BaseModel):
    repo: str = ""
    branch_name: str
    from_branch: str = "main"


class CreateOrUpdateFileInput(BaseModel):
    repo: str = ""
    path: str
    content: str
    commit_message: str
    branch: str


class CreatePullRequestInput(BaseModel):
    repo: str = ""
    title: str
    body: str
    head_branch: str
    base_branch: str = "main"
    draft: bool = False


class AddPRCommentInput(BaseModel):
    repo: str = ""
    pr_number: int
    comment: str


class PRDiffInput(BaseModel):
    repo: str = ""
    pr_number: int


class FileBlameInput(BaseModel):
    repo: str = ""
    path: str


class CreateIssueInput(BaseModel):
    repo: str = ""
    title: str
    body: str
    labels: list[str] | None = None


class CloseIssueInput(BaseModel):
    repo: str = ""
    issue_number: int
    comment: str | None = None


@tool_registry.register
class GitHubTool(BaseTool):
    name = "github"
    description = "Full GitHub integration: read code, create branches, open PRs, manage issues"
    category = ToolCategory.version_control
    requires_auth = True
    rate_limit_per_minute = 30

    def __init__(self, user_id: str, config: dict | None = None):
        super().__init__(user_id, config)
        self._github = None
        self._token = self.config.get("access_token")
        self._default_repo = self.config.get("default_repo")

    def _get_client(self):
        if not self._token:
            raise ValueError("GitHub token not configured. Add GitHub integration in Settings -> Integrations.")
        if self._github is None:
            from github import Github

            self._github = Github(self._token)
        return self._github

    def _repo_name(self, repo: str | None) -> str:
        repo_name = (repo or self._default_repo or "").strip()
        if not repo_name:
            raise ValueError("Repository is required. Use owner/name or configure a default repo.")
        return repo_name

    def _get_repo(self, repo: str | None):
        return self._get_client().get_repo(self._repo_name(repo))

    async def get_langchain_tools(self) -> list:
        return [
            self._make_read_file_tool(),
            self._make_list_repository_structure_tool(),
            self._make_search_codebase_tool(),
            self._make_get_recent_commits_tool(),
            self._make_get_open_issues_tool(),
            self._make_get_pull_requests_tool(),
            self._make_create_branch_tool(),
            self._make_create_or_update_file_tool(),
            self._make_create_pull_request_tool(),
            self._make_add_pr_comment_tool(),
            self._make_get_pr_diff_tool(),
            self._make_get_file_blame_tool(),
            self._make_create_issue_tool(),
            self._make_close_issue_tool(),
        ]

    def _tracked_tool(self, function_name: str, description: str, implementation, args_schema: type[BaseModel]):
        executor = self

        async def wrapped(**kwargs) -> str:
            result = await executor.execute_with_tracking(function_name, implementation, **kwargs)
            return result.result if result.success else f"GitHub {function_name} failed: {result.error}"

        wrapped.__name__ = function_name
        wrapped.__doc__ = description
        return StructuredTool.from_function(
            coroutine=wrapped,
            name=function_name,
            description=description,
            args_schema=args_schema,
        )

    def _make_read_file_tool(self):
        return self._tracked_tool(
            "read_file",
            "Read a file from GitHub. Args: repo owner/name, path, branch.",
            self.read_file,
            ReadFileInput,
        )

    def _make_list_repository_structure_tool(self):
        return self._tracked_tool(
            "list_repository_structure",
            "Return a formatted repository tree. Args: repo, path, depth.",
            self.list_repository_structure,
            ListRepositoryStructureInput,
        )

    def _make_search_codebase_tool(self):
        return self._tracked_tool(
            "search_codebase",
            "Search code in a GitHub repository. Args: repo, query, optional file_extension.",
            self.search_codebase,
            SearchCodebaseInput,
        )

    def _make_get_recent_commits_tool(self):
        return self._tracked_tool(
            "get_recent_commits",
            "Return formatted recent commit history. Args: repo, branch, limit.",
            self.get_recent_commits,
            RecentCommitsInput,
        )

    def _make_get_open_issues_tool(self):
        return self._tracked_tool(
            "get_open_issues",
            "Return open issues. Args: repo, optional label, limit.",
            self.get_open_issues,
            OpenIssuesInput,
        )

    def _make_get_pull_requests_tool(self):
        return self._tracked_tool(
            "get_pull_requests",
            "Return pull requests with status summary. Args: repo, state.",
            self.get_pull_requests,
            PullRequestsInput,
        )

    def _make_create_branch_tool(self):
        return self._tracked_tool(
            "create_branch",
            "Create a branch from another branch. Args: repo, branch_name, from_branch.",
            self.create_branch,
            CreateBranchInput,
        )

    def _make_create_or_update_file_tool(self):
        return self._tracked_tool(
            "create_or_update_file",
            "Create or update a file in a branch. Args: repo, path, content, commit_message, branch.",
            self.create_or_update_file,
            CreateOrUpdateFileInput,
        )

    def _make_create_pull_request_tool(self):
        return self._tracked_tool(
            "create_pull_request",
            "Create a pull request. Args: repo, title, body, head_branch, base_branch, draft.",
            self.create_pull_request,
            CreatePullRequestInput,
        )

    def _make_add_pr_comment_tool(self):
        return self._tracked_tool(
            "add_pr_comment",
            "Add a comment to a pull request. Args: repo, pr_number, comment.",
            self.add_pr_comment,
            AddPRCommentInput,
        )

    def _make_get_pr_diff_tool(self):
        return self._tracked_tool(
            "get_pr_diff",
            "Return a pull request diff, truncated to 5000 chars. Args: repo, pr_number.",
            self.get_pr_diff,
            PRDiffInput,
        )

    def _make_get_file_blame_tool(self):
        return self._tracked_tool(
            "get_file_blame",
            "Return blame-style recent ownership for a file. Args: repo, path.",
            self.get_file_blame,
            FileBlameInput,
        )

    def _make_create_issue_tool(self):
        return self._tracked_tool(
            "create_issue",
            "Create a GitHub issue. Args: repo, title, body, labels.",
            self.create_issue,
            CreateIssueInput,
        )

    def _make_close_issue_tool(self):
        return self._tracked_tool(
            "close_issue",
            "Close a GitHub issue with optional comment. Args: repo, issue_number, comment.",
            self.close_issue,
            CloseIssueInput,
        )

    async def _run_sync(self, fn):
        return await asyncio.get_running_loop().run_in_executor(None, fn)

    async def read_file(self, repo: str = "", path: str = "", branch: str = "main") -> str:
        def _read():
            try:
                content = self._get_repo(repo).get_contents(path, ref=branch)
            except Exception as exc:
                if "404" in str(exc):
                    raise FileNotFoundError("File not found") from exc
                raise
            if isinstance(content, list):
                raise ValueError(f"Path '{path}' is a directory, not a file")
            return base64.b64decode(content.content).decode("utf-8", errors="replace")

        return await self._run_sync(_read)

    async def list_repository_structure(self, repo: str = "", path: str = "", depth: int = 3) -> str:
        depth = max(1, min(int(depth or 3), 5))

        def _tree():
            repository = self._get_repo(repo)

            def walk(current_path: str, remaining_depth: int, prefix: str = "") -> list[str]:
                if remaining_depth < 0:
                    return []
                try:
                    contents = repository.get_contents(current_path)
                except Exception:
                    return [f"{prefix}└── [unreadable] {current_path}"]
                if not isinstance(contents, list):
                    return [f"{prefix}└── {contents.name}"]
                visible = [item for item in contents if item.name not in SKIP_DIRS]
                lines = []
                for index, item in enumerate(visible):
                    connector = "└── " if index == len(visible) - 1 else "├── "
                    lines.append(f"{prefix}{connector}{item.name}{'/' if item.type == 'dir' else ''}")
                    if item.type == "dir" and remaining_depth > 1:
                        extension = "    " if index == len(visible) - 1 else "│   "
                        lines.extend(walk(item.path, remaining_depth - 1, prefix + extension))
                return lines

            root = path or repository.full_name
            return f"{root}\n" + "\n".join(walk(path, depth))

        return await self._run_sync(_tree)

    async def search_codebase(self, repo: str = "", query: str = "", file_extension: str | None = None) -> str:
        repo_name = self._repo_name(repo)
        extension = ""
        if file_extension:
            extension = file_extension if file_extension.startswith(".") else f".{file_extension}"
        search_query = f"{query} repo:{repo_name}"
        if extension:
            search_query += f" extension:{extension.lstrip('.')}"

        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github.text-match+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                "https://api.github.com/search/code",
                headers=headers,
                params={"q": search_query, "per_page": 10},
            )
        if response.status_code >= 400:
            raise RuntimeError(f"GitHub code search error ({response.status_code}): {response.text[:500]}")
        items = response.json().get("items", [])
        if not items:
            return "No code matches found."
        lines = []
        for item in items[:10]:
            snippet = ""
            matches = item.get("text_matches") or []
            if matches:
                snippet = matches[0].get("fragment", "")
            lines.append(
                f"{item.get('path')}\n"
                f"URL: {item.get('html_url')}\n"
                f"Snippet:\n{snippet[:800] or '[snippet unavailable]'}\n---"
            )
        return "\n".join(lines)

    async def get_recent_commits(self, repo: str = "", branch: str = "main", limit: int = 10) -> str:
        limit = max(1, min(int(limit or 10), 30))

        def _commits():
            commits = self._get_repo(repo).get_commits(sha=branch)[:limit]
            lines = []
            for commit in commits:
                sha = commit.sha[:7]
                author = commit.commit.author.name if commit.commit.author else "unknown"
                date = commit.commit.author.date.strftime("%Y-%m-%d") if commit.commit.author else "unknown-date"
                msg = commit.commit.message.splitlines()[0]
                lines.append(f"{sha} | {author} | {date} | {msg}")
            return "\n".join(lines) or "No commits found."

        return await self._run_sync(_commits)

    async def get_open_issues(self, repo: str = "", label: str | None = None, limit: int = 15) -> str:
        limit = max(1, min(int(limit or 15), 50))

        def _issues():
            issues = self._get_repo(repo).get_issues(state="open", labels=[label] if label else None)
            lines = []
            now = datetime.now(timezone.utc)
            for issue in list(issues)[:limit]:
                if issue.pull_request:
                    continue
                labels = ", ".join(item.name for item in issue.labels) or "no labels"
                age_days = (now - issue.created_at.replace(tzinfo=timezone.utc)).days
                lines.append(f"#{issue.number} | {issue.title} | labels: {labels} | age: {age_days}d")
            return "\n".join(lines) or "No open issues found."

        return await self._run_sync(_issues)

    async def get_pull_requests(self, repo: str = "", state: str = "open") -> str:
        state = state if state in {"open", "closed", "all"} else "open"

        def _prs():
            repository = self._get_repo(repo)
            prs = repository.get_pulls(state=state)
            now = datetime.now(timezone.utc)
            lines = []
            for pr in list(prs)[:20]:
                ci_status = "unknown"
                try:
                    statuses = pr.get_commits().reversed[0].get_statuses()
                    latest = list(statuses)[:1]
                    if latest:
                        ci_status = latest[0].state
                except Exception:
                    pass
                age_days = (now - pr.created_at.replace(tzinfo=timezone.utc)).days
                lines.append(f"#{pr.number} | {pr.title} | {pr.user.login} | CI: {ci_status} | age: {age_days}d")
            return "\n".join(lines) or "No pull requests found."

        return await self._run_sync(_prs)

    async def create_branch(self, repo: str = "", branch_name: str = "", from_branch: str = "main") -> str:
        if not re.match(r"^[A-Za-z0-9._/-]+$", branch_name or ""):
            raise ValueError("Invalid branch name. Use letters, numbers, dots, underscores, slashes, and hyphens only.")

        def _create():
            repository = self._get_repo(repo)
            source = repository.get_branch(from_branch)
            ref = repository.create_git_ref(ref=f"refs/heads/{branch_name}", sha=source.commit.sha)
            return ref.url

        return await self._run_sync(_create)

    async def create_or_update_file(
        self,
        repo: str = "",
        path: str = "",
        content: str = "",
        commit_message: str = "",
        branch: str = "",
    ) -> str:
        def _write():
            repository = self._get_repo(repo)
            try:
                existing = repository.get_contents(path, ref=branch)
                result = repository.update_file(
                    path=path,
                    message=commit_message,
                    content=content,
                    sha=existing.sha,
                    branch=branch,
                )
            except Exception as exc:
                if "404" not in str(exc):
                    raise
                result = repository.create_file(
                    path=path,
                    message=commit_message,
                    content=content,
                    branch=branch,
                )
            return result["commit"].html_url

        return await self._run_sync(_write)

    async def create_pull_request(
        self,
        repo: str = "",
        title: str = "",
        body: str = "",
        head_branch: str = "",
        base_branch: str = "main",
        draft: bool = False,
    ) -> str:
        def _create():
            pr = self._get_repo(repo).create_pull(
                title=title,
                body=body,
                head=head_branch,
                base=base_branch,
                draft=draft,
            )
            return f"PR #{pr.number}: {pr.html_url}"

        return await self._run_sync(_create)

    async def add_pr_comment(self, repo: str = "", pr_number: int = 0, comment: str = "") -> str:
        def _comment():
            issue = self._get_repo(repo).get_issue(int(pr_number))
            created = issue.create_comment(comment)
            return created.html_url

        return await self._run_sync(_comment)

    async def get_pr_diff(self, repo: str = "", pr_number: int = 0) -> str:
        repo_name = self._repo_name(repo)
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github.diff",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"https://api.github.com/repos/{repo_name}/pulls/{int(pr_number)}", headers=headers)
        if response.status_code >= 400:
            raise RuntimeError(f"GitHub PR diff error ({response.status_code}): {response.text[:500]}")
        diff = response.text
        return diff[:5000] + ("\n...[truncated]" if len(diff) > 5000 else "")

    async def get_file_blame(self, repo: str = "", path: str = "") -> str:
        def _blame():
            commits = self._get_repo(repo).get_commits(path=path)[:20]
            lines = [f"Recent ownership for {path}:"]
            for commit in commits:
                author = commit.commit.author.name if commit.commit.author else "unknown"
                date = commit.commit.author.date.strftime("%Y-%m-%d") if commit.commit.author else "unknown-date"
                msg = commit.commit.message.splitlines()[0]
                lines.append(f"{commit.sha[:7]} | {author} | {date} | {msg}")
            return "\n".join(lines) if len(lines) > 1 else f"No commit history found for {path}."

        return await self._run_sync(_blame)

    async def create_issue(self, repo: str = "", title: str = "", body: str = "", labels: list[str] | None = None) -> str:
        def _create():
            issue = self._get_repo(repo).create_issue(title=title, body=body, labels=labels or [])
            return f"Issue #{issue.number}: {issue.html_url}"

        return await self._run_sync(_create)

    async def close_issue(self, repo: str = "", issue_number: int = 0, comment: str | None = None) -> str:
        def _close():
            issue = self._get_repo(repo).get_issue(int(issue_number))
            if comment:
                issue.create_comment(comment)
            issue.edit(state="closed")
            return f"Closed issue #{issue.number}: {issue.html_url}"

        return await self._run_sync(_close)

    async def health_check(self) -> tuple[ToolHealth, str]:
        try:
            client = self._get_client()
            user = await self._run_sync(lambda: client.get_user())
            return ToolHealth.healthy, f"Authenticated as {user.login}"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)

# Release Checklist

Use this checklist before a push intended for public visibility, demos, or production-minded releases.

## 1. Repository Hygiene

- confirm no plaintext secrets are tracked
- confirm `.env`, local DBs, browser artifacts, archives, and worktree leftovers are ignored
- review `git status --short`
- ensure docs use repo-relative links
- verify no local-only screenshots, zips, or debug output are staged

## 2. Product Integrity

- backend starts cleanly
- frontend builds cleanly
- database migrations apply cleanly
- health endpoint returns `200`
- onboarding works for a new org
- `/clients` and `/clients/:id` load
- `/files` and `/files/:fileId/edit` load
- model control plane loads
- marketplace install works for at least one template
- a workflow executes end to end through the worker
- portal enable/disable and public token behavior work
- direct file uploads work through Garage presigned URLs
- collaborative documents persist and sync through Hocuspocus

## 3. Multi-Tenant Safety

- org A cannot see org B data
- WebSocket events are org-scoped
- analytics is org-scoped
- model configs are org-scoped
- approvals and tool logs respect org boundaries
- public portal never exposes internal-only data

## 4. Documentation

- [README.md](../README.md) reflects the current product
- [DOCUMENTATION.md](../DOCUMENTATION.md) reflects the current architecture
- [SECURITY.md](../SECURITY.md) reflects the current security posture
- [CONTRIBUTING.md](../CONTRIBUTING.md) reflects the contribution workflow
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) reflects the current stack

## 5. Verification Signals

- run relevant backend tests
- run frontend build
- run representative browser checks
- inspect migration files carefully
- capture known gaps explicitly instead of leaving them implicit

## 6. Pre-Push Review

- inspect `git diff --stat`
- verify no temporary debug code remains
- verify no secrets or fake credentials are staged
- confirm staged docs match the current product language

## 7. Before Pushing To GitHub

- confirm the remote is correct
- confirm the branch is correct
- confirm whether the push should include all current product changes
- confirm untracked local artifacts are excluded

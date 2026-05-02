# Release Checklist

This checklist is intended for private repository pushes, internal demos, investor diligence drops, and production-minded release candidates.

## 1. Repository hygiene

- confirm no plaintext secrets are tracked
- confirm `.env`, local DBs, browser artifacts, and backup directories are ignored
- review `git status --short` for accidental machine-specific files
- ensure new docs use repo-relative links, not local absolute paths
- review `.gitignore` for any newly introduced generated assets

## 2. Product integrity

- backend starts cleanly
- frontend builds cleanly
- database migrations apply cleanly
- health endpoint returns `200`
- core onboarding flow works for a new org
- marketplace install flow works for at least one supported listing
- workflow execution works end to end
- billing surfaces fail gracefully when third-party credentials are absent
- model control plane routes load and org scoping holds

## 3. Multi-tenant safety

- validate org A cannot see org B dashboard data
- validate org A cannot see org B notifications
- validate websocket subscriptions require the active org
- validate marketplace installs, executions, and model configs are org-scoped
- validate approval and audit surfaces respect org boundaries

## 4. Documentation

- [README.md](../README.md) reflects the current product positioning
- [DOCUMENTATION.md](../DOCUMENTATION.md) reflects the current architecture
- [SECURITY.md](../SECURITY.md) reflects the current security posture
- [CONTRIBUTING.md](../CONTRIBUTING.md) reflects the contributor workflow
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) reflects the current service topology
- [backend/docs/quality_report.md](../backend/docs/quality_report.md) reflects the latest verified quality snapshot

## 5. Verification signals

- run backend tests relevant to touched surfaces
- run frontend build
- run representative Playwright checks
- review CI workflow expectations in [.github/workflows/test.yml](../.github/workflows/test.yml)
- capture any known gaps in the quality report rather than leaving them implicit

## 6. Pre-push review

- inspect `git diff --stat`
- inspect new migrations carefully
- verify no temporary debug code remains
- verify logs do not expose secrets
- verify no fake or placeholder credentials were committed

## 7. Before pushing to GitHub

- confirm the remote URL is correct and private
- confirm the target branch naming strategy
- confirm whether the first push should be a full history push or a curated branch push
- confirm whether large local backup/history folders should remain excluded
- confirm whether the user wants one initial baseline commit or multiple structured commits

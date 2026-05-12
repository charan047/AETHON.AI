# Open Source Launch Checklist

Use this checklist before publishing or refreshing the public repository.

## GitHub Repository Settings

### About Section

Suggested description:

`Open-source Agency OS for running AI agents, client workspaces, workflows, approvals, model control, and client portals.`

Suggested topics:

- `ai`
- `agents`
- `agency`
- `agency-os`
- `workflow-engine`
- `fastapi`
- `react`
- `multi-tenant`
- `human-in-the-loop`
- `model-control-plane`
- `client-portal`
- `marketplace`

### Features

Enable if desired:

- Issues
- Discussions
- Security advisories
- Projects

## Branch Protection

Recommended for `main`:

- require PR before merge
- require status checks
- require linear history if desired
- restrict force pushes

## Security Settings

Enable:

- dependency graph
- Dependabot alerts
- Dependabot security updates
- secret scanning
- push protection for secrets when available

## Repo Hygiene

Confirm:

- [ ] README is current
- [ ] LICENSE exists and is MIT
- [ ] SECURITY.md exists
- [ ] CONTRIBUTING.md exists
- [ ] CODE_OF_CONDUCT.md exists
- [ ] docs are free of stale billing/plan references
- [ ] local archives and worktree artifacts are ignored

## Launch Content

Before posting publicly, prepare:

- product screenshots
- one onboarding GIF or short video
- one dashboard screenshot
- one client portal screenshot
- one technical architecture post or thread

## Discoverability

Your README and repository description should naturally cover:

- AI agency operating system
- client workspaces
- AI agents
- workflow orchestration
- approvals
- model control plane
- monitoring and auditability
- client portal
- self-hosted open source

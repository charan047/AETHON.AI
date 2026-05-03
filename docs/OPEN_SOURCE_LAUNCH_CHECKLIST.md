# Open Source Launch Checklist

Use this checklist before making the repository public.

## GitHub Repository Settings

### About Section

Set:

- Description:
  `The operating system for AI companies. Run AI teammates, workflows, approvals, models, and company operations from one platform.`
- Website:
  add your public landing page or waitlist URL when available
- Topics:
  `ai`, `agents`, `multi-agent`, `ai-workflows`, `fastapi`, `react`, `langchain`, `workflow-engine`, `human-in-the-loop`, `ai-ops`, `model-control-plane`, `marketplace`

### Social Preview

Upload a branded social preview image that includes:

- AETHON wordmark
- short tagline
- dark Mission OS styling
- one-line positioning statement

### Features

Enable if desired:

- Issues
- Projects
- Wiki only if you plan to maintain it
- Discussions if you want community Q&A
- Security advisories

## Branch Protection

Recommended for `main`:

- require pull request before merge
- require status checks
- require linear history if you want a clean public history
- restrict force pushes

## Security Settings

Enable:

- dependency graph
- Dependabot alerts
- Dependabot security updates
- secret scanning
- push protection for secrets if available
- code scanning if you later add CodeQL

## Repo Hygiene

Confirm:

- [ ] README is current
- [ ] LICENSE exists
- [ ] SECURITY.md exists
- [ ] CONTRIBUTING.md exists
- [ ] CODE_OF_CONDUCT.md exists
- [ ] issue templates are present
- [ ] PR template is present
- [ ] roadmap and changelog are present

## Launch Content

Before posting blogs or social launch threads, prepare:

- one technical deep-dive post
- one product story post
- one architecture diagram or product screenshot thread
- one demo video or GIF

## Discoverability

Your README and repo description should naturally cover:

- AI company operating system
- AI teammates
- workflow orchestration
- model control plane
- human-in-the-loop approvals
- observability and monitoring
- marketplace and installable capabilities

# Contributing to Aethon Agency OS

Thanks for contributing.

Aethon is a real multi-tenant product codebase with a live runtime, workflow engine, model control plane, approvals, and client-facing surfaces. Good contributions improve safety, clarity, reliability, and operator confidence.

## Before You Start

Read:

- [README.md](README.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)
- [SECURITY.md](SECURITY.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

If your change touches auth, org scoping, workflows, model configs, portals, or tools, read the relevant code paths first.

## What We Optimize For

- correctness
- tenant isolation
- predictable failure states
- maintainable code
- explicit runtime behavior
- strong verification

## Local Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
```

### Frontend

```bash
cd frontend
npm install
```

### Full Stack

```bash
docker compose up -d --build
```

## Branching

Keep branches focused.

Recommended names:

- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`
- `chore/<short-description>`

Avoid mixing unrelated refactors, schema changes, and product fixes in one PR unless they are tightly coupled.

## Pull Request Expectations

Every PR should explain:

- what changed
- why it changed
- how it was validated
- what risks were considered
- whether docs or migrations changed

## Engineering Rules

### 1. Protect Tenant Boundaries

If a surface is org-owned, assume `org_id` scoping is required unless you can prove otherwise.

High-risk examples:

- analytics
- executions
- WebSocket events
- approvals
- model configs
- marketplace installs
- client portal data

### 2. Treat Secrets As Toxic Data

- never commit `.env`
- never log plaintext API keys
- never return encrypted secrets in API responses
- preserve existing encryption or masking behavior

### 3. Prefer Explicit Failure States

Avoid silent failure when the product should visibly surface:

- approval pauses
- provider misconfiguration
- model test failures
- auth/session drift
- workflow runtime failures
- portal disable/404 states

### 4. Keep Frontend State Honest

The UI should not claim:

- a run completed when it is still running
- a model is healthy when the last test failed
- an install succeeded when the backend failed
- a client portal is active if the token is disabled

### 5. Ship Schema Changes Properly

Database changes should include:

- model updates
- Alembic migration
- backfill logic when needed
- verification of upgrade behavior

## Validation Before Opening A PR

### Backend

```bash
cd backend
pytest tests/ -v
```

### Frontend

```bash
cd frontend
npm run build
```

### Story Validation

For flow-heavy changes, validate the affected journey end to end:

- onboarding
- marketplace install
- workflow execution
- approvals
- model assignment
- client portal
- multi-org isolation

## Docs To Update When Needed

Check whether your change affects:

- [README.md](README.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)
- [SECURITY.md](SECURITY.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## Contribution Areas We Especially Value

- tenant isolation hardening
- workflow runtime reliability
- model provider support
- approval and audit improvements
- portal safety
- docs that help new maintainers ramp up faster
- tests that catch real regressions

## Do Not Commit

- secrets
- `.env` files
- local database or cache artifacts
- generated browser test output
- archives, backup zips, or machine-specific files
- editor worktree artifacts

## If You’re Unsure

Open an issue first for:

- large architectural changes
- public API shape changes
- new provider integrations
- security-sensitive behavior changes
- major design system rewrites

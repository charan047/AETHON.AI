# Contributing to AETHON

Thanks for contributing to AETHON.

This repository is not a toy demo. It is a multi-tenant product codebase with real runtime, workflow, billing, model-routing, and approval surfaces. We value contributions that make the platform safer, clearer, faster, and more operable.

## What We Optimize For

When making changes, optimize for:

- correctness
- tenant isolation
- product coherence
- operational resilience
- clear failure states
- maintainable code paths
- excellent developer ergonomics

## Read Before You Change Anything

Start here:

- [README.md](README.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)
- [SECURITY.md](SECURITY.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

If your change touches deployment, billing, auth, model routing, tools, or org-scoped data, read the relevant sections in [DOCUMENTATION.md](DOCUMENTATION.md) first.

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

## Branching Guidelines

- keep branches focused
- avoid mixing unrelated refactors with product fixes
- include migrations in the same change set as the schema change
- document behavioral changes when they affect operators or contributors

Recommended branch naming:

- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`
- `chore/<short-description>`

## Pull Request Expectations

Every pull request should answer:

- what changed
- why it changed
- what risks were considered
- how it was validated
- whether docs or migrations were updated

Use the PR template in [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).

## Engineering Rules

### 1. Protect Tenant Boundaries

This is the most important platform invariant.

If your code touches:

- API queries
- websocket channels
- notifications
- analytics
- tool logs
- approvals
- models
- executions
- marketplace installs

assume `org_id` scoping is required unless you can prove otherwise.

### 2. Treat Secrets As Toxic Data

- never commit `.env`
- never log plaintext API keys
- never return encrypted secrets in API responses
- reuse the existing encryption paths for stored credentials

### 3. Prefer Explicit Failure States

Avoid silent failure when the product should surface:

- plan limits
- approval wait states
- integration misconfiguration
- model connection failures
- websocket disconnects
- tool runtime issues

### 4. Keep Frontend State Honest

The UI should not claim:

- an install succeeded when it did not
- a run completed when it is still pending
- a model is configured when the org has no working default

### 5. Ship Schema Changes Properly

Database changes must include:

- model update
- Alembic migration
- backfill logic when needed
- downgrade path where practical

## Validation Checklist Before Opening A PR

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

### Targeted Runtime Validation

For flow-heavy changes, validate the affected story end to end:

- onboarding
- marketplace install
- workflow execution
- approvals
- billing
- model assignment
- multi-org isolation

### Docs

Check whether your change affects:

- [README.md](README.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)
- [SECURITY.md](SECURITY.md)
- [backend/docs/quality_report.md](backend/docs/quality_report.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## Contribution Areas We Especially Value

- multi-tenant correctness
- security hardening
- workflow runtime reliability
- model provider support
- approval and audit systems
- product polish
- testing and verification
- docs that reduce ramp-up time

## What Not To Commit

- local secrets
- `.env` files
- `node_modules`
- Python virtualenvs
- local DB/cache artifacts
- generated Playwright output
- backup/recovery artifacts

## Code Review Mindset

Review changes for:

- tenant isolation regressions
- auth/session correctness
- migration safety
- websocket correctness
- user-facing confusion states
- hidden production assumptions
- rollback difficulty

## If You’re Unsure

Open an issue first for:

- large architectural changes
- new provider integrations
- public API shape changes
- major workflow/runtime behavior changes
- broad design system shifts

We would rather align early than unwind a large change later.

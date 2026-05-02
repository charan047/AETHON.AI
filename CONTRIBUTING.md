# Contributing to AETHON

## Purpose

This repository is the product codebase for AETHON. Contributions should optimize for:

- correctness
- tenant safety
- operational clarity
- maintainability
- product coherence across backend and frontend

## Before you start

Read:

- [README.md](README.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)
- [SECURITY.md](SECURITY.md)

## Local setup

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

### Full stack

```bash
docker compose up -d --build
```

## Branch and PR expectations

- use short, descriptive branches
- keep changes focused to one problem or feature area
- do not mix unrelated cleanup with product changes unless necessary
- if a migration is required, include it in the same change set

## Engineering rules for this repo

### Multi-tenancy

Every new backend query or websocket pathway must be reviewed for `org_id` isolation.

If a feature returns or mutates org data, assume org-scoping is required unless proven otherwise.

### Secrets and credentials

- never commit `.env`
- never log raw API keys
- never return encrypted credential fields in API responses

### Migrations

- schema changes go through Alembic
- do not rely on implicit table creation as the long-term migration strategy

### Frontend quality

- prefer shared primitives over one-off UI patterns
- use the shared toast wrapper in [frontend/src/lib/toast.ts](frontend/src/lib/toast.ts)
- keep global queries gated on auth/org readiness when they depend on org-scoped APIs

## Suggested validation before opening a PR

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

### Browser verification

Use the existing Playwright specs in [frontend/e2e](frontend/e2e) for flows touched by your change.

## Documentation expectations

Update docs when you change:

- core product positioning
- environment setup
- route structure
- deployment assumptions
- tenant boundaries
- security posture

At minimum, assess whether the change impacts:

- [README.md](README.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)
- [backend/docs/quality_report.md](backend/docs/quality_report.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## What not to commit

- local recovery artifacts
- `backups/`
- generated Playwright artifacts
- local DB/cache directories
- secrets

## Code review mindset

Review for:

- tenant isolation
- auth/session correctness
- migration safety
- runtime regressions
- UI state consistency
- production readiness of failure states

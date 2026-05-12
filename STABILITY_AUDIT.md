# Aethon Stability Audit

This document tracks the current stability state of core product areas in Aethon Agency OS.

## Feature Status Matrix

| Feature Area | Status | Priority | Notes |
| --- | --- | --- | --- |
| Authentication and session refresh | Partial | P0 | Refresh paths exist. Re-verify long-session behavior before releases. |
| Global app error recovery | Working | P0 | Error boundary prevents blank-screen failures on render crashes. |
| Layout and route scrolling | Partial | P0 | Main traps were removed, but every new page still needs release QA. |
| Agency dashboard | Partial | P0 | Live data and WebSocket dependencies still require manual release checks. |
| Monitoring and execution detail | Partial | P0 | Long event streams and laptop-height layouts need repeated QA. |
| Client management | Partial | P0 | Core flows exist. Creation, detail, assignment, and portal behavior need regression QA. |
| Agent management | Partial | P0 | CRUD and model assignment work, but still require end-to-end checks. |
| Workflow builder and runs | Partial | P0 | Complex flows need repeated QA whenever orchestration changes. |
| Execution live view | Partial | P0 | Reload, reconnect, and mixed step timelines remain high-risk. |
| Approvals | Partial | P0 | Works, but is stateful and should be re-tested after runtime changes. |
| Model control plane | Partial | P1 | Core flows exist. Default/delete/rotation edge cases should stay in regression coverage. |
| Marketplace | Partial | P1 | Install flow is present, but template installs should be re-verified before release. |
| Client portal | Partial | P1 | Token safety and public-data constraints require explicit release checks. |
| Analytics | Partial | P1 | Null guards exist. Chart QA and long-page QA should remain part of release review. |
| Agency Chat | Partial | P0 | High-value but complex surface. Validate after runtime, auth, or WebSocket changes. |
| Direct Messages | Partial | P0 | Depends on async reply generation and live delivery. Re-test before release. |
| Integrations | Partial | P1 | Real provider credentials still require environment-specific verification. |

## Stability Rules

1. The layout shell owns viewport height and route scrolling.
2. Tenant-owned data must stay org-scoped across APIs, logs, analytics, and WebSockets.
3. Every route should have loading, error, and empty states.
4. Mutation failures should surface readable errors.
5. Public portal endpoints must never expose internal-only fields.
6. Long-running execution state must recover cleanly from restart or reconnect scenarios.

## Release Follow-Ups

- Run full manual QA on `/`, `/clients`, `/clients/:id`, `/company-chat`, `/agents`, `/workflows`, `/monitoring`, and `/analytics`.
- Re-verify session refresh after a real long-running session.
- Re-run agency chat, onboarding, and workflow execution after runtime or WebSocket changes.

# Aethon Production Risk Register

This register tracks the highest production risks identified during the audit-driven stability work.

| Risk | Severity | Owner | Mitigation |
| --- | --- | --- | --- |
| Orphaned executions remain `running` after crashes | Critical | Backend runtime | Startup cleanup resets stale executions to `failed`; background runner also marks failures before exit. |
| Cross-org realtime leakage over websocket channels | Critical | Backend platform | Scope execution broadcasts to `org:{org_id}` and verify channel subscribers are org-scoped. |
| Route scroll traps clip content on laptop-height screens | High | Frontend platform | Keep viewport control in Layout, remove page-level `overflow-hidden`, and QA every major route at 768px height. |
| Unhandled render errors blank the app shell | High | Frontend platform | Global error boundary must stay in place and be tested during release QA. |
| Ad-hoc API error parsing produces inconsistent UX | High | Frontend platform | Use `extractApiError()` everywhere and block new direct `error.response?.data?.detail` usage in review. |
| Nullable metrics crash UI rendering | High | Frontend platform | Guard all numeric formatting with null-safe defaults and keep regression QA on analytics and marketplace pages. |
| Session expiry forces unexpected logout | High | Auth | Keep proactive refresh and 401 retry interceptor active; validate with long-session QA. |
| Monitoring and execution views drift from actual backend state | High | Frontend + backend runtime | Persist enough execution step metadata to reconstruct agent ownership after reloads and reconnects. |
| Agency Chat action paths depend on fragile workflow/agent assumptions | High | AI platform | Validate every action path against real schema fields; keep helpful user-facing fallback messages. |
| Direct messaging depends on async reply generation and websocket delivery | Medium | Messaging platform | Keep durable DB persistence, websocket fallbacks, and explicit QA around reply timing and delivery. |
| Model library misconfiguration can leave multiple defaults or blocked deletes | Medium | AI platform | Normalize defaults server-side and re-verify delete/default flows after model changes. |
| Feature surfaces lack consistent route loading/error/empty states | Medium | Frontend platform | Every route must be reviewed against the stability checklist before release. |

## Review Cadence

- Revisit this register before every production release.
- Re-rank severity after any infrastructure, auth, workflow-engine, or websocket change.
- Add a mitigation owner whenever a new cross-cutting failure mode is discovered.

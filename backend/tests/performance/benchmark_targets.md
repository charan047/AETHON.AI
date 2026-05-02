# Performance Benchmarks
These are the minimum acceptable performance targets.
Run load tests weekly. Alert if any target is missed.

## Response Time Targets (p95)
| Endpoint | Target | Reason |
|---|---|---|
| GET /api/agents | < 100ms | Most frequent operation |
| GET /api/dashboard/summary | < 500ms | Dashboard load |
| GET /api/marketplace | < 200ms | Public, must be fast |
| POST /api/auth/login | < 300ms | bcrypt is intentionally slow |
| POST /api/executions/.../run | < 1000ms | Starts background task |
| WebSocket connect | < 100ms | Real-time feel |

## Throughput Targets
| Scenario | Target |
|---|---|
| Concurrent users | 200 without degradation |
| Requests per second | 500 RPS peak |
| Workflow executions | 50 concurrent without queuing |

## Database Targets
| Query | Max count per request |
|---|---|
| List endpoints | 2 queries maximum |
| Detail endpoints | 3 queries maximum |
| Dashboard | 6 parallel queries |
| No N+1 queries | ZERO tolerance |

/**
 * Playwright config for the full Docker stack.
 *
 * Run with:
 *   npx playwright test --config=playwright.docker.config.ts
 *
 * Expects these ports to already be up:
 *   http://localhost        — frontend (Docker port 80)
 *   http://localhost:8000   — nginx load-balancer (backend API)
 *   http://localhost:5555   — Flower (Celery monitor)
 *
 * Start the stack first:
 *   docker compose --profile local-db up -d --build
 *   docker compose exec backend-1 alembic upgrade head
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // All page.goto('/') calls resolve here — the Docker nginx frontend
    baseURL: 'http://localhost',
    // API requests in helpers.ts go to the load-balancer
    extraHTTPHeaders: {},
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Don't launch webServer — Docker handles it
  },
  // No webServer block: we rely on already-running Docker containers.
  // If the stack is not up the tests will fail fast on the health-check.
})

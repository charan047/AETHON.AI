import { defineConfig } from '@playwright/test'

const useExistingBackend = process.env.PLAYWRIGHT_USE_EXISTING_BACKEND === '1'
const useExistingFrontend = process.env.PLAYWRIGHT_USE_EXISTING_FRONTEND === '1'
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    ...(!useExistingBackend
      ? [
          {
            command: 'cd ../backend && ./venv/bin/python main.py',
            url: 'http://localhost:8000/health',
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]
      : []),
    ...(!useExistingFrontend
      ? [
          {
            command: 'npm run dev -- --host 127.0.0.1',
            url: 'http://127.0.0.1:5173',
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]
      : []),
  ],
})

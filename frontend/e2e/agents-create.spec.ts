import { test, expect } from '@playwright/test'
import { loginHelper } from './helpers'

test.describe('Agent Creation', () => {
  test.beforeEach(async ({ page }) => {
    await loginHelper(page)
  })

  test('creates agent successfully and modal closes', async ({ page }) => {
    await page.goto('/agents')
    await page.getByRole('button', { name: /add agent/i }).click()
    await page.getByPlaceholder('Name').fill('Test Agent')
    await page.getByPlaceholder('Role').fill('Researcher')
    await page.getByPlaceholder(/system prompt/i).fill('You are a helpful research assistant.')
    await page.getByRole('button', { name: /add teammate/i }).click()
    await expect(page.locator('[data-testid="agent-form"]')).not.toBeVisible()
    await expect(page.locator('text=Test Agent')).toBeVisible()
  })

  test('shows validation error without name', async ({ page }) => {
    await page.goto('/agents')
    await page.getByRole('button', { name: /add agent/i }).click()
    await page.getByRole('button', { name: /add teammate/i }).click()
    await expect(page.locator('[data-testid="agent-form"]')).toBeVisible()
  })

  test('shows validation error without system prompt', async ({ page }) => {
    await page.goto('/agents')
    await page.getByRole('button', { name: /add agent/i }).click()
    await page.getByPlaceholder('Name').fill('Test Agent')
    await page.getByPlaceholder('Role').fill('Researcher')
    await page.getByRole('button', { name: /add teammate/i }).click()
    await expect(page.locator('[data-testid="agent-form"]')).toBeVisible()
  })

  test('modal closes even if model assignment fails', async ({ page }) => {
    await page.route('**/api/models', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'cfg_test_default',
            provider: 'openai',
            model_id: 'gpt-4o-mini',
            display_name: 'Default Test Model',
            is_default: true,
            is_active: true,
            supports_tools: true,
            supports_vision: false,
            context_window: 128000,
            cost_per_million_input_tokens: 0.15,
            cost_per_million_output_tokens: 0.6,
            test_status: null,
            last_tested_at: null,
            notes: null,
            recommended_role: null,
            usage_tier: 'standard',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      })
    })
    await page.route('**/api/agents/*/model', route => route.abort())

    await page.goto('/agents')
    await page.getByRole('button', { name: /add agent/i }).click()
    await page.getByPlaceholder('Name').fill('Model Fail Agent')
    await page.getByPlaceholder('Role').fill('Researcher')
    await page.getByPlaceholder(/system prompt/i).fill('Test prompt.')
    await page.getByRole('button', { name: /add teammate/i }).click()

    await expect(page.locator('[data-testid="agent-form"]')).not.toBeVisible()
    await expect(page.locator('text=Model Fail Agent')).toBeVisible()
  })
})

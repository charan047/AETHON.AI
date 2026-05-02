import { test, expect } from '@playwright/test'
import { createAgentHelper, loginHelper } from './helpers'

test.describe('Agent Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginHelper(page)
  })

  test('create a new agent', async ({ page }) => {
    const name = `Test Support Agent ${Date.now()}`
    await createAgentHelper(page, name)
  })

  test('agent card shows correct status', async ({ page }) => {
    await createAgentHelper(page, `Status Agent ${Date.now()}`)
    const agentCard = page.locator('.agent-card').first()
    await expect(agentCard.locator('.status-badge')).toBeVisible()
    const statusText = await agentCard.locator('.status-badge').textContent()
    expect(['Active', 'Idle', 'Running']).toContain(statusText?.trim())
  })

  test('delete agent removes it from list', async ({ page }) => {
    const name = `Delete Me Agent ${Date.now()}`
    await createAgentHelper(page, name)
    const card = page.locator('.agent-card', { hasText: name }).first()
    await card.locator('.btn-danger').click()
    await page.getByRole('button', { name: /delete agent/i }).click()
    await expect(page.getByText(name)).toHaveCount(0)
  })
})

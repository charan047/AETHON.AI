import { expect, test } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

function emptyAgencyOverview() {
  return {
    agency_name: 'E2E Agency',
    owner_user_id: 'owner-1',
    generated_at: new Date().toISOString(),
    clients: { total: 0, active: 0, with_activity_today: 0, list: [] },
    agents: { total: 0, working: 0, idle: 0, list: [] },
    approvals: { pending: 0, critical: 0, list: [] },
    activity: { executions_today: 0, completed_today: 0, recent: [] },
    needs_attention: [],
    attention_count: 0,
  }
}

test.describe('Product statement and empty states', () => {
  test('login page shows the canonical product statement', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByText('Your AI agency team. Handles the repeatable work.')).toBeVisible()
    await expect(page.getByText('You approve before anything reaches clients.')).toBeVisible()
  })

  test('core pages show the new dashboard welcome and agency empty states', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('empty-states'))

    await page.route('**/api/agency/overview', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyAgencyOverview()),
      })
    })

    await page.route('**/api/agents/meta/models', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/agents/meta/tools', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/settings/memory-status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mem0_enabled: false, mem0_configured: false }),
      })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/clients', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ clients: [], total: 0 }),
      })
    })
    await page.route('**/api/workflows/automation-templates', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/workflows/scheduled', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/workflows', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/approvals/agent-requests', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pending_count: 0, requests: [] }),
      })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/approvals/history*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/monitoring/recent-executions*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/monitoring/logs*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/missions', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await page.goto('/')
    await expect(page.getByText('Welcome to Aethon')).toBeVisible()
    await expect(page.getByText('Your AI agency team. Handles the repeatable work.')).toBeVisible()
    await expect(page.getByText('Start by adding a team member or running the demo below')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add team member' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible()

    await page.goto('/agents')
    await expect(page.getByText('Your AI team members')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add team member' })).toBeVisible()

    await page.goto('/workflows')
    await expect(page.getByText('Recurring work, automated')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create first process' })).toBeVisible()

    await page.goto('/approvals')
    await expect(page.getByText('All clear')).toBeVisible()
    await expect(page.getByText('When an agent needs your sign-off before doing something sensitive, it shows up here.')).toBeVisible()

    await page.goto('/monitoring')
    await expect(page.getByText('No runs yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run a process' })).toBeVisible()

    await page.goto('/missions')
    await expect(page.getByText('Multi-step projects')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start a project' })).toBeVisible()

    await page.goto('/clients')
    await expect(page.getByText('Your client accounts')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add first client' })).toBeVisible()
  })
})

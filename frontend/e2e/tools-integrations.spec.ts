import { expect, test } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

test.describe('Tools and Integrations', () => {
  test('tools page does not retry starter-pack creation in a loop when the seed request fails', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('tools-seed-failure'))

    let starterPackPostCount = 0

    await page.route('**/api/tools/catalog*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/api/tools/provider-health*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    })

    await page.route('**/api/tools', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
        return
      }

      starterPackPostCount += 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Database error' }),
      })
    })

    await page.goto('/tools')

    await expect(page.getByText('Add your first custom tool')).toBeVisible()
    await expect(page.getByRole('button', { name: /Install starter tools/i })).toBeVisible()
    await expect.poll(() => starterPackPostCount).toBe(1)
    await page.waitForTimeout(900)
    await expect.poll(() => starterPackPostCount).toBe(1)
  })

  test('tools page supports built-in details and creating a custom tool', async ({ page, request }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('aethon-custom-tools-starter-pack-seeded', '1')
    })
    await loginHelper(page, request, uniqueEmail('tools-page'))

    const toolsState = {
      tools: [
        {
          id: 'tool-existing-1',
          name: 'client_summary_builder',
          description: 'Builds a client summary.',
          code: 'def run(client_name: str) -> str:\n    return client_name\n',
          is_active: true,
        },
      ],
    }

    await page.route('**/api/tools/catalog*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { name: 'gmail_send', display_name: 'Gmail', description: 'Send mail', category: 'communication', requires_auth: true, auth_type: 'oauth' },
          { name: 'brave_search', display_name: 'Brave Search', description: 'Search the web', category: 'search', requires_auth: false },
        ]),
      })
    })

    await page.route('**/api/tools/provider-health*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          search: { provider: 'Brave', status: 'healthy', note: 'Brave key configured' },
          gmail: { provider: 'gmail', status: 'not_configured', note: 'Connect Google in Integrations to enable this tool.' },
          slack: { provider: 'slack', status: 'healthy', note: 'Slack connected' },
          github: { provider: 'github', status: 'healthy', note: 'GitHub token connected' },
        }),
      })
    })

    await page.route('**/api/tools/parse-params*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ params: [{ name: 'client_name', type: 'str', required: true }] }),
      })
    })

    await page.route('**/api/tools', async route => {
      const requestMethod = route.request().method()
      if (requestMethod === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(toolsState.tools),
        })
        return
      }
      if (requestMethod === 'POST') {
        const body = route.request().postDataJSON() as Record<string, string>
        const created = {
          id: `tool-${toolsState.tools.length + 1}`,
          name: body.name,
          description: body.description,
          code: body.code,
          is_active: true,
        }
        toolsState.tools = [...toolsState.tools, created]
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
        return
      }
      await route.continue()
    })

    await page.route(/\/api\/tools\/[^/]+$/, async route => {
      if (route.request().method() === 'PUT') {
        const id = route.request().url().split('/').pop()!
        const body = route.request().postDataJSON() as Record<string, unknown>
        toolsState.tools = toolsState.tools.map(tool => (tool.id === id ? { ...tool, ...body } : tool))
        const updated = toolsState.tools.find(tool => tool.id === id)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(updated),
        })
        return
      }
      await route.continue()
    })

    await page.goto('/tools')

    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible()
    await expect(page.getByText('Built-In', { exact: true })).toBeVisible()
    await expect(page.getByText('Custom', { exact: true })).toBeVisible()

    await page.locator('.data-row').filter({ hasText: 'Read Gmail' }).getByRole('button', { name: 'details' }).click()
    await expect(page.getByText('Google integration')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Integrations' })).toBeVisible()

    await page.getByRole('button', { name: /Add Tool/i }).click()
    await expect(page.getByText('New Tool')).toBeVisible()

    await page.getByPlaceholder('e.g. weather_lookup').fill('weekly_brief_tool')
    await page.getByPlaceholder('e.g. Look up current weather for a city').fill('Creates a weekly brief for the CEO.')
    await page.locator('textarea').first().fill('def run(client_name: str) -> str:\n    return f"Brief for {client_name}"\n')
    await page.getByRole('button', { name: /Create Tool/i }).click()

    await expect(page.getByText('weekly_brief_tool')).toBeVisible()
    await expect(page.getByText('Creates a weekly brief for the CEO.')).toBeVisible()
  })

  test('integrations page shows health and can add a GitHub connection', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('integrations-page'))

    const integrationsState = {
      items: [
        {
          id: 'gmail-1',
          name: 'Agency Gmail',
          integration_type: 'gmail',
          connected_account: 'ops@agency.test',
          is_supported: true,
          needs_reauth: true,
          is_active: true,
          last_tested_at: null,
          last_test_result: null,
        },
        {
          id: 'notion-1',
          name: 'Legacy Notion',
          integration_type: 'notion',
          connected_account: null,
          is_supported: false,
          support_note: 'notion exists in stored data, but it is not yet supported as a first-class Aethon integration.',
          needs_reauth: false,
          is_active: true,
          last_tested_at: null,
          last_test_result: null,
        },
      ] as any[],
    }

    await page.route('**/api/integrations', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(integrationsState.items),
      })
    })
    await page.route('**/api/tools/provider-health', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          search: { provider: 'Brave', status: 'healthy', note: 'Brave connected' },
          gmail: { provider: 'gmail', status: 'degraded', note: 'Needs updated scope for Google Docs' },
          slack: { provider: 'slack', status: 'not_configured', note: 'Not connected yet' },
          github: { provider: 'github', status: 'not_configured', note: 'No token configured yet' },
        }),
      })
    })
    await page.route('**/api/integrations/github', async route => {
      const body = route.request().postDataJSON() as Record<string, string>
      const created = {
        id: 'github-1',
        name: body.name,
        integration_type: 'github',
        connected_account: 'octo-org/platform',
        default_repo: body.default_repo,
        is_supported: true,
        is_active: true,
        needs_reauth: false,
        last_tested_at: null,
        last_test_result: null,
      }
      integrationsState.items = [...integrationsState.items, created]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
    })

    await page.goto('/integrations')

    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible()
    await expect(page.getByText('TOOL STATUS')).toBeVisible()
    await expect(page.getByText('Gmail needs updated permissions for Google Docs')).toBeVisible()
    await expect(page.getByText('LEGACY / UNSUPPORTED')).toBeVisible()
    await expect(page.getByText('Legacy Notion')).toBeVisible()
    await expect(page.getByText('Unsupported', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Coming soon', { exact: true })).toBeVisible()

    const githubCard = page.locator('.glass-card, .glow-card').filter({ has: page.getByRole('heading', { name: 'GitHub' }) }).first()
    await githubCard.getByRole('button', { name: /Connect/i }).click()

    await expect(page.getByRole('heading', { name: /Add GitHub Integration/i })).toBeVisible()
    await page.getByLabel('Name').fill('Primary GitHub')
    await page.getByLabel('GitHub personal access token').fill('ghp_test_token')
    await page.getByLabel('Default repo (owner/repo)').fill('octo-org/platform')
    await page.getByRole('button', { name: /Connect GitHub/i }).click()

    await expect(page.getByText('GitHub connected')).toBeVisible()
    await expect(page.getByText('Primary GitHub')).toBeVisible()
    await expect(page.getByText('octo-org/platform').first()).toBeVisible()
  })
})

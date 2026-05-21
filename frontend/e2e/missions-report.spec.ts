import { expect, test } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

test.describe('Missions and Reports', () => {
  test('missions page can create a new mission from the redesigned composer', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('missions-page'))

    const missionsState = {
      items: [] as any[],
    }

    await page.route('**/api/missions', async route => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(missionsState.items) })
        return
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as { goal: string; client_id?: string | null }
        const created = {
          id: 'mission-1',
          title: body.goal,
          goal: body.goal,
          client_id: body.client_id || null,
          client_name: body.client_id ? 'Acme Corp' : null,
          status: 'active',
          created_at: new Date().toISOString(),
          completed_at: null,
          report: '',
          report_delivered: false,
          stats: { total: 3, completed: 1 },
          tasks: [
            { id: 'task-1', title: 'Research competitors', status: 'completed', agent_id: 'agent-1' },
            { id: 'task-2', title: 'Draft brief', status: 'running', agent_id: 'agent-2' },
            { id: 'task-3', title: 'Prepare next steps', status: 'pending', agent_id: 'agent-3' },
          ],
        }
        missionsState.items = [created]
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
        return
      }
      await route.continue()
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route('**/api/clients', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          clients: [
            { id: 'client-1', name: 'Acme', company_name: 'Acme Corp' },
            { id: 'client-2', name: 'Nova', company_name: 'Nova Labs' },
          ],
        }),
      })
    })

    await page.goto('/missions')

    await expect(page.getByRole('heading', { name: 'Missions' })).toBeVisible()
    await page.getByRole('button', { name: /New Mission/i }).click()
    await page.getByPlaceholder('Describe the goal for your agency...').fill('Launch the Acme strategy sprint')
    await page.getByRole('button', { name: 'Acme Corp', exact: true }).click()
    await page.getByRole('button', { name: /Create Mission/i }).click()

    await expect(page.getByText('Launch the Acme strategy sprint')).toBeVisible()
    await expect(page.getByText('ACTIVE')).toBeVisible()
    await expect(page.getByText('Acme Corp')).toBeVisible()
    await expect(page.getByText(/1 of 3 tasks complete/i)).toBeVisible()
  })

  test('mission report renders markdown and task breakdown', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('mission-report'))

    let approved = false

    await page.route('**/api/missions/mission-report-1', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mission-report-1',
          title: 'Acme Launch Sprint',
          goal: 'Acme Launch Sprint',
          client_id: 'client-1',
          client_name: 'Acme Corp',
          status: 'completed',
          created_at: '2026-05-20T10:00:00Z',
          completed_at: '2026-05-20T10:41:00Z',
          report_delivered: approved,
          report: '# Acme Launch Sprint\n\n## Executive Summary\nLaunch ready.\n\n## Next Steps\nShip the brief.',
          tasks: [
            {
              id: 'task-r1',
              title: 'Research market',
              status: 'completed',
              started_at: '2026-05-20T10:00:00Z',
              completed_at: '2026-05-20T10:15:00Z',
              output_summary: '## Findings\nCompetition is moderate.',
              execution_id: 'exec-1',
            },
          ],
        }),
      })
    })
    await page.route('**/api/missions/mission-report-1/approve-report', async route => {
      approved = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mission-report-1',
          title: 'Acme Launch Sprint',
          goal: 'Acme Launch Sprint',
          client_id: 'client-1',
          client_name: 'Acme Corp',
          status: 'completed',
          created_at: '2026-05-20T10:00:00Z',
          completed_at: '2026-05-20T10:41:00Z',
          report_delivered: true,
          report: '# Acme Launch Sprint\n\n## Executive Summary\nLaunch ready.\n\n## Next Steps\nShip the brief.',
          tasks: [
            {
              id: 'task-r1',
              title: 'Research market',
              status: 'completed',
              started_at: '2026-05-20T10:00:00Z',
              completed_at: '2026-05-20T10:15:00Z',
              output_summary: '## Findings\nCompetition is moderate.',
              execution_id: 'exec-1',
            },
          ],
        }),
      })
    })
    await page.route('**/api/missions/mission-report-1/report', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: '# Acme Launch Sprint\n\n## Executive Summary\nLaunch ready.\n\n## Next Steps\nShip the brief.',
        }),
      })
    })

    await page.goto('/missions/mission-report-1/report')

    await expect(page.getByRole('heading', { name: 'Acme Launch Sprint' }).first()).toBeVisible()
    await expect(page.getByText('Mission Report', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Export PDF/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Export Word/i })).toBeVisible()
    await expect(page.getByText('Executive Summary')).toBeVisible()
    await expect(page.getByText('Launch ready.')).toBeVisible()
    await expect(page.getByText('TASK BREAKDOWN')).toBeVisible()
    await expect(page.getByText('Research market')).toBeVisible()
    await expect(page.getByRole('link', { name: /View execution/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Approve for Client Portal/i })).toBeVisible()

    await page.getByRole('button', { name: /Approve for Client Portal/i }).click()
    await expect(page.getByText(/Approved for the client portal/i)).toBeVisible()
  })
})

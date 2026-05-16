import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

function authHeaders(orgId: string, accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Org-Id': orgId,
  }
}

test.describe('Recent Platform Surfaces', () => {
  test('integrations, notifications, automations, and eval compare surfaces work together', async ({
    page,
    request,
  }) => {
    const { orgId, accessToken } = await loginHelper(page, request)
    const headers = authHeaders(orgId, accessToken)

    const agentName = `Research Analyst ${Date.now()}`
    const createAgentResponse = await request.post('/api/agents', {
      headers,
      data: {
        name: agentName,
        role: 'Research Analyst',
        system_prompt: 'You are a careful research analyst for UI scenario tests.',
      },
    })
    expect(createAgentResponse.ok()).toBeTruthy()
    const agent = await createAgentResponse.json()

    const suiteName = `UI Compare Suite ${Date.now()}`
    const createSuiteResponse = await request.post('/api/evals/suites', {
      headers,
      data: {
        name: suiteName,
        description: 'Browser scenario coverage for recent eval features.',
        agent_id: agent.id,
        pass_threshold: 0.8,
      },
    })
    expect(createSuiteResponse.ok()).toBeTruthy()
    const suite = await createSuiteResponse.json()

    const createCaseResponse = await request.post(`/api/evals/suites/${suite.id}/cases`, {
      headers,
      data: {
        name: 'Case 1',
        input: 'Summarize the latest OpenAI updates.',
        expected_output: 'OpenAI',
        scoring_method: 'contains',
        scoring_config: { needle: 'OpenAI' },
        weight: 1.0,
      },
    })
    expect(createCaseResponse.ok()).toBeTruthy()

    const modelAResponse = await request.post('/api/models', {
      headers,
      data: {
        provider: 'openai',
        model_id: 'gpt-4o-mini',
        display_name: 'Compare Model A',
      },
    })
    expect(modelAResponse.ok()).toBeTruthy()
    const modelA = await modelAResponse.json()

    const modelBResponse = await request.post('/api/models', {
      headers,
      data: {
        provider: 'anthropic',
        model_id: 'claude-3-5-haiku',
        display_name: 'Compare Model B',
      },
    })
    expect(modelBResponse.ok()).toBeTruthy()
    const modelB = await modelBResponse.json()

    const compareHistoryPayload = {
      comparisons: [
        {
          comparison_group_id: 'cmp-history-1',
          created_at: '2026-05-16T03:00:00Z',
          model_a: {
            model_config_id: modelA.id,
            model_name: 'gpt-4o-mini',
            display_name: 'Compare Model A',
            pass_rate: 60,
            avg_duration_seconds: 4.2,
            cost_usd: 0.0034,
            run_id: 'run-a-1',
          },
          model_b: {
            model_config_id: modelB.id,
            model_name: 'claude-3-5-haiku',
            display_name: 'Compare Model B',
            pass_rate: 80,
            avg_duration_seconds: 3.1,
            cost_usd: 0.0021,
            run_id: 'run-b-1',
          },
          winner: 'model_b',
          winner_label: 'claude-3-5-haiku',
          pass_rates: {
            model_a: 60,
            model_b: 80,
          },
        },
      ],
    }

    await page.route(`**/api/evals/suites/${suite.id}/compare-history`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(compareHistoryPayload),
      })
    })
    await page.route(`**/api/evals/${suite.id}/compare-history`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(compareHistoryPayload),
      })
    })
    await page.route(`**/api/evals/suites/${suite.id}/compare`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suite_id: suite.id,
          model_a: {
            model_config_id: modelA.id,
            model_name: 'gpt-4o-mini',
            display_name: 'Compare Model A',
            pass_rate: 60,
            avg_duration_seconds: 4.2,
            cost_usd: 0.0034,
            run_id: 'run-a-2',
          },
          model_b: {
            model_config_id: modelB.id,
            model_name: 'claude-3-5-haiku',
            display_name: 'Compare Model B',
            pass_rate: 80,
            avg_duration_seconds: 3.1,
            cost_usd: 0.0021,
            run_id: 'run-b-2',
          },
          winner: 'model_b',
          winner_reason: 'Compare Model B wins on pass rate and cost.',
        }),
      })
    })
    await page.route(`**/api/evals/${suite.id}/compare`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suite_id: suite.id,
          model_a: {
            model_config_id: modelA.id,
            model_name: 'gpt-4o-mini',
            display_name: 'Compare Model A',
            pass_rate: 60,
            avg_duration_seconds: 4.2,
            cost_usd: 0.0034,
            run_id: 'run-a-2',
          },
          model_b: {
            model_config_id: modelB.id,
            model_name: 'claude-3-5-haiku',
            display_name: 'Compare Model B',
            pass_rate: 80,
            avg_duration_seconds: 3.1,
            cost_usd: 0.0021,
            run_id: 'run-b-2',
          },
          winner: 'model_b',
          winner_reason: 'Compare Model B wins on pass rate and cost.',
        }),
      })
    })

    await page.goto('/integrations')
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tool Health' })).toBeVisible()
    await expect(page.getByText('Web Search')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Gmail' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Slack' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Connect Gmail/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Connect Slack/i })).toBeVisible()

    await page.goto('/settings/notifications')
    await expect(page.getByRole('heading', { name: 'Alerts and digests' })).toBeVisible()
    await page.getByPlaceholder('owner@example.com').fill('ops@example.com')
    await page.getByRole('button', { name: /Execution complete/i }).click()
    await page.getByRole('button', { name: 'Save Preferences' }).click()
    await expect(page.getByText('Notification preferences saved')).toBeVisible()
    await page.reload()
    await expect(page.getByPlaceholder('owner@example.com')).toHaveValue('ops@example.com')

    await page.goto('/workflows')
    await expect(page.getByRole('heading', { name: 'Quick automations' })).toBeVisible()

    const dailyResearchCard = page.locator('.glass-card').filter({
      has: page.getByRole('heading', { name: 'Daily Research Digest' }),
    }).first()
    await expect(dailyResearchCard).toBeVisible()
    await dailyResearchCard.getByRole('button', { name: /Enable/i }).click()

    await expect(page.locator('div', { hasText: 'Daily Research Digest' }).filter({ hasText: 'Enabled' }).first()).toBeVisible({ timeout: 15_000 })
    const workflowCard = page.locator('.workflow-card', { hasText: 'Daily Research Digest' }).first()
    await expect(workflowCard).toBeVisible()
    await workflowCard.getByRole('button', { name: /Builder/i }).click()

    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible()
    await expect(page.getByText(/Current mode: Scheduled/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Save Schedule/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Webhook trigger' })).toBeVisible()
    await expect(page.locator('code').filter({ hasText: /\/api\/webhooks\/trigger\// })).toBeVisible()

    await page.goto('/evals')
    await expect(page.getByRole('heading', { name: 'Eval Suites' })).toBeVisible()
    await page.getByRole('button', { name: suiteName }).click()
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Compare Models on This Suite' })).toBeVisible()
    await page.locator('select').nth(0).selectOption({ label: 'Compare Model A — gpt-4o-mini' })
    await page.locator('select').nth(1).selectOption({ label: 'Compare Model B — claude-3-5-haiku' })
    await page.getByRole('button', { name: /Run Comparison/i }).click()
    await expect(page.getByText('Compare Model B wins on pass rate and cost.')).toBeVisible()
    await expect(page.getByText('Previous Comparisons')).toBeVisible()
    await expect(page.getByRole('button', { name: /Apply Compare Model B to this agent/i })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Compare Model A' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Compare Model B' })).toBeVisible()
    await page.getByRole('button', { name: /Apply Compare Model B to this agent/i }).click()
    await expect(page.getByText('Winning model applied to this agent')).toBeVisible()
  })
})

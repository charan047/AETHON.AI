import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { loginHelper, uniqueEmail } from './helpers'

async function apiJson(
  request: APIRequestContext,
  path: string,
  {
    method = 'GET',
    token,
    orgId,
    body,
  }: {
    method?: 'GET' | 'POST'
    token: string
    orgId: string
    body?: Record<string, unknown>
  },
) {
  const response = await request.fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Org-Id': orgId,
      'Content-Type': 'application/json',
    },
    data: body,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status()}): ${JSON.stringify(data)}`)
  }
  return data
}

async function createAgent(
  request: APIRequestContext,
  token: string,
  orgId: string,
  name: string,
) {
  return apiJson(request, '/agents', {
    method: 'POST',
    token,
    orgId,
    body: {
      name,
      role: 'Market Researcher',
      description: 'Verification agent',
      system_prompt: 'You are a helpful verification agent.',
      tools: [],
      memory_enabled: false,
      role_slug: 'research_agent',
      autonomy_level: 'supervised',
      seniority_level: 1,
      persona_name: 'Maya',
    },
  })
}

async function createWorkflow(
  request: APIRequestContext,
  token: string,
  orgId: string,
  agentId: string,
  name: string,
) {
  return apiJson(request, '/workflows', {
    method: 'POST',
    token,
    orgId,
    body: {
      name,
      description: 'Verification workflow',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 120, y: 160 },
          data: { label: 'Verifier', agent_id: agentId, role: 'researcher' },
        },
      ],
      edges: [],
      execution_mode: 'sequential',
    },
  })
}

async function runWorkflow(
  request: APIRequestContext,
  token: string,
  orgId: string,
  workflowId: string,
) {
  return apiJson(request, `/executions/workflows/${workflowId}/run`, {
    method: 'POST',
    token,
    orgId,
    body: { input_message: 'Say hello and summarize this verification run.' },
  })
}

async function createSeveralAgents(
  request: APIRequestContext,
  token: string,
  orgId: string,
  count: number,
) {
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    const name = `Scroll Agent ${index} ${Date.now()}`
    names.push(name)
    await createAgent(request, token, orgId, name)
  }
  return names
}

async function assertCanRevealText(page: Page, text: string) {
  const locator = page.getByText(text, { exact: false }).last()
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeVisible()
}

test.describe('Sprint 1 Stability', () => {
  test('core sprint1 routes render safely and key browser flows work', async ({ page, request }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 768 })

    const auth = await loginHelper(
      page,
      request,
      uniqueEmail('sprint1'),
      'TestPass123!',
    )

    const leadAgent = await createAgent(request, auth.accessToken, auth.orgId, `Verification Agent ${Date.now()}`)
    await createSeveralAgents(request, auth.accessToken, auth.orgId, 2)
    const workflow = await createWorkflow(
      request,
      auth.accessToken,
      auth.orgId,
      leadAgent.id,
      `Verification Workflow ${Date.now()}`,
    )
    await runWorkflow(request, auth.accessToken, auth.orgId, workflow.id)

    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'Your Team' })).toBeVisible()
    await assertCanRevealText(page, 'Scroll Agent 1')

    await page.goto('/monitoring')
    await expect(page.getByRole('heading', { name: /monitoring/i })).toBeVisible()
    await expect(page.getByText(workflow.name)).toBeVisible()

    await page.goto('/workflows')
    await expect(page.getByRole('heading', { name: /workflow/i }).first()).toBeVisible()

    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()

    await page.goto('/memory')
    await expect(page.getByRole('heading', { name: /memory/i })).toBeVisible()
    await expect(page.getByText(leadAgent.name)).toBeVisible()

    await page.goto('/marketplace/support-triage')
    await expect(page.getByText('0.0').first()).toBeVisible()
  })

  test('agents route shows a recoverable error state when the api fails', async ({ page, request }) => {
    const auth = await loginHelper(
      page,
      request,
      uniqueEmail('agents-error'),
      'TestPass123!',
    )

    await page.addInitScript(
      ({ token, orgId }) => {
        window.localStorage.setItem('ai-company-os-has-session', '1')
        window.localStorage.setItem('ai-company-os-active-org-id', orgId)
        window.localStorage.setItem('verification-token', token)
      },
      { token: auth.accessToken, orgId: auth.orgId },
    )

    await page.route('**/api/agents', route => route.abort())
    await page.goto('/agents')

    await expect(page.getByText('Could not load agents.')).toBeVisible()
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible()
  })
})

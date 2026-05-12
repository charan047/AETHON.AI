import { expect, test, type APIRequestContext } from '@playwright/test'
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
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status()}): ${JSON.stringify(data)}`)
  }
  return data
}

async function createAgent(request: APIRequestContext, token: string, orgId: string, name: string) {
  return apiJson(request, '/agents', {
    method: 'POST',
    token,
    orgId,
    body: {
      name,
      role: 'Researcher',
      system_prompt: 'You are a reliable monitoring test agent.',
      description: 'Monitoring detail E2E test agent',
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
      description: 'Monitoring detail workflow',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 100, y: 160 },
          data: { label: 'Verifier', agent_id: agentId, role: 'researcher' },
        },
      ],
      edges: [],
      execution_mode: 'sequential',
    },
  })
}

async function createE2EExecution(
  request: APIRequestContext,
  token: string,
  orgId: string,
  workflowId: string,
) {
  return apiJson(request, '/testing/e2e/executions', {
    method: 'POST',
    token,
    orgId,
    body: {
      workflow_id: workflowId,
      status: 'completed',
      input_message: 'Prepare a concise monitoring update.',
      output_message: 'Monitoring drawer verification complete.',
      steps: [
        {
          step_type: 'thought',
          content: 'Maya is reading the monitoring verification task.',
        },
        {
          step_type: 'final_answer',
          content: 'Monitoring drawer verification complete.',
        },
      ],
    },
  })
}

test.describe('Monitoring Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 768 })
  })

  test('clicking execution row opens detail drawer on desktop', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('monitoring-row'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, `Monitor Agent ${Date.now()}`)
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Monitor Workflow ${Date.now()}`)
    await createE2EExecution(request, auth.accessToken, auth.orgId, workflow.id)

    await page.goto('/monitoring')
    const firstRow = page.locator('[data-testid="execution-row"]').first()
    await firstRow.click()
    await expect(page.locator('[data-testid="monitoring-drawer"]')).toBeVisible()
  })

  test('drawer shows execution steps', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('monitoring-steps'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, `Steps Agent ${Date.now()}`)
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Steps Workflow ${Date.now()}`)
    await createE2EExecution(request, auth.accessToken, auth.orgId, workflow.id)

    await page.goto('/monitoring')
    await page.locator('[data-testid="execution-row"]').first().click()
    const drawer = page.locator('[data-testid="monitoring-drawer"]')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('[data-testid="execution-step"]').first()).toBeVisible({ timeout: 5000 })
  })

  test('close button dismisses drawer', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('monitoring-close'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, `Close Agent ${Date.now()}`)
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Close Workflow ${Date.now()}`)
    await createE2EExecution(request, auth.accessToken, auth.orgId, workflow.id)

    await page.goto('/monitoring')
    await page.locator('[data-testid="execution-row"]').first().click()
    await page.click('[data-testid="monitoring-drawer"] button[aria-label="Close"]')
    await expect(page.locator('[data-testid="monitoring-drawer"]')).not.toBeVisible()
  })
})

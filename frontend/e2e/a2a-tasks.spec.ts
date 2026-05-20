import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginHelper } from './helpers'

function authHeaders(orgId: string, accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Org-Id': orgId,
  }
}

async function createAgent(request: APIRequestContext, token: string, orgId: string) {
  const response = await request.post('/api/agents', {
    headers: authHeaders(orgId, token),
    data: {
      name: `A2A UI Agent ${Date.now()}`,
      persona_name: 'Maya',
      role: 'Research Analyst',
      role_slug: 'research_analyst',
      description: 'Handles incoming A2A requests.',
      system_prompt: 'Respond briefly and clearly.',
      model: 'llama-3.1-8b-instant',
      tools: [],
      autonomy_level: 'supervised',
    },
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function createWorkflow(request: APIRequestContext, token: string, orgId: string, agentId: string) {
  const response = await request.post('/api/workflows', {
    headers: authHeaders(orgId, token),
    data: {
      name: `A2A UI Workflow ${Date.now()}`,
      description: 'Single agent workflow for A2A UI test.',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 120, y: 180 },
          data: {
            label: 'Maya',
            agent_id: agentId,
            role: 'research_analyst',
          },
        },
      ],
      edges: [],
      trigger: 'manual',
    },
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function createApiKey(request: APIRequestContext, token: string, orgId: string) {
  const response = await request.post('/api/auth/api-keys?name=A2A%20UI', {
    headers: authHeaders(orgId, token),
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

test.describe('A2A tasks page', () => {
  test('shows incoming task history when A2A task is received', async ({ page, request }) => {
    const { orgId, accessToken } = await loginHelper(page, request)
    const agent = await createAgent(request, accessToken, orgId)
    await createWorkflow(request, accessToken, orgId, agent.id)
    const apiKey = await createApiKey(request, accessToken, orgId)

    const submit = await request.post(`http://127.0.0.1:8001/a2a/agents/${agent.id}/tasks`, {
      headers: {
        'X-A2A-Key': apiKey.api_key,
      },
      data: {
        message: {
          parts: [{ type: 'text', text: 'Say hello from the browser smoke test.' }],
        },
      },
    })
    expect(submit.ok()).toBeTruthy()

    await page.goto('/a2a-tasks')
    await expect(page.getByRole('heading', { name: 'Incoming Agent Requests' })).toBeVisible()
    await expect(page.getByText('Request History')).toBeVisible()
    await expect(page.getByText('Maya').first()).toBeVisible()
    await expect(page.getByText('browser smoke test')).toBeVisible()
    await expect(page.getByText('Output').first()).toBeVisible()
  })
})

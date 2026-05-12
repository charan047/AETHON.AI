import { chromium } from 'playwright'

const APP_URL = 'http://localhost'
const API_URL = 'http://localhost:8001/api'
const PASSWORD = 'TestPass123!'

function uniqueEmail(prefix = 'verify') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
}

async function apiJson(path, { method = 'GET', token, orgId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (orgId) headers['X-Org-Id'] = orgId
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

async function registerAndComplete(plan = 'team') {
  const email = uniqueEmail('user')
  const registerRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      full_name: 'Verification User',
    }),
  })
  const registerData = await registerRes.json()
  if (!registerRes.ok) {
    throw new Error(`register failed: ${JSON.stringify(registerData)}`)
  }
  const token = registerData.access_token
  const orgs = await apiJson('/organizations/me', { token })
  const orgId = orgs[0]?.id
  if (!orgId) throw new Error('No org id returned after registration')

  await apiJson('/testing/e2e/org-plan', {
    method: 'POST',
    token,
    orgId,
    body: { plan },
  })

  const onboarding = await apiJson('/onboarding/status', { token, orgId })
  if (!onboarding.onboarding_completed) {
    await apiJson('/onboarding/company', {
      method: 'POST',
      token,
      orgId,
      body: {
        agency_name: `Verify ${email.split('@')[0]}`,
        what_you_do: 'Verification workspace',
        how_many_clients: '1-5 clients',
        biggest_time_sink: 'Research',
      },
    })
    await apiJson('/onboarding/complete', {
      method: 'POST',
      token,
      orgId,
      body: {},
    })
  }

  return { email, password: PASSWORD, token, orgId }
}

async function loginPage(page, email, password) {
  await page.goto(`${APP_URL}/login`)
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByPlaceholder(/password/i).fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/onboarding'))
}

async function createAgent(token, orgId, overrides = {}) {
  const name = overrides.name || `Agent ${Date.now()}`
  return await apiJson('/agents', {
    method: 'POST',
    token,
    orgId,
    body: {
      name,
      role: overrides.role || 'Market Researcher',
      description: overrides.description || 'Verification agent',
      system_prompt: overrides.system_prompt || 'You are a helpful verification agent.',
      tools: overrides.tools || [],
      role_slug: overrides.role_slug || 'research_agent',
      autonomy_level: overrides.autonomy_level || 'supervised',
      seniority_level: overrides.seniority_level || 1,
      persona_name: overrides.persona_name || 'Maya',
    },
  })
}

async function createWorkflow(token, orgId, agentId, name = `Workflow ${Date.now()}`) {
  return await apiJson('/workflows', {
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

async function runWorkflow(token, orgId, workflowId, inputMessage) {
  return await apiJson(`/executions/workflows/${workflowId}/run`, {
    method: 'POST',
    token,
    orgId,
    body: { input_message: inputMessage },
  })
}

async function waitForCondition(fn, timeoutMs = 15000, intervalMs = 300) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

async function readCompanyChatStream(token, orgId, message) {
  const response = await fetch(`${API_URL}/company/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Org-Id': orgId,
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ message }),
  })
  if (!response.ok || !response.body) {
    throw new Error(`company chat failed (${response.status})`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      events.push(JSON.parse(trimmed))
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer.trim()))
  return events
}

async function main() {
  const results = []
  const browser = await chromium.launch({ headless: true })
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 768 } })
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 768 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  const pageErrors = []
  const consoleErrors = []
  const wsUrls = []
  pageA.on('pageerror', error => pageErrors.push(String(error)))
  pageA.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  pageA.on('websocket', ws => {
    wsUrls.push(ws.url())
  })

  try {
    const userA = await registerAndComplete('team')
    const userB = await registerAndComplete('team')
    await loginPage(pageA, userA.email, userA.password)
    await loginPage(pageB, userB.email, userB.password)

    const validationAgentName = `Verify Agent ${Date.now()}`

    await pageA.goto(`${APP_URL}/agents`)
    await pageA.getByRole('button', { name: /add agent/i }).click()
    await pageA.getByPlaceholder(/agent role/i).fill('Market Researcher')
    await pageA.getByPlaceholder(/system prompt/i).fill('You do research.')
    await pageA.getByRole('button', { name: /add teammate/i }).click()
    await pageA.getByText('Agent name is required').waitFor({ timeout: 5000 })
    results.push(['SPRINT1 empty name toast', true, 'toast visible'])

    await pageA.getByPlaceholder(/agent name/i).fill(validationAgentName)
    await pageA.getByPlaceholder(/agent role/i).fill('')
    await pageA.getByRole('button', { name: /add teammate/i }).click()
    await pageA.getByText('Role is required').waitFor({ timeout: 5000 })
    results.push(['SPRINT1 empty role toast', true, 'toast visible'])

    await pageA.getByPlaceholder(/agent role/i).fill('Market Researcher')
    await pageA.getByPlaceholder(/system prompt/i).fill('')
    await pageA.getByRole('button', { name: /add teammate/i }).click()
    await pageA.getByText('System prompt is required').waitFor({ timeout: 5000 })
    results.push(['SPRINT1 empty system prompt toast', true, 'toast visible'])

    await pageA.getByPlaceholder(/system prompt/i).fill('You are a helpful market researcher.')
    const saveButton = pageA.getByRole('button', { name: /add teammate/i })
    await Promise.allSettled(Array.from({ length: 5 }, () => saveButton.click()))
    let savingVisible = false
    let savingDisabled = false
    try {
      const savingButton = pageA.getByRole('button', { name: /saving/i })
      await savingButton.waitFor({ timeout: 2500 })
      savingVisible = true
      savingDisabled = await savingButton.isDisabled()
    } catch {
      savingVisible = false
      savingDisabled = false
    }
    results.push(['SPRINT3 save button spinner', savingVisible && savingDisabled, savingVisible ? 'Saving… visible and disabled' : 'Saving state not observed before modal closed'])
    await pageA.locator('.agent-card', { hasText: validationAgentName }).first().waitFor({ timeout: 15000 })
    const duplicateCount = await pageA.locator('.agent-card', { hasText: validationAgentName }).count()
    results.push(['SPRINT1/3 valid create closes modal and one card appears', duplicateCount === 1, `agent card count=${duplicateCount}`])

    const verifyAgent = await createAgent(userA.token, userA.orgId, {
      name: 'Market Researcher',
      persona_name: 'Maya',
      role: 'Market Researcher',
      system_prompt: 'You research company and market topics concisely.',
      tools: [],
    })

    const workflow = await createWorkflow(userA.token, userA.orgId, verifyAgent.id, `Verify Workflow ${Date.now()}`)
    const runResponse = await runWorkflow(userA.token, userA.orgId, workflow.id, 'Say hello and summarize this verification run.')
    results.push(['SPRINT4 run workflow API', Boolean(runResponse.execution_id), `execution_id=${runResponse.execution_id}`])

    await pageB.goto(`${APP_URL}/monitoring`)
    await pageB.getByRole('button', { name: /clear/i }).click().catch(() => {})

    await pageA.goto(`${APP_URL}/monitoring`)
    await pageA.locator(`text=${workflow.name}`).waitFor({ timeout: 15000 })
    await pageA.locator(`text=${workflow.name}`).first().click()
    await pageA.waitForURL(new RegExp(`/executions/${runResponse.execution_id}$`), { timeout: 10000 })
    results.push(['SPRINT4 monitoring row navigates to execution detail', true, await pageA.url()])

    const executionPageText = await pageA.textContent('body')
    results.push(['SPRINT4 execution live view opens', /Execution|Workflow Result|failed|completed|running/i.test(executionPageText || ''), 'execution detail rendered'])

    await new Promise(resolve => setTimeout(resolve, 4000))
    const orgBBody = await pageB.textContent('body')
    const leaked = (orgBBody || '').includes(workflow.name) || (orgBBody || '').includes(runResponse.execution_id)
    results.push(['SPRINT6 org B does not see org A execution event', !leaked, leaked ? 'org B saw org A event' : 'no leaked event text'])

    await pageA.goto(`${APP_URL}/company-chat`)
    await pageA.getByPlaceholder(/type a message/i).waitFor({ timeout: 15000 })
    results.push(['SPRINT2 company chat input visible', true, 'input visible'])

    const companyChatEvents = await readCompanyChatStream(userA.token, userA.orgId, '@Maya research Anthropic')
    const companyChatPayload = JSON.stringify(companyChatEvents)
    const companyChatText = companyChatEvents
      .filter(event => event.type === 'text')
      .map(event => String(event.content || ''))
      .join('')
    const companyChatOk = !companyChatPayload.includes('AttributeError')
      && !companyChatPayload.includes('Traceback')
      && (
        companyChatPayload.includes('run_agent')
        || companyChatText.includes("doesn't have a workflow yet")
        || companyChatText.includes('Maya')
      )
    results.push(['SPRINT6 company chat @Maya does not crash', companyChatOk, companyChatText.slice(0, 240) || companyChatPayload.slice(0, 240)])

    await pageA.goto(`${APP_URL}/analytics`)
    await pageA.getByRole('heading', { name: 'Analytics' }).waitFor({ timeout: 15000 })
    results.push(['SPRINT1 analytics loads without crash', true, 'analytics heading visible'])

    await pageA.goto(`${APP_URL}/marketplace/support-triage`)
    await pageA.getByText('0.0').first().waitFor({ timeout: 15000 })
    results.push(['SPRINT1 marketplace detail shows 0.0 rating', true, 'rating visible'])

    await pageA.goto(`${APP_URL}/tools`)
    await pageA.getByRole('heading', { name: 'Custom Tools' }).waitFor({ timeout: 15000 })
    results.push(['SPRINT2 tools page loads', true, 'tools page visible'])

    await pageA.goto(`${APP_URL}/chat/${workflow.id}`)
    await pageA.getByText(workflow.name).waitFor({ timeout: 15000 })
    results.push(['SPRINT2 workflow chat loads', true, 'workflow chat visible'])

    await pageA.goto(`${APP_URL}/settings/models`)
    await pageA.getByText(/models/i).first().waitFor({ timeout: 15000 })
    results.push(['SPRINT2 models page loads', true, 'models page visible'])

    const wsOk = wsUrls.some(url => url.includes('/api/monitoring/ws') && !url.includes(':8000'))
    results.push(['SPRINT5 websocket URL uses same host without :8000', wsOk, wsUrls.join(', ') || 'no ws seen'])

    const reloadUrlBefore = pageA.url()
    await pageA.reload()
    await pageA.waitForFunction(() => !window.location.pathname.includes('/login'))
    results.push(['SPRINT1 refresh session persists via silent refresh', !pageA.url().includes('/login') && pageA.url() === reloadUrlBefore, pageA.url()])

    results.push(['Console errors on main verification page', consoleErrors.length === 0, consoleErrors.join('\n') || 'none'])
    results.push(['Unhandled page errors on main verification page', pageErrors.length === 0, pageErrors.join('\n') || 'none'])
  } finally {
    await pageA.close().catch(() => {})
    await pageB.close().catch(() => {})
    await contextA.close().catch(() => {})
    await contextB.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  for (const [label, pass, detail] of results) {
    console.log(`${pass ? 'PASS' : 'FAIL'} :: ${label} :: ${detail}`)
  }

  const failures = results.filter(([, pass]) => !pass)
  if (failures.length) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

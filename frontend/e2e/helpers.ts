import { expect, type APIRequestContext, type Page } from '@playwright/test'

export function uniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
}

type TestPlan = 'free' | 'solo' | 'team' | 'business' | 'enterprise'

interface AuthHelperOptions {
  plan?: TestPlan
}

export async function registerAndCompleteOnboarding(
  request: APIRequestContext,
  email = uniqueEmail('user'),
  password = 'TestPass123!',
  options: AuthHelperOptions = {},
) {
  const registerResponse = await request.post('/api/auth/register', {
    data: {
      email,
      password,
      full_name: 'E2E Test User',
    },
  })

  expect([200, 201, 409]).toContain(registerResponse.status())

  let accessToken: string | null = null
  if (registerResponse.ok()) {
    const registerBody = await registerResponse.json()
    accessToken = registerBody.access_token
  } else if (registerResponse.status() === 409) {
    const loginResponse = await request.post('/api/auth/login', {
      data: { email, password },
    })
    expect(loginResponse.ok()).toBeTruthy()
    const loginBody = await loginResponse.json()
    accessToken = loginBody.access_token
  }

  expect(accessToken).toBeTruthy()
  const authHeaders = { Authorization: `Bearer ${accessToken}` }

  const orgsResponse = await request.get('/api/organizations/me', {
    headers: authHeaders,
  })
  expect(orgsResponse.ok()).toBeTruthy()
  const orgs = await orgsResponse.json()
  const orgId = orgs[0]?.id as string | undefined
  expect(orgId).toBeTruthy()

  const scopedHeaders = {
    ...authHeaders,
    'X-Org-Id': orgId!,
  }

  if (options.plan && options.plan !== 'free') {
    const planResponse = await request.post('/api/testing/e2e/org-plan', {
      headers: scopedHeaders,
      data: {
        plan: options.plan,
      },
    })
    expect(planResponse.ok()).toBeTruthy()
  }

  const statusResponse = await request.get('/api/onboarding/status', {
    headers: scopedHeaders,
  })
  expect(statusResponse.ok()).toBeTruthy()
  const onboarding = await statusResponse.json()

  if (!onboarding.onboarding_completed) {
    const companyResponse = await request.post('/api/onboarding/company', {
      headers: scopedHeaders,
      data: {
        company_name: `E2E Company ${email.split('@')[0]}`,
        company_description: 'We build software and run reliable end-to-end tests.',
        primary_challenge: 'saving_time',
      },
    })
    expect([200, 201]).toContain(companyResponse.status())
  }

  const completeResponse = await request.post('/api/onboarding/complete', {
    headers: scopedHeaders,
  })
  expect([200, 400]).toContain(completeResponse.status())

  return { email, password }
}

export async function loginHelper(
  page: Page,
  request: APIRequestContext = page.request,
  email = uniqueEmail('login'),
  password = 'TestPass123!',
  options: AuthHelperOptions = {},
) {
  await registerAndCompleteOnboarding(request, email, password, options)
  await page.goto('/')
  if (page.url().includes('/login')) {
    await page.getByPlaceholder(/email/i).fill(email)
    await page.getByPlaceholder(/password/i).fill(password)
    await page.locator('button[type="submit"]').click()
  }
  await page.waitForFunction(() => {
    const path = window.location.pathname
    return !path.includes('/login') && !path.includes('/onboarding')
  })
  return { email, password }
}

export async function createAgentHelper(page: Page, name: string) {
  await page.goto('/agents')
  await page.getByRole('button', { name: /add agent/i }).click()
  await page.getByPlaceholder(/agent name/i).fill(name)
  await page.getByPlaceholder(/agent role/i).fill('Support')
  await page.getByPlaceholder(/agent description/i).fill('Handles support')
  await page.getByPlaceholder(/system prompt/i).fill('You are a helpful support agent.')
  const memoryEnabled = page.locator('label:has-text("memory enabled") input[type="checkbox"]')
  if (await memoryEnabled.isChecked()) {
    await memoryEnabled.uncheck()
  }
  await page.getByRole('button', { name: /add teammate/i }).click()
  await expect(page.locator('.agent-card', { hasText: name }).first()).toBeVisible({ timeout: 10_000 })
}

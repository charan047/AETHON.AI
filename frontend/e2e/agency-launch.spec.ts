import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

function authHeaders(orgId: string, accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Org-Id': orgId,
  }
}

test.describe('Agency OS Launch Integration', () => {
  test('client workspace, public portal, marketplace install, and installed workflow integrate cleanly', async ({
    page,
    request,
    browser,
  }) => {
    const { orgId, accessToken } = await loginHelper(page, request)
    const headers = authHeaders(orgId, accessToken)

    const agentName = `Launch Agent ${Date.now()}`
    const createAgentResponse = await request.post('/api/agents', {
      headers,
      data: {
        name: agentName,
        role: 'Researcher',
        system_prompt: 'You are a careful research agent for client work.',
      },
    })
    expect(createAgentResponse.ok()).toBeTruthy()

    const clientName = `Acme Launch ${Date.now()}`
    const companyName = 'Acme Growth Lab'
    const contactEmail = 'ops@acme.test'

    await page.goto('/clients')
    await page.getByRole('button', { name: /add client/i }).click()
    await page.getByPlaceholder('Acme Growth Lab').fill(clientName)
    await page.getByPlaceholder('Acme Inc.').fill(companyName)
    await page.getByPlaceholder('ops@acme.com').fill(contactEmail)
    await page.getByPlaceholder('What kind of outcomes is this client hiring your agency to deliver?').fill(
      'Competitor research and weekly reporting.',
    )
    await page.getByPlaceholder('Internal notes for your team only.').fill('Launch test client.')
    await page.getByRole('button', { name: /^add client$/i }).last().click()

    await page.waitForURL(/\/clients\/[^/]+$/)
    await expect(page.getByRole('heading', { name: clientName })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AI Team' })).toBeVisible()

    await page.getByRole('button', { name: /assign agent/i }).click()
    await expect(page.getByRole('heading', { name: new RegExp(`Assign agent to ${clientName}`) })).toBeVisible()
    await expect(page.getByText(agentName)).toBeVisible()
    await page
      .locator('div', { hasText: agentName })
      .getByRole('button', { name: /^assign$/i })
      .click()
    await expect(page.getByText(agentName)).toBeVisible()

    await page.getByRole('button', { name: /enable portal/i }).click()
    await expect(page.getByRole('button', { name: /copy link/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /open portal/i })).toBeVisible()

    const clientId = page.url().split('/clients/')[1]
    expect(clientId).toBeTruthy()

    const clientResponse = await request.get(`/api/clients/${clientId}`, { headers })
    expect(clientResponse.ok()).toBeTruthy()
    const clientPayload = await clientResponse.json()
    expect(clientPayload.portal_token).toBeTruthy()

    const portalToken = clientPayload.portal_token as string
    const portalApiResponse = await request.get(`/api/portal/${portalToken}`)
    expect(portalApiResponse.ok()).toBeTruthy()
    const portalPayload = await portalApiResponse.json()
    expect(portalPayload.client_name).toBe(companyName)
    expect(Array.isArray(portalPayload.agents)).toBeTruthy()

    const publicOrigin = new URL(page.url()).origin
    const anonContext = await browser.newContext({ baseURL: publicOrigin })
    const anonPage = await anonContext.newPage()
    await anonPage.goto(`/portal/${portalToken}`)
    await expect(anonPage.getByRole('heading', { name: companyName })).toBeVisible()
    await expect(anonPage.getByRole('heading', { name: 'Your AI Team' })).toBeVisible()
    await expect(anonPage).not.toHaveURL(/login/)
    await anonContext.close()

    const invalidContext = await browser.newContext({ baseURL: publicOrigin })
    const invalidPage = await invalidContext.newPage()
    await invalidPage.goto('/portal/not-a-real-token')
    await expect(invalidPage.getByText('This portal is not available.')).toBeVisible()
    await invalidContext.close()

    const marketplaceResponse = await request.get('/api/marketplace?limit=20')
    expect(marketplaceResponse.ok()).toBeTruthy()
    const marketplacePayload = await marketplaceResponse.json()
    expect(marketplacePayload.total).toBeGreaterThanOrEqual(9)
    expect(
      marketplacePayload.items.some((item: { slug: string }) => item.slug === 'client-reporter'),
    ).toBeTruthy()

    await page.goto('/marketplace/client-reporter')
    await expect(page.getByRole('heading', { name: 'Client Reporter' })).toBeVisible()
    await page.getByRole('button', { name: /install to my company/i }).click()
    await page.getByRole('button', { name: /install now/i }).click()
    await expect(page.getByText('Installed!')).toBeVisible({ timeout: 15_000 })

    const installsResponse = await request.get('/api/marketplace/my-installs', { headers })
    expect(installsResponse.ok()).toBeTruthy()
    const installsPayload = await installsResponse.json()
    const clientReporterInstall = installsPayload.find(
      (install: { listing: { slug: string } }) => install.listing.slug === 'client-reporter',
    )
    expect(clientReporterInstall).toBeTruthy()

    const workflowsResponse = await request.get('/api/workflows', { headers })
    expect(workflowsResponse.ok()).toBeTruthy()
    const workflowsPayload = await workflowsResponse.json()
    expect(
      workflowsPayload.some((workflow: { name: string }) => workflow.name === 'Weekly Client Report'),
    ).toBeTruthy()

    await page.goto('/')
    await expect(page.getByRole('link', { name: /^Dashboard$/ })).toBeVisible()
    await expect(page.getByText('Client Activity', { exact: true })).toBeVisible()
    await expect(page.getByText('Agent Team', { exact: true })).toBeVisible()
  })
})

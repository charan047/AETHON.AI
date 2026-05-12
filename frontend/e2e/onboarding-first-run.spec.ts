import { expect, test } from '@playwright/test'

import { uniqueEmail } from './helpers'

test.describe('Onboarding first run recovery', () => {
  test('first run recovers after refresh and lets the user finish onboarding', async ({ page }) => {
    const email = uniqueEmail('onboarding')
    const password = 'TestPass123!'

    await page.goto('/register')
    await page.getByPlaceholder(/full name/i).fill('Onboarding Test User')
    await page.getByPlaceholder(/email/i).fill(email)
    await page.getByPlaceholder(/^password$/i).fill(password)
    await page.getByRole('button', { name: /create account/i }).click()

    await page.waitForURL('**/onboarding')
    await expect(page.getByRole('button', { name: 'Set up my agency' })).toBeVisible()
    await page.getByRole('button', { name: 'Set up my agency' }).click()

    await expect(page.getByRole('heading', { name: 'Tell us about your agency' })).toBeVisible()
    await page.getByPlaceholder("Maya's AI Agency").fill('North Star Agency')
    await page
      .getByPlaceholder('Content marketing for SaaS companies...')
      .fill('Competitive research and reporting for SaaS clients')
    await page.getByRole('button', { name: '1–5 clients' }).click()
    await page.getByRole('button', { name: 'Research' }).click()
    await page.getByRole('button', { name: /^continue$/i }).click()

    await expect(page.getByRole('heading', { name: 'Deploy your first AI agent' })).toBeVisible()
    await page.getByPlaceholder('Maya').fill('Maya')
    await page.getByPlaceholder('Acme, Notion, Linear').fill('Linear')
    await page.getByRole('button', { name: /deploy maya/i }).click()

    await expect(page.getByRole('heading', { name: 'Your agent is working' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your agent is working' })).toBeVisible()

    const finishButton = page.getByRole('button', { name: /open my agency dashboard/i })
    await expect(finishButton).toBeEnabled({ timeout: 45_000 })
    await finishButton.click()

    await page.waitForURL(url => url.pathname === '/')
    await expect(page.getByRole('link', { name: /^Clients$/ })).toBeVisible()
  })
})

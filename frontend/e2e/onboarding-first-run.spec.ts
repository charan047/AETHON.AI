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
    await expect(page.getByRole('heading', { name: 'Your AI agency team.' })).toBeVisible()
    await page.getByRole('button', { name: /see it in action/i }).click()

    await expect(page.getByRole('heading', { name: 'Watch your first agent work' })).toBeVisible()
    await page.getByRole('button', { name: /start research/i }).click()
    await expect(page.getByTestId('execution-step').first()).toBeVisible({ timeout: 45_000 })

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Watch your first agent work' })).toBeVisible()
    await expect(page.getByTestId('execution-step').first()).toBeVisible({ timeout: 45_000 })

    await expect(page.getByText('Your first research brief is ready.')).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: /continue setup/i }).click()

    await expect(page.getByRole('heading', { name: 'Name your agency' })).toBeVisible()
    await page.getByLabel('Your agency name').fill('North Star Agency')
    await page
      .getByLabel('What kind of work do you do?')
      .fill('Competitive research and reporting for SaaS clients')
    await page.getByRole('button', { name: /^continue$/i }).click()

    await expect(page.getByRole('heading', { name: 'Your first team member' })).toBeVisible()
    await page.getByRole('button', { name: /use this agent/i }).click()

    await expect(page.getByRole('heading', { name: 'Your agency is running.' })).toBeVisible()
    await page.getByRole('button', { name: /open dashboard/i }).click()

    await page.waitForURL(url => url.pathname === '/')
    await expect(page.getByRole('link', { name: /^Clients$/ })).toBeVisible()
  })
})

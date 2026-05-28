import { expect, test } from '@playwright/test'
import { registerAndCompleteOnboarding, uniqueEmail } from './helpers'

test.describe('Dashboard Shell', () => {
  test('renders the agency dashboard shell on the live app', async ({ page, request }) => {
    const email = uniqueEmail('dashboard')
    const password = 'TestPass123!'
    await registerAndCompleteOnboarding(request, email, password)

    await page.goto('/login')
    await page.getByLabel(/^email$/i).fill(email)
    await page.getByLabel(/^password$/i).fill(password)
    await page.locator('button[type="submit"]').click()

    await page.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/onboarding'))
    await expect(page.getByText('Aethon')).toBeVisible()
    await expect(page.getByText('Agency OS')).toBeVisible()
    await expect(page.getByRole('link', { name: /^Clients$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Dashboard$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Agency Chat/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Agents$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Processes/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Runs$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Approvals$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Settings$/ })).toBeVisible()

    await expect(page.getByText('Client Activity', { exact: true })).toBeVisible()
    await expect(page.getByText('Agent Team', { exact: true })).toBeVisible()
    await expect(page.getByRole('main').getByText('Approvals', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder(/tell your agency what to do/i)).toBeVisible()
  })
})

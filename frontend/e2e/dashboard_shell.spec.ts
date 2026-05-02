import { expect, test } from '@playwright/test'
import { registerAndCompleteOnboarding, uniqueEmail } from './helpers'

test.describe('Dashboard Shell', () => {
  test('renders the Mission OS sidebar and Company Brain dashboard on the live app', async ({ page, request }) => {
    const email = uniqueEmail('dashboard')
    const password = 'TestPass123!'
    await registerAndCompleteOnboarding(request, email, password)

    await page.goto('http://127.0.0.1/login')
    await page.getByPlaceholder(/email/i).fill(email)
    await page.getByPlaceholder(/password/i).fill(password)
    await page.locator('button[type="submit"]').click()

    await page.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/onboarding'))
    await expect(page.getByText('AETHON')).toBeVisible()
    await expect(page.getByText('AI Operating System')).toBeVisible()
    await expect(page.getByRole('link', { name: /Command Center/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /All Agents/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Workflows/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Executions/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Company Profile/i })).toBeVisible()

    await expect(page.getByText(/Brain$/)).toBeVisible()
    await expect(page.getByText('Activity Feed')).toBeVisible()
    await expect(page.getByText('Agent Roster')).toBeVisible()
    await expect(page.getByText('Recent Executions')).toBeVisible()
  })
})

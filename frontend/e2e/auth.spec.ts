import { test, expect } from '@playwright/test'
import { loginHelper, registerAndCompleteOnboarding, uniqueEmail } from './helpers'

test.describe('Authentication Flow', () => {
  test('redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/.*login/)
  })

  test('register new user and land on onboarding', async ({ page }) => {
    const email = uniqueEmail('register')
    await page.goto('/register')
    await page.getByLabel(/full name/i).fill('New User')
    await page.getByLabel(/^email$/i).fill(email)
    await page.getByLabel(/^password$/i).fill('TestPass123!')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/onboarding|dashboard|\/$/)
  })

  test('login with valid credentials', async ({ page, request }) => {
    const { email, password } = await registerAndCompleteOnboarding(request, uniqueEmail('logintest'))

    await page.goto('/login')
    await page.getByLabel(/^email$/i).fill(email)
    await page.getByLabel(/^password$/i).fill(password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/onboarding'))
    await expect(page).toHaveURL(/agents|workflows|monitoring|approvals|analytics|billing|\/$/)
  })

  test('show error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/^email$/i).fill('wrong@test.com')
    await page.getByLabel(/^password$/i).fill('WrongPass123!')
    await page.locator('button[type="submit"]').click()
    await expect(page.getByText('Invalid email or password')).toBeVisible()
  })

  test('logout clears session', async ({ page }) => {
    await loginHelper(page)
    await page.getByRole('button', { name: /open_source · owner/i }).click()
    await page.getByRole('button', { name: /sign out/i }).click()
    await page.goto('/agents')
    await expect(page).toHaveURL(/login/)
  })
})

import { expect, test } from '@playwright/test'
import { createAgentHelper, loginHelper, uniqueEmail } from './helpers'

test('task 9 command palette, toasts, and empty states work live', async ({ page, request }) => {
  const consoleErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  const email = uniqueEmail('task9')
  await loginHelper(page, request, email)

  await page.goto('/agents')
  await expect(page.getByText('Your first agent is waiting')).toBeVisible()
  await expect(page.getByRole('button', { name: /browse marketplace/i })).toBeVisible()

  await page.goto('/workflows')
  await expect(page.getByText('Automate your first task')).toBeVisible()

  await page.goto('/monitoring')
  await expect(page.getByText('Recent Executions')).toBeVisible()
  await expect(page.getByText(/live/i)).toBeVisible()

  await page.goto('/')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await expect(page.getByPlaceholder(/type a command or search/i)).toBeVisible()

  await page.getByPlaceholder(/type a command or search/i).fill('agent')
  await expect(page.getByText('Go to Agents')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/agents')

  const agentName = `Task9 Agent ${Date.now()}`
  await createAgentHelper(page, agentName)
  await expect(page.getByText('Agent created')).toBeVisible()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await page.getByPlaceholder(/type a command or search/i).fill(agentName)
  await expect(page.getByText(`Open ${agentName}`)).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/agents**')

  expect(consoleErrors).toEqual([])
})

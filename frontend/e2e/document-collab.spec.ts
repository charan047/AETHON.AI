import { test, expect } from '@playwright/test'
import { loginHelper, uniqueEmail } from './helpers'

test.describe('Collaborative Documents', () => {
  test('syncs across tabs, persists after refresh, and streams agent output', async ({ page, request, context }) => {
    const { accessToken, orgId } = await loginHelper(page, request, uniqueEmail('doccollab'))

    const createResponse = await request.post('/api/files/document', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Org-Id': orgId,
      },
      data: {
        name: `Realtime Brief ${Date.now()}`,
        description: 'Live collaborative document regression',
      },
    })
    expect(createResponse.ok()).toBeTruthy()
    const created = await createResponse.json()
    const fileId = created.file_id as string

    await page.goto(`/files/${fileId}`)
    await expect(page.getByRole('heading', { name: /realtime brief/i })).toBeVisible()
    await expect(page.getByTestId('document-editor')).toBeVisible()

    const secondPage = await context.newPage()
    await secondPage.goto(`/files/${fileId}`)
    await expect(secondPage.getByTestId('document-editor')).toBeVisible()

    const firstEditor = page.getByTestId('document-editor')
    const secondEditor = secondPage.getByTestId('document-editor')

    const collaborativeText = `Shared notes ${Date.now()}`
    await firstEditor.click()
    await page.keyboard.type(collaborativeText)

    await expect(secondEditor).toContainText(collaborativeText, { timeout: 15_000 })

    await secondPage.reload()
    await expect(secondEditor).toContainText(collaborativeText, { timeout: 15_000 })

    const agentDraft = `Agent summary ${Date.now()}. This should arrive live in the document.`
    await page.getByTestId('agent-draft-input').fill(agentDraft)
    await page.getByTestId('agent-draft-button').click()

    await expect(secondEditor).toContainText('Agent summary', { timeout: 15_000 })
    await expect(secondEditor).toContainText('This should arrive live in the document.', { timeout: 15_000 })

    await secondPage.close()
  })
})

import { expect, test } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

test.describe('Settings pages', () => {
  test('cto settings saves authority, adds memory, and marks a task complete', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('settings-cto'))

    let authority = {
      auto_approve_portal: true,
      auto_approve_patterns: false,
      auto_run_workflows: true,
      auto_create_missions: true,
      max_auto_spend_usd: 0,
      auto_approve_action_types: [],
    }
    let memories = [
      {
        id: 'memory-1',
        memory_type: 'client_preference',
        content: 'Acme always wants bullet points',
        entity_name: 'Acme',
        entity_type: 'client',
      },
    ]
    let tasks = [
      {
        id: 'task-1',
        request: 'Handle Acme weekly deliverables',
        plan: '1. Maya research 2. Jordan write 3. Portal delivery',
        status: 'monitoring',
        conversation_id: 'conv-1',
        ceo_action_needed: null,
        outcome_summary: null,
      },
    ]

    await page.route('**/api/company/company-chat/cto/authority', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authority) })
        return
      }
      if (route.request().method() === 'PATCH') {
        authority = { ...authority, ...(route.request().postDataJSON() as Record<string, unknown>) } as typeof authority
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authority) })
        return
      }
      await route.continue()
    })

    await page.route('**/api/company/company-chat/cto/memories', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ memories }) })
        return
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, string>
        const memory = {
          id: `memory-${memories.length + 1}`,
          memory_type: body.memory_type || 'general',
          content: body.content,
          entity_name: body.entity_name || null,
          entity_type: body.entity_type || null,
        }
        memories = [...memories, memory]
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ memory }) })
        return
      }
      await route.continue()
    })

    await page.route('**/api/company/company-chat/cto/memories/*', async route => {
      if (route.request().method() === 'DELETE') {
        const id = route.request().url().split('/').pop()
        memories = memories.filter(memory => memory.id !== id)
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true }) })
        return
      }
      await route.continue()
    })

    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks }) })
    })

    await page.route('**/api/company/company-chat/cto/tasks/*', async route => {
      if (route.request().method() === 'PATCH') {
        const id = route.request().url().split('/').pop()
        const body = route.request().postDataJSON() as Record<string, string>
        tasks = tasks.map(task =>
          task.id === id
            ? {
                ...task,
                status: body.status || task.status,
                outcome_summary: body.outcome_summary || task.outcome_summary,
              }
            : task,
        )
        const task = tasks.find(item => item.id === id)
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task }) })
        return
      }
      await route.continue()
    })

    await page.goto('/settings/cto')

    await expect(page.getByRole('heading', { name: 'CTO Settings' })).toBeVisible()
    await expect(page.getByText('Acme always wants bullet points')).toBeVisible()
    await expect(page.getByText('Handle Acme weekly deliverables')).toBeVisible()

    await page.getByRole('switch', { name: /Learn from approval patterns/i }).click()
    await page.getByRole('button', { name: /Save Authority/i }).click()
    await expect(page.getByText('CTO authority saved')).toBeVisible()

    await page.getByLabel('The CTO should know that...').fill('Beta Corp prefers portal delivery')
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.getByText('CTO memory saved')).toBeVisible()
    await expect(page.getByText('Beta Corp prefers portal delivery')).toBeVisible()

    await page.getByRole('button', { name: /Mark Complete/i }).click()
    await expect(page.getByText('CTO task updated')).toBeVisible()
    await expect(page.getByText('complete', { exact: true })).toBeVisible()
  })

  test('organization settings can save updated org details', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('settings-org'))
    let orgName = 'Updated QA Org'

    await page.route(`**/api/organizations/${auth.orgId}`, async route => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as Record<string, string>
        orgName = body.name || orgName
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: auth.orgId,
            name: orgName,
            slug: body.slug || 'updated-qa-org',
            timezone: body.timezone || 'UTC',
            logo_url: body.logo_url || null,
            role: 'owner',
          }),
        })
        return
      }
      await route.continue()
    })
    await page.route('**/api/organizations/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: auth.orgId,
            name: orgName,
            slug: 'updated-qa-org',
            timezone: 'UTC',
            logo_url: null,
            role: 'owner',
          },
        ]),
      })
    })

    await page.goto('/settings/org')
    await expect(page.getByRole('heading', { name: 'Organization Settings' })).toBeVisible()

    await page.getByLabel('Organization name').fill(orgName)
    await page.getByLabel('Workspace slug').fill('updated-qa-org')
    await page.getByRole('button', { name: /Save Changes/i }).click()

    await expect(page.getByText('Organization updated')).toBeVisible()
    await expect(page.getByLabel('Organization name')).toHaveValue(orgName)
  })

  test('team settings supports invite modal and pending invites list', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('settings-team'))
    const members = [
      { id: 'member-1', user_id: auth.orgId + '-owner', full_name: 'Owner User', email: 'owner@test.com', role: 'owner' },
      { id: 'member-2', user_id: 'user-2', full_name: 'Alex Agent', email: 'alex@test.com', role: 'member' },
    ]
    let invites = [
      { id: 'invite-1', email: 'pending@test.com', role: 'member', created_at: new Date().toISOString() },
    ]

    await page.route(`**/api/organizations/${auth.orgId}/members`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
    })
    await page.route(`**/api/organizations/${auth.orgId}/invites`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invites) })
        return
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { email: string; role: string; message?: string }
        const invite = {
          id: `invite-${invites.length + 1}`,
          email: body.email,
          role: body.role,
          created_at: new Date().toISOString(),
        }
        invites = [...invites, invite]
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invite) })
        return
      }
      await route.continue()
    })

    await page.goto('/settings/team')
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible()
    await expect(page.getByText('Alex Agent')).toBeVisible()
    await expect(page.getByText('pending@test.com')).toBeVisible()

    await page.getByRole('button', { name: /Invite Member/i }).click()
    await expect(page.getByRole('heading', { name: /Invite member/i })).toBeVisible()
    await page.getByLabel('Email').fill('newinvite@test.com')
    await page.getByRole('button', { name: 'Admin' }).click()
    await page.getByRole('button', { name: /Send Invite/i }).click()

    await expect(page.getByText('Invite sent to newinvite@test.com')).toBeVisible()
    await expect(page.getByText('newinvite@test.com', { exact: true })).toBeVisible()
  })

  test('notifications settings saves toggles and custom email with smtp guidance', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('settings-notifications'))

    let prefs = {
      email_on_approval_needed: true,
      email_on_execution_complete: false,
      email_on_autonomy_change: true,
      daily_digest_enabled: true,
      daily_digest_time: '08:00',
      notification_email: '',
    }

    await page.route('**/api/notifications/preferences', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) })
        return
      }
      if (route.request().method() === 'PUT') {
        prefs = route.request().postDataJSON() as typeof prefs
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) })
        return
      }
      await route.continue()
    })
    await page.route('**/api/integrations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await page.goto('/settings/notifications')

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await expect(page.getByText('Configure SMTP to send email notifications')).toBeVisible()

    await page.getByLabel('Custom email').fill('ops@example.com')
    await page.getByRole('button', { name: 'Save Preferences' }).click()

    await expect(page.getByText('Notification preferences saved')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Custom email')).toHaveValue('ops@example.com')
  })
})

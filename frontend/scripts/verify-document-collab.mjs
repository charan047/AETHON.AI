import { HocuspocusProvider } from '@hocuspocus/provider'
import WebSocket from 'ws'
import * as Y from 'yjs'

const BASE_URL = process.env.AETHON_BASE_URL || 'http://127.0.0.1'
const API_BASE_URL = `${BASE_URL}/api`
const HOCUSPOCUS_URL = process.env.AETHON_HOCUSPOCUS_URL || 'ws://127.0.0.1:1234'

function uniqueEmail(prefix = 'doccollab') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${text}`)
  }
  return body
}

async function bootstrapOrg() {
  const email = uniqueEmail()
  const password = 'TestPass123!'
  const auth = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      full_name: 'Document Collaboration Verifier',
    }),
  })

  const authHeaders = {
    Authorization: `Bearer ${auth.access_token}`,
  }

  const orgs = await api('/organizations/me', {
    headers: authHeaders,
  })
  const orgId = orgs[0]?.id
  if (!orgId) {
    throw new Error('No organization returned for registered user')
  }

  const scopedHeaders = {
    ...authHeaders,
    'X-Org-Id': orgId,
  }

  await api('/onboarding/company', {
    method: 'POST',
    headers: scopedHeaders,
    body: JSON.stringify({
      agency_name: `Realtime Docs ${email.split('@')[0]}`,
      what_you_do: 'We validate live collaborative workflows.',
      how_many_clients: '1-5 clients',
      biggest_time_sink: 'Knowledge capture',
    }),
  }).catch(() => null)

  await api('/onboarding/complete', {
    method: 'POST',
    headers: scopedHeaders,
    body: JSON.stringify({}),
  }).catch(() => null)

  return {
    token: auth.access_token,
    orgId,
    headers: scopedHeaders,
  }
}

function appendParagraph(fragment, text) {
  const paragraph = new Y.XmlElement('paragraph')
  const textNode = new Y.XmlText()
  paragraph.insert(0, [textNode])
  fragment.push([paragraph])
  textNode.insert(0, text)
}

function fragmentContains(fragment, text) {
  return fragment.toString().includes(text)
}

function waitFor(condition, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`))
        return
      }
      setTimeout(tick, 100)
    }
    tick()
  })
}

async function createProvider(room, token) {
  const document = new Y.Doc()
  const provider = new HocuspocusProvider({
    url: HOCUSPOCUS_URL,
    name: room,
    document,
    token,
    WebSocketPolyfill: WebSocket,
    preserveTrailingSlash: true,
  })

  await waitFor(() => provider.isAuthenticated, 10_000, `${room} authentication`)
  await waitFor(() => provider.isSynced, 10_000, `${room} sync`)

  return {
    provider,
    document,
    fragment: document.getXmlFragment('default'),
  }
}

async function main() {
  const { token, headers } = await bootstrapOrg()

  const created = await api('/files/document', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Live Collaboration ${Date.now()}`,
      description: 'End-to-end collaborative verification',
    }),
  })

  const fileId = created.file_id
  const room = created.collab_room
  if (!fileId || !room) {
    throw new Error('Document creation did not return file_id and collab_room')
  }

  const first = await createProvider(room, token)
  const second = await createProvider(room, token)

  const sharedText = `Shared notes ${Date.now()}`
  first.document.transact(() => {
    appendParagraph(first.fragment, sharedText)
  })

  await waitFor(
    () => fragmentContains(second.fragment, sharedText),
    15_000,
    'cross-tab sync',
  )

  second.provider.destroy()
  second.document.destroy()

  const third = await createProvider(room, token)
  await waitFor(
    () => fragmentContains(third.fragment, sharedText),
    15_000,
    'document persistence after reconnect',
  )

  const agentText = `Agent summary ${Date.now()}. This should appear live.`
  await api(`/files/${fileId}/agent-write`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content: agentText,
      agent_name: 'Aethon Drafting Agent',
    }),
  })

  await waitFor(
    () => fragmentContains(third.fragment, 'Agent summary') && fragmentContains(third.fragment, 'This should appear live.'),
    15_000,
    'agent live write',
  )

  console.log(JSON.stringify({
    ok: true,
    fileId,
    room,
    checks: {
      created: true,
      syncedAcrossPeers: true,
      persistedAfterReconnect: true,
      agentWriteStreamed: true,
    },
  }, null, 2))

  first.provider.destroy()
  first.document.destroy()
  third.provider.destroy()
  third.document.destroy()
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

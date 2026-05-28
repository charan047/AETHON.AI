import http from 'node:http'

import jwt from 'jsonwebtoken'
import pg from 'pg'
import * as Y from 'yjs'
import Redis from 'ioredis'
import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { Redis as RedisExtension } from '@hocuspocus/extension-redis'

const port = Number(process.env.PORT || 1234)
const apiPort = Number(process.env.HOCUSPOCUS_API_PORT || 1235)
const jwtSecret = process.env.JWT_SECRET_KEY || process.env.HOCUSPOCUS_SECRET || ''
const internalSecret = process.env.HOCUSPOCUS_SECRET || process.env.JWT_SECRET_KEY || ''

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379/2')

await pool.query(`
  CREATE TABLE IF NOT EXISTS collab_documents (
    room VARCHAR(255) PRIMARY KEY,
    yjs_state TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`)

function chunkContent(content) {
  return content
    .split(/(\n\n|(?<=[.!?])\s+)/g)
    .map(part => part.trim())
    .filter(Boolean)
}

function appendParagraph(fragment, text) {
  const paragraph = new Y.XmlElement('paragraph')
  const textNode = new Y.XmlText()
  paragraph.insert(0, [textNode])
  fragment.push([paragraph])
  textNode.insert(0, text)
}

async function streamAgentWrite(server, room, content, agentName) {
  const connection = await server.openDirectConnection(room, {
    role: 'agent',
    name: agentName,
  })

  try {
    const parts = chunkContent(content)
    for (const part of parts) {
      await connection.transact(document => {
        const fragment = document.getXmlFragment('default')
        appendParagraph(fragment, part)
      })
      await new Promise(resolve => setTimeout(resolve, 90))
    }
  } finally {
    await connection.disconnect()
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

const server = Server.configure({
  port,
  extensions: [
    new RedisExtension({
      redis,
    }),
    new Database({
      fetch: async ({ documentName }) => {
        const result = await pool.query(
          'SELECT yjs_state FROM collab_documents WHERE room = $1',
          [documentName],
        )
        if (result.rows.length === 0 || !result.rows[0].yjs_state) {
          return null
        }
        return Buffer.from(result.rows[0].yjs_state, 'hex')
      },
      store: async ({ documentName, state }) => {
        await pool.query(
          `INSERT INTO collab_documents (room, yjs_state, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (room) DO UPDATE
           SET yjs_state = EXCLUDED.yjs_state,
               updated_at = NOW()`,
          [documentName, Buffer.from(state).toString('hex')],
        )
        await pool.query("SELECT pg_notify('document_saved', $1)", [documentName])
      },
    }),
  ],
  async onAuthenticate({ token }) {
    if (!token) {
      throw new Error('Unauthorized')
    }
    if (!jwtSecret) {
      return { token }
    }
    return jwt.verify(token, jwtSecret, { algorithms: ['HS256'] })
  },
  async onConnect({ documentName }) {
    console.log(`Client connected to ${documentName}`)
  },
  async onDisconnect({ documentName }) {
    console.log(`Client disconnected from ${documentName}`)
  },
})

await server.listen()
console.log(`Hocuspocus listening on :${port}`)

const apiServer = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (req.method === 'POST' && req.url === '/agent-write') {
    try {
      const providedSecret = req.headers['x-hocuspocus-secret']
      if (internalSecret && providedSecret !== internalSecret) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Unauthorized' }))
        return
      }

      const body = await readJsonBody(req)
      const room = String(body.room || '').trim()
      const content = String(body.content || '').trim()
      const agentName = String(body.agent_name || 'Aethon Agent').trim()

      if (!room || !content) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'room and content are required' }))
        return
      }

      await streamAgentWrite(server, room, content, agentName)

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, room }))
    } catch (error) {
      console.error('agent-write failed', error)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'Agent write failed' }))
    }
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ detail: 'Not found' }))
})

apiServer.listen(apiPort, () => {
  console.log(`Hocuspocus agent API listening on :${apiPort}`)
})

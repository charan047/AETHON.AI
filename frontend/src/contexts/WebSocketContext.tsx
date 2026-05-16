import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import type { WsEvent } from '../types'
import { useAuth } from './AuthContext'

function buildWsBaseUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (envUrl) return envUrl
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/monitoring/ws`
}

const WS_BASE_URL = buildWsBaseUrl()

interface WsContextValue {
  events: WsEvent[]
  lastEvent: WsEvent | null
  connected: boolean
  isConnected: boolean
  clearEvents: () => void
  subscribe: (channel: string, handler: (msg: WsEvent) => void) => void
  unsubscribe: (channel: string) => void
}

const WsContext = createContext<WsContextValue>({
  events: [],
  lastEvent: null,
  connected: false,
  isConnected: false,
  clearEvents: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
})

export function WsProvider({ children }: { children: ReactNode }) {
  const { accessToken, activeOrg } = useAuth()
  const [events, setEvents] = useState<WsEvent[]>([])
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelHandlers = useRef(new Map<string, (msg: WsEvent) => void>())
  const pendingSubscriptions = useRef(new Map<string, (msg: WsEvent) => void>())

  const handleGlobalEvent = useCallback((event: WsEvent) => {
    if (!event || typeof event.type !== 'string' || !event.type.trim()) return
    setLastEvent(event)
    setEvents(prev => [...prev.slice(-499), event])
  }, [])

  const connect = useCallback(() => {
    if (!accessToken || !activeOrg?.id) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const params = new URLSearchParams({ token: accessToken })
    params.set('org_id', activeOrg.id)
    const ws = new WebSocket(`${WS_BASE_URL}?${params.toString()}`)
    wsRef.current = ws
    ws.onopen = () => {
      setConnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (activeOrg?.id) {
        ws.send(JSON.stringify({ action: 'subscribe', channel: `org:${activeOrg.id}` }))
      }
      for (const [channel, handler] of pendingSubscriptions.current.entries()) {
        channelHandlers.current.set(channel, handler)
      }
      pendingSubscriptions.current.clear()
      for (const channel of channelHandlers.current.keys()) {
        ws.send(JSON.stringify({ action: 'subscribe', channel }))
      }
    }
    ws.onmessage = (e) => {
      try {
        const rawEvent = JSON.parse(e.data) as WsEvent
        const normalizedType =
          (typeof rawEvent.type === 'string' && rawEvent.type.trim())
            ? rawEvent.type
            : (typeof rawEvent.event === 'string' && rawEvent.event.trim())
              ? rawEvent.event
              : ''

        if (!normalizedType) return

        const event = { ...rawEvent, type: normalizedType } as WsEvent

        if (event.execution_id) {
          const channel = `execution:${event.execution_id}`
          const handler = channelHandlers.current.get(channel)
          if (handler) {
            handler(event)
            return
          }
        }

        if (event.event === 'subscribed' || event.event === 'unsubscribed') {
          return
        }

        handleGlobalEvent(event)
      } catch {}
    }
    ws.onclose = () => {
      setConnected(false)
      if (accessToken && activeOrg?.id) reconnectTimer.current = setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
  }, [accessToken, activeOrg?.id, handleGlobalEvent])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
      channelHandlers.current.clear()
      pendingSubscriptions.current.clear()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  useEffect(() => {
    setEvents([])
    setLastEvent(null)
  }, [activeOrg?.id])

  const clearEvents = useCallback(() => setEvents([]), [])
  const subscribe = useCallback((channel: string, handler: (msg: WsEvent) => void) => {
    const socket = wsRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pendingSubscriptions.current.set(channel, handler)
      return
    }

    channelHandlers.current.set(channel, handler)
    socket.send(JSON.stringify({ action: 'subscribe', channel }))
  }, [])

  const unsubscribe = useCallback((channel: string) => {
    channelHandlers.current.delete(channel)
    pendingSubscriptions.current.delete(channel)

    const socket = wsRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: 'unsubscribe', channel }))
    }
  }, [])

  return (
    <WsContext.Provider value={{ events, lastEvent, connected, isConnected: connected, clearEvents, subscribe, unsubscribe }}>
      {children}
    </WsContext.Provider>
  )
}

export function useWebSocket() {
  return useContext(WsContext)
}

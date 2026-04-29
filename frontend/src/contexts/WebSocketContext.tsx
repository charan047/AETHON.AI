import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import type { WsEvent } from '../types'
import { useAuth } from './AuthContext'

const WS_BASE_URL = `ws://${window.location.hostname}:8000/api/monitoring/ws`

interface WsContextValue {
  events: WsEvent[]
  lastEvent: WsEvent | null
  connected: boolean
  clearEvents: () => void
}

const WsContext = createContext<WsContextValue>({
  events: [],
  lastEvent: null,
  connected: false,
  clearEvents: () => {},
})

export function WsProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth()
  const [events, setEvents] = useState<WsEvent[]>([])
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (!accessToken) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(`${WS_BASE_URL}?token=${encodeURIComponent(accessToken)}`)
    wsRef.current = ws
    ws.onopen = () => { setConnected(true); if (reconnectTimer.current) clearTimeout(reconnectTimer.current) }
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WsEvent
        setLastEvent(event)
        setEvents(prev => [...prev.slice(-499), event])
      } catch {}
    }
    ws.onclose = () => {
      setConnected(false)
      if (accessToken) reconnectTimer.current = setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
  }, [accessToken])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  const clearEvents = useCallback(() => setEvents([]), [])
  return <WsContext.Provider value={{ events, lastEvent, connected, clearEvents }}>{children}</WsContext.Provider>
}

export function useWebSocket() {
  return useContext(WsContext)
}

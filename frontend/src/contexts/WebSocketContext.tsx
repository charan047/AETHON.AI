import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import type { WsEvent } from '../types'

const WS_URL = `ws://${window.location.hostname}:8000/api/monitoring/ws`

interface WsContextValue {
  events: WsEvent[]
  connected: boolean
  clearEvents: () => void
}

const WsContext = createContext<WsContextValue>({ events: [], connected: false, clearEvents: () => {} })

export function WsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<WsEvent[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => { setConnected(true); if (reconnectTimer.current) clearTimeout(reconnectTimer.current) }
    ws.onmessage = (e) => {
      try { setEvents(prev => [...prev.slice(-499), JSON.parse(e.data) as WsEvent]) } catch {}
    }
    ws.onclose = () => { setConnected(false); reconnectTimer.current = setTimeout(connect, 3000) }
    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => { if (reconnectTimer.current) clearTimeout(reconnectTimer.current); wsRef.current?.close() }
  }, [connect])

  const clearEvents = useCallback(() => setEvents([]), [])
  return <WsContext.Provider value={{ events, connected, clearEvents }}>{children}</WsContext.Provider>
}

export function useWebSocket() {
  return useContext(WsContext)
}

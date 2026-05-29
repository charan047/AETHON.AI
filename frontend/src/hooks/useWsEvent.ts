import { useEffect, useRef } from 'react'
import { useWebSocket } from '../contexts/WebSocketContext'
import type { WsEvent } from '../types'

export function useWsEvent(type: string, handler: (event: WsEvent) => void) {
  const { lastEvent } = useWebSocket()
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!lastEvent || lastEvent.type !== type) return
    handlerRef.current(lastEvent)
  }, [lastEvent, type])
}

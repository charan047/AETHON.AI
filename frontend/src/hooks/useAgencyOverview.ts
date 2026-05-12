import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { agencyApi } from '../api/client'
import { useWebSocket } from './useWebSocket'
import type { AgencyOverview } from '../types'

export function useAgencyOverview() {
  const { lastEvent } = useWebSocket()
  const [overview, setOverview] = useState<AgencyOverview | null>(null)

  const query = useQuery({
    queryKey: ['agency-overview'],
    queryFn: agencyApi.overview,
    refetchInterval: 20_000,
    staleTime: 10_000,
  })

  useEffect(() => {
    if (query.data) {
      setOverview(query.data)
    }
  }, [query.data])

  useEffect(() => {
    if (!lastEvent) return
    const eventType = lastEvent.event || lastEvent.type
    if (eventType !== 'new_approval_request') return

    setOverview(current => {
      if (!current) return current
      const riskLevel = String(lastEvent.risk_level || 'medium')
      const nextItem = {
        id: String(lastEvent.approval_id || `approval-${Date.now()}`),
        type: 'agent' as const,
        title: String(lastEvent.title || 'New approval request'),
        risk_level: riskLevel,
        agent_name: String(lastEvent.agent_name || 'Agent'),
        created_at: String(lastEvent.timestamp || new Date().toISOString()),
      }
      const withoutDuplicate = current.approvals.list.filter(item => item.id !== nextItem.id)
      return {
        ...current,
        approvals: {
          pending: current.approvals.pending + 1,
          critical:
            current.approvals.critical + (riskLevel === 'high' || riskLevel === 'critical' ? 1 : 0),
          list: [nextItem, ...withoutDuplicate].slice(0, 3),
        },
      }
    })
  }, [lastEvent])

  const suggestedClient = useMemo(
    () => overview?.clients.list.find(client => !client.last_activity) || null,
    [overview],
  )

  return {
    overview,
    suggestedClient,
    loading: query.isLoading && !overview,
    isError: query.isError && !overview,
    refetch: query.refetch,
  }
}

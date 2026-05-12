import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '../api/client'
import { useWebSocket } from './useWebSocket'
import type { DashboardSummary } from '../types'

export function useDashboard() {
  const { events } = useWebSocket()
  const [teamStatus, setTeamStatus] = useState<DashboardSummary['team_status'] | null>(null)
  const query = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (query.data?.team_status) setTeamStatus(query.data.team_status)
  }, [query.data?.team_status])

  useEffect(() => {
    const last = events[events.length - 1]
    if (!last) return
    const agentName = String(last.agent_name || last.agent || last.name || '')
    if (!agentName) return

    if (last.type === 'agent_started' || last.type === 'tool_call') {
      setTeamStatus(current => current?.map(agent =>
        agent.name === agentName
          ? { ...agent, status: 'working', current_task: String(last.task || last.input || 'Working...') }
          : agent,
      ) ?? current)
    }

    if (last.type === 'agent_completed' || last.type === 'agent_done') {
      setTeamStatus(current => current?.map(agent =>
        agent.name === agentName
          ? { ...agent, status: 'idle', current_task: null, last_active: String(last.timestamp || new Date().toISOString()) }
          : agent,
      ) ?? current)
    }
  }, [events])

  const summary = useMemo<DashboardSummary | undefined>(() => {
    if (!query.data) return undefined
    return { ...query.data, team_status: teamStatus || query.data.team_status }
  }, [query.data, teamStatus])

  return {
    summary,
    loading: query.isLoading,
    isError: query.isError,
    error: query.error,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
  }
}

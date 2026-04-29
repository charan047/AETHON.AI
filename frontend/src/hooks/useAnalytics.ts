import { useQueries, useQuery } from '@tanstack/react-query'
import { agentsApi, analyticsApi, companyApi, feedbackApi, monitoringApi, approvalsApi } from '../api/client'

export function useAnalytics(period: number) {
  const [overview, costs, performance, tools, company, monitoring, pendingApprovals, agents] = useQueries({
    queries: [
      {
        queryKey: ['analytics', 'overview', period],
        queryFn: () => analyticsApi.overview(period),
        staleTime: 60_000,
      },
      {
        queryKey: ['analytics', 'costs', period],
        queryFn: () => analyticsApi.costs(period),
        staleTime: 60_000,
      },
      {
        queryKey: ['analytics', 'performance'],
        queryFn: analyticsApi.performance,
        staleTime: 60_000,
      },
      {
        queryKey: ['analytics', 'tools', period],
        queryFn: () => analyticsApi.tools(period),
        staleTime: 60_000,
      },
      {
        queryKey: ['company', 'profile'],
        queryFn: companyApi.profile,
        staleTime: 60_000,
      },
      {
        queryKey: ['monitoring', 'stats', 'analytics-live'],
        queryFn: monitoringApi.stats,
        refetchInterval: 10_000,
      },
      {
        queryKey: ['approvals', 'pending', 'analytics-live'],
        queryFn: approvalsApi.pending,
        refetchInterval: 10_000,
      },
      {
        queryKey: ['agents'],
        queryFn: agentsApi.list,
        staleTime: 60_000,
      },
    ],
  })

  const reputations = useQuery({
    queryKey: ['analytics', 'agent-reputations', agents.data?.map(agent => agent.id).join(',')],
    queryFn: async () => {
      const rows = await Promise.all((agents.data || []).map(async agent => {
        try {
          return [agent.id, await feedbackApi.reputation(agent.id)] as const
        } catch {
          return [agent.id, null] as const
        }
      }))
      return Object.fromEntries(rows)
    },
    enabled: Boolean(agents.data?.length),
    staleTime: 60_000,
  })

  const queries = [overview, costs, performance, tools, company, monitoring, pendingApprovals, agents]
  return {
    overview: overview.data,
    costs: costs.data,
    performance: performance.data,
    tools: tools.data,
    company: company.data,
    monitoring: monitoring.data,
    pendingApprovals: pendingApprovals.data || [],
    agents: agents.data || [],
    reputations: reputations.data || {},
    loading: queries.some(query => query.isLoading),
    error: queries.find(query => query.error)?.error || reputations.error,
  }
}

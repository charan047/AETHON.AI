import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { agencyApi } from '../api/client'
import { useWebSocket } from './useWebSocket'
import type { AgencyOverview, AgencyOverviewAttentionItem } from '../types'

function sortAttention(items: AgencyOverviewAttentionItem[]) {
  const urgencyOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }
  return [...items].sort((a, b) => {
    const urgencyDelta = (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3)
    if (urgencyDelta !== 0) return urgencyDelta
    return (b.age_minutes || 0) - (a.age_minutes || 0)
  })
}

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

    setOverview(current => {
      if (!current) return current
      if (eventType === 'new_approval_request') {
        const riskLevel = String(lastEvent.risk_level || 'medium')
        const nextApproval = {
          id: String(lastEvent.approval_id || `approval-${Date.now()}`),
          type: 'agent' as const,
          title: String(lastEvent.title || 'New approval request'),
          risk_level: riskLevel,
          agent_name: String(lastEvent.agent_name || 'Agent'),
          created_at: String(lastEvent.timestamp || new Date().toISOString()),
        }
        const nextAttention: AgencyOverviewAttentionItem = {
          type: 'approval_request',
          urgency: riskLevel === 'high' || riskLevel === 'critical' ? 'critical' : 'medium',
          title: `Approval needed: ${String(lastEvent.agent_name || 'Agent')}`,
          subtitle: String(lastEvent.title || 'New approval request'),
          client_name: null,
          execution_id: lastEvent.execution_id ? String(lastEvent.execution_id) : null,
          approval_id: nextApproval.id,
          age_minutes: 0,
          url: '/approvals',
        }
        const withoutDuplicateApprovals = current.approvals.list.filter(item => item.id !== nextApproval.id)
        const withoutDuplicateAttention = current.needs_attention.filter(item => item.approval_id !== nextAttention.approval_id)
        return {
          ...current,
          approvals: {
            pending: current.approvals.pending + 1,
            critical:
              current.approvals.critical + (riskLevel === 'high' || riskLevel === 'critical' ? 1 : 0),
            list: [nextApproval, ...withoutDuplicateApprovals].slice(0, 3),
          },
          needs_attention: sortAttention([nextAttention, ...withoutDuplicateAttention]),
          attention_count: current.attention_count + 1,
        }
      }

      if (eventType === 'execution_pending_review') {
        const nextAttention: AgencyOverviewAttentionItem = {
          type: 'pending_review',
          urgency: 'high',
          title: `Review ready: ${String(lastEvent.workflow_name || 'Workflow')}`,
          subtitle: 'Execution finished and is waiting for your review.',
          client_name: null,
          execution_id: lastEvent.execution_id ? String(lastEvent.execution_id) : null,
          approval_id: null,
          age_minutes: 0,
          url: `/executions/${String(lastEvent.execution_id || '')}`,
        }
        const withoutDuplicate = current.needs_attention.filter(item => item.execution_id !== nextAttention.execution_id)
        return {
          ...current,
          needs_attention: sortAttention([nextAttention, ...withoutDuplicate]),
          attention_count: current.attention_count + (withoutDuplicate.length === current.needs_attention.length ? 1 : 0),
        }
      }

      if (eventType === 'execution_complete') {
        const filtered = current.needs_attention.filter(item => item.execution_id !== String(lastEvent.execution_id || ''))
        return {
          ...current,
          needs_attention: filtered,
          attention_count: filtered.length,
        }
      }

      if (eventType === 'execution_failed') {
        const executionId = String(lastEvent.execution_id || '')
        const nextAttention: AgencyOverviewAttentionItem = {
          type: 'failed_execution',
          urgency: 'medium',
          title: `Failed: ${String(lastEvent.workflow_name || 'Workflow')}`,
          subtitle: String(lastEvent.error || 'Execution failed'),
          client_name: null,
          execution_id: executionId || null,
          approval_id: null,
          age_minutes: 0,
          url: executionId ? `/executions/${executionId}` : '/monitoring',
        }
        const withoutDuplicate = current.needs_attention.filter(item => item.execution_id !== nextAttention.execution_id)
        return {
          ...current,
          needs_attention: sortAttention([nextAttention, ...withoutDuplicate]),
          attention_count: withoutDuplicate.length + 1,
        }
      }

      return current
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

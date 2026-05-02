import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { executionsApi } from '../api/client'
import type { Execution } from '../types'

function refetchExecutionInterval(data: Execution | undefined) {
  const status = data?.status
  if (!status || ['completed', 'failed', 'timed_out', 'rejected'].includes(status)) {
    return false
  }
  return 3000
}

export function ExecutionPage() {
  const { executionId } = useParams<{ executionId: string }>()
  const navigate = useNavigate()

  const { data: execution, isLoading, isError, error } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.get(executionId!),
    enabled: Boolean(executionId),
    refetchInterval: query => refetchExecutionInterval(query.state.data as Execution | undefined),
  })

  if (!executionId) return null

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-white/30">Loading execution…</div>
      </div>
    )
  }

  if (isError || !execution) {
    const detail =
      (error as any)?.response?.data?.detail ||
      (error as Error | undefined)?.message ||
      'Execution could not be loaded.'
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <div className="flex items-center gap-2 text-sm text-white/30">
          <button
            onClick={() => navigate('/monitoring')}
            className="transition-colors hover:text-white/60"
          >
            Monitoring
          </button>
          <span>/</span>
          <span className="max-w-[240px] truncate font-mono text-xs text-white/50">{executionId}</span>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="text-sm font-medium text-red-300">Execution unavailable</div>
          <div className="mt-1 text-sm text-white/60">{detail}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-white/30">
        <button
          onClick={() => navigate('/monitoring')}
          className="transition-colors hover:text-white/60"
        >
          Monitoring
        </button>
        <span>/</span>
        <span className="max-w-[240px] truncate font-mono text-xs text-white/50">{executionId}</span>
      </div>

      <ExecutionLiveView
        executionId={executionId}
        agentName={execution?.workflow_name ?? execution?.agent_name ?? 'Agent'}
        modelName={execution?.model_name}
        initialInput={execution?.input ?? execution?.input_message}
        initialStatus={execution?.status ?? 'queued'}
        existingSteps={execution?.steps ?? []}
        maxHeight="65vh"
      />
    </div>
  )
}

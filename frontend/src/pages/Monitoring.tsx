import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, FileDown, FileText, RotateCcw, Wifi, WifiOff, X } from 'lucide-react'
import { clsx } from 'clsx'
import { executionsApi, extractApiError, monitoringApi } from '../api/client'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { PageShell } from '../components/Layout/PageShell'
import { EmptyState } from '../components/ui/EmptyState'
import { ExecutionRowSkeleton } from '../components/ui/Skeleton'
import { useWebSocket } from '../hooks/useWebSocket'
import { toast } from '../lib/toast'
import type { WsEvent } from '../types'

type MonitoringEvent = WsEvent & {
  from_db?: boolean
}

const EVENT_BADGES: Record<string, string> = {
  execution_start: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  execution_complete: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  execution_error: 'bg-red-900/40 text-red-400 border-red-900/60',
  thought: 'bg-emerald-900/30 text-emerald-300 border-emerald-900/50',
  action: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  observation: 'bg-slate-800 text-slate-400 border-slate-700',
  final_answer: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  error: 'bg-red-900/40 text-red-400 border-red-900/60',
  update: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  agent_done: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  tool_call: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  tool_result: 'bg-amber-900/30 text-amber-300 border-amber-900/50',
  stream_chunk: 'bg-slate-800 text-slate-400 border-slate-700',
  telegram_message: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  workflow_plan: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  ws_connected: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  ws_disconnected: 'bg-slate-800 text-slate-400 border-slate-700',
  hitl_requested: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  hitl_approved: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  hitl_rejected: 'bg-red-900/40 text-red-400 border-red-900/60',
  hitl_timed_out: 'bg-slate-800 text-slate-400 border-slate-700',
  execution_pending_review: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  agent_retry: 'bg-yellow-900/40 text-yellow-400 border-yellow-900/60',
  agent_retry_succeeded: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  agent_retry_exhausted: 'bg-red-900/40 text-red-400 border-red-900/60',
  workflow_paused: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  workflow_resumed: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  workflow_rejected: 'bg-red-900/40 text-red-400 border-red-900/60',
  workflow_timed_out: 'bg-slate-800 text-slate-400 border-slate-700',
  workflow_scheduled_trigger: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  workflow_webhook_trigger: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  workflow_rolled_back: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  parallel_group_started: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-900/60',
  parallel_group_completed: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-900/60',
  parallel_group_done: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-900/60',
  condition_evaluated: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  in_app_notification: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  budget_warning: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  budget_exceeded: 'bg-red-900/40 text-red-400 border-red-900/60',
}

function eventContent(event: MonitoringEvent): string {
  switch (event.type) {
    case 'execution_start': {
      const unassigned = event.unassigned_nodes as string[] | undefined
      const warn = unassigned?.length
        ? ` ⚠ ${unassigned.length} node(s) have no agent: [${unassigned.join(', ')}]`
        : ''
      return `Process "${event.workflow}" started (${event.agent_count}/${event.node_count} nodes assigned)${warn} — ${String(event.input || '').slice(0, 60)}`
    }
    case 'workflow_plan':
      return `Plan: ${Array.isArray(event.plan) ? event.plan.join(' → ') : String(event.plan || '')}`
    case 'execution_complete':
      return `Completed · ${event.tokens || 0} tokens · $${Number(event.cost || 0).toFixed(5)}`
    case 'execution_error':
      return `Error: ${event.error || event.content || 'Execution failed'}`
    case 'agent_done':
      return `${event.agent || event.agent_name || 'Agent'}: ${String(event.response || event.content || '').slice(0, 100)}`
    case 'tool_call':
      return `${event.agent || event.agent_name || 'Agent'} → ${event.tool || 'tool'}(${String(event.input || '').slice(0, 60)})`
    case 'tool_result':
      return `${event.tool || 'tool'}: ${String(event.output || event.content || '').slice(0, 100)}`
    case 'stream_chunk':
      return `${event.agent || event.agent_name || 'Agent'}: ${String(event.content || '').slice(0, 80)}`
    case 'telegram_message':
      return `@${event.from || 'user'}: ${String(event.content || '').slice(0, 80)}`
    case 'ws_connected':
      return `Realtime connected · ${event.connection_count || 1} connection(s)`
    case 'ws_disconnected':
      return `Realtime disconnected · ${event.connection_count || 0} connection(s)`
    case 'hitl_requested':
      return `Approval requested: ${event.title || event.approval_id || 'review needed'}`
    case 'hitl_approved':
      return `Approval ${event.approval_id || ''} approved`
    case 'hitl_rejected':
      return `Approval ${event.approval_id || ''} rejected`
    case 'hitl_timed_out':
      return `Approval ${event.approval_id || ''} timed out`
    case 'execution_pending_review':
      return `Needs Review: ${event.workflow_name || event.execution_id || 'execution'}`
    case 'agent_retry':
      return `${event.agent_name || event.agent || 'Agent'} retrying attempt ${event.attempt}/${event.max_retries}`
    case 'agent_retry_succeeded':
      return `${event.agent_name || event.agent || 'Agent'} succeeded after retry ${event.attempt}`
    case 'agent_retry_exhausted':
      return `${event.agent_name || event.agent || 'Agent'} exhausted retries: ${event.error || 'unknown error'}`
    case 'workflow_paused':
      return 'Workflow paused for approval'
    case 'workflow_resumed':
      return 'Workflow resumed'
    case 'workflow_rejected':
      return 'Workflow rejected by reviewer'
    case 'workflow_timed_out':
      return 'Workflow timed out waiting for approval'
    case 'workflow_scheduled_trigger':
      return 'Scheduled process triggered'
    case 'workflow_webhook_trigger':
      return `${event.source || 'Webhook'} triggered process`
    case 'workflow_rolled_back':
      return `Workflow rolled back to v${event.target_version || 'previous'}`
    case 'parallel_group_started':
      return `Parallel group started with ${event.agent_count || 'multiple'} agent(s)`
    case 'parallel_group_completed':
    case 'parallel_group_done':
      return `Parallel group completed · ${event.succeeded || 0} succeeded · ${event.failed || 0} failed`
    case 'condition_evaluated':
      return `Condition matched ${event.matched_condition || 'default'} → ${event.target_node_id || 'next node'}`
    case 'in_app_notification':
      return `Notification: ${event.title || event.message || 'new item'}`
    case 'budget_warning':
      return `Budget warning: $${event.monthly_spend || 0} of $${event.monthly_budget || 0}`
    case 'budget_exceeded':
      return `Budget exceeded: $${event.monthly_spend || 0} of $${event.monthly_budget || 0}`
    case 'thought':
    case 'action':
    case 'observation':
    case 'final_answer':
    case 'error':
    case 'update':
      return String(event.content || '').slice(0, 140)
    default:
      return JSON.stringify(event).slice(0, 140)
  }
}

function eventDetail(event: MonitoringEvent): string {
  if (typeof event.response === 'string' && event.response.trim()) return event.response
  if (typeof event.output === 'string' && event.output.trim()) return event.output
  if (typeof event.content === 'string' && event.content.trim()) return event.content
  return JSON.stringify(event, null, 2)
}

function LogEntry({
  event,
  onOpenExecution,
}: {
  event: MonitoringEvent
  onOpenExecution: (executionId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const badgeClass = EVENT_BADGES[event.type] || 'bg-slate-800 text-slate-400 border-slate-700'
  const hasExecution = Boolean(event.execution_id)
  const canExpandInline = !hasExecution

  return (
    <div className="group">
      <div
        className={clsx(
          'flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-slate-800/50',
          (hasExecution || canExpandInline) && 'cursor-pointer',
        )}
        onClick={() => {
          if (hasExecution && event.execution_id) {
            onOpenExecution(event.execution_id)
            return
          }
          if (canExpandInline) {
            setExpanded(value => !value)
          }
        }}
      >
        <span className="w-20 flex-shrink-0 pt-0.5 font-mono text-xs text-slate-600">
          {event.timestamp ? new Date(event.timestamp).toLocaleTimeString('en', { hour12: false }) : '--:--:--'}
        </span>
        <span className={clsx('badge mt-0.5 flex-shrink-0 border', badgeClass)}>
          {event.type.replace(/_/g, ' ')}
        </span>
        <span className="flex-1 break-all text-xs text-slate-300">
          {eventContent(event)}
        </span>
        {hasExecution ? (
          <span className="flex-shrink-0 text-xs text-indigo-300/70 group-hover:text-indigo-300">
            Open →
          </span>
        ) : (
          <span className="flex-shrink-0 text-xs text-slate-600 group-hover:text-slate-400">
            {expanded ? 'Hide' : 'Details'}
          </span>
        )}
      </div>
      {expanded && canExpandInline && (
        <div className="mb-1 ml-24 mr-2 whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900 p-2.5 font-mono text-xs text-slate-400">
          {eventDetail(event)}
        </div>
      )}
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'done',
  failed: 'failed',
  cancelled: 'stopped',
  running: 'running',
  pending: 'running',
  pending_review: 'Needs Review',
  waiting_approval: 'Needs Review',
  rejected: 'failed',
  timed_out: 'failed',
}

type ExecutionLike = {
  status: string
  status_label?: string | null
  review_state?: 'needs_review' | null
  review_stage?: 'final_review' | 'workflow_pause' | null
  requires_ceo_action?: boolean
}

function formatDuration(durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) return '—'
  if (durationSeconds < 60) return `${durationSeconds}s`
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function formatRelativeTime(timestamp?: string | null) {
  if (!timestamp) return '—'
  const deltaSeconds = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`
  return `${Math.floor(deltaSeconds / 86400)}d ago`
}

function isNeedsReview(execution: ExecutionLike) {
  return execution.review_state === 'needs_review' || execution.requires_ceo_action
}

function statusDotClass(execution: ExecutionLike) {
  if (execution.status === 'running' || execution.status === 'pending') return 'dot-blue dot-live'
  if (isNeedsReview(execution)) return 'dot-amber dot-live'
  if (execution.status === 'completed') return 'dot-emerald'
  return 'dot-red'
}

function StatusBadge({ execution }: { execution: ExecutionLike }) {
  const badgeClass =
    execution.status === 'completed'
      ? 'badge-emerald'
      : execution.status === 'running' || execution.status === 'pending'
        ? 'badge-indigo'
        : isNeedsReview(execution)
          ? 'badge-amber'
          : 'badge-red'

  return (
    <span className={clsx('badge font-mono text-[10px] uppercase tracking-[0.08em]', badgeClass)}>
      {execution.status_label || STATUS_LABELS[execution.status] || execution.status}
    </span>
  )
}

export function Monitoring() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { events, connected, clearEvents } = useWebSocket()
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'review' | 'done' | 'failed'>('all')
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: monitoringApi.stats,
    refetchInterval: 3000,
  })
  const recentQuery = useQuery({
    queryKey: ['recent-executions'],
    queryFn: () => monitoringApi.recentExecutions(20),
    refetchInterval: 5000,
  })
  const selectedExecutionQuery = useQuery({
    queryKey: ['execution', selectedExecutionId],
    queryFn: () => executionsApi.get(selectedExecutionId!),
    enabled: Boolean(selectedExecutionId),
    refetchInterval: 3000,
  })
  const logsQuery = useQuery<MonitoringEvent[]>({
    queryKey: ['monitoring-logs'],
    queryFn: () => monitoringApi.logs({ limit: 150 }),
    refetchInterval: 5000,
  })

  const combinedEvents = useMemo<MonitoringEvent[]>(() => {
    const merged = new Map<string, MonitoringEvent>()
    const historical = Array.isArray(logsQuery.data) ? logsQuery.data : []
    const live = Array.isArray(events) ? events : []

    for (const event of [...historical, ...live]) {
      const timestamp = typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString()
      const key = [
        event.execution_id || 'no-execution',
        event.type,
        timestamp,
        typeof event.content === 'string' ? event.content : typeof event.response === 'string' ? event.response : '',
      ].join('::')
      if (!merged.has(key)) {
        merged.set(key, { ...event, timestamp })
      }
    }

    return Array.from(merged.values()).sort((a, b) => {
      const left = new Date(a.timestamp || 0).getTime()
      const right = new Date(b.timestamp || 0).getTime()
      return left - right
    })
  }, [events, logsQuery.data])

  const filteredExecutions = useMemo(() => {
    const executions = recentQuery.data || []
    if (statusFilter === 'all') return executions
    if (statusFilter === 'running') return executions.filter((execution: any) => ['running', 'pending'].includes(execution.status))
    if (statusFilter === 'review') return executions.filter((execution: any) => isNeedsReview(execution))
    if (statusFilter === 'done') return executions.filter((execution: any) => execution.status === 'completed')
    return executions.filter((execution: any) => ['failed', 'cancelled', 'timed_out', 'rejected'].includes(execution.status))
  }, [recentQuery.data, statusFilter])

  const filterCounts = useMemo(() => {
    const executions = recentQuery.data || []
    return {
      all: executions.length,
      running: executions.filter((execution: any) => ['running', 'pending'].includes(execution.status)).length,
      review: executions.filter((execution: any) => isNeedsReview(execution)).length,
      done: executions.filter((execution: any) => execution.status === 'completed').length,
      failed: executions.filter((execution: any) => ['failed', 'cancelled', 'timed_out', 'rejected'].includes(execution.status)).length,
    }
  }, [recentQuery.data])

  const handleExecutionClick = (executionId: string) => {
    if (window.innerWidth >= 1024) {
      setSelectedExecutionId(executionId)
      return
    }
    navigate(`/executions/${executionId}`)
  }

  const hasNoRuns = !(recentQuery.data?.length) && !combinedEvents.length
  const filterTabs = [
    { key: 'all', label: 'All' },
    { key: 'running', label: 'Running' },
    { key: 'review', label: 'Needs Review' },
    { key: 'done', label: 'Done' },
    { key: 'failed', label: 'Failed' },
  ] as const

  const approveSelectedMutation = useMutation({
    mutationFn: (executionId: string) => executionsApi.approve(executionId),
    onSuccess: async (_, executionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['execution', executionId] }),
        queryClient.invalidateQueries({ queryKey: ['recent-executions'] }),
      ])
      toast.success('Run approved')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const exportSelected = async (format: 'pdf' | 'docx') => {
    if (!selectedExecutionId) return
    const { blob, filename } = await executionsApi.export(selectedExecutionId, format)
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
  }

  return (
    <>
      <PageShell
      title="Runs"
      subtitle="Runs across the agency."
        actions={
          <div className={clsx('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs', connected ? 'border-green-500/20 bg-green-500/10 text-green-400' : 'border-white/[0.08] text-[var(--t3)]')}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? `Live · ${events.length}` : 'Reconnecting'}
          </div>
        }
        contentClassName="space-y-4 p-6"
      >
        <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)] pb-2">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={clsx(
                'inline-flex items-center gap-2 border-b-2 pb-2 font-mono text-[11px] uppercase tracking-[0.10em] transition-colors',
                statusFilter === tab.key
                  ? 'border-indigo-400 text-indigo-300 font-semibold'
                  : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]',
              )}
            >
              {tab.label}
              {tab.key !== 'all' && filterCounts[tab.key] > 0 ? (
                <span
                  className={clsx(
                    'badge px-1.5 py-0.5 font-mono text-[10px]',
                    tab.key === 'running'
                      ? 'badge-indigo'
                      : tab.key === 'review'
                        ? 'badge-amber'
                        : tab.key === 'failed'
                          ? 'badge-red'
                          : 'badge-glass',
                  )}
                >
                  {filterCounts[tab.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <section className="card overflow-hidden p-0">
          {hasNoRuns ? (
            <div className="p-8">
              <EmptyState
                icon="🎬"
                title="No runs yet"
                description="Your first run will appear here the moment an agent starts working."
                action={{ label: 'Run a process', onClick: () => navigate('/workflows') }}
              />
            </div>
          ) : recentQuery.isLoading && !(recentQuery.data || []).length ? (
            <div className="p-4">
              {Array.from({ length: 6 }).map((_, index) => <ExecutionRowSkeleton key={index} />)}
            </div>
          ) : !filteredExecutions.length ? (
            <div className="px-4 py-12 text-center text-sm text-[var(--t2)]">No runs match this filter.</div>
          ) : (
            <div>
              {filteredExecutions.map((execution: any) => (
                <button
                  key={execution.id}
                  type="button"
                  data-testid="execution-row"
                  className="row w-full min-h-[44px] text-left"
                  onClick={() => handleExecutionClick(execution.id)}
                >
                  <span className={clsx('status-dot', statusDotClass(execution))} />
                  <div className="min-w-0 w-[180px] flex-shrink-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {execution.agent_name || execution.workflow_name || 'Agent'}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 truncate text-xs text-[var(--text-2)]">
                    {execution.input_message || execution.input || execution.workflow_name || 'Run in progress'}
                  </div>
                  <div className="hidden max-w-[140px] truncate text-xs text-[var(--text-3)] md:block">
                    {execution.client_name || 'Internal'}
                  </div>
                  <div className="hidden font-mono text-[11px] text-[var(--text-3)] sm:block">{formatDuration(execution.duration_seconds)}</div>
                  <StatusBadge execution={execution} />
                </button>
              ))}
            </div>
          )}
        </section>
      </PageShell>

      {selectedExecutionId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSelectedExecutionId(null)}
          />
          <motion.div
            data-testid="monitoring-drawer"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="glass-elevated fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-white/[0.07] shadow-xl"
          >
            <div className="flex items-start justify-between border-b border-white/[0.08] px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-white">
                    {selectedExecutionQuery.data?.agent_name || 'Agent'}
                  </h2>
                  {selectedExecutionQuery.data ? <StatusBadge execution={selectedExecutionQuery.data} /> : null}
                </div>
                <div className="mt-1 text-xs text-[var(--text-3)]">
                  {(selectedExecutionQuery.data?.workflow_name || 'Workflow')} · {(selectedExecutionQuery.data?.agent_name || 'Agent')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/executions/${selectedExecutionId}`)}
                  className="btn-secondary text-xs"
                >
                  Open full page ↗
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setSelectedExecutionId(null)}
                  className="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="overflow-hidden rounded-[20px] border border-white/[0.08] bg-white/[0.03]">
                <ExecutionLiveView
                  executionId={selectedExecutionId}
                  maxHeight="100%"
                  onComplete={() => {}}
                  onError={() => {}}
                />
              </div>
            </div>
            <div className="border-t border-white/[0.08] px-4 py-3">
              {selectedExecutionQuery.data?.review_state === 'needs_review' &&
              selectedExecutionQuery.data?.review_stage !== 'workflow_pause' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => approveSelectedMutation.mutate(selectedExecutionId)}
                    disabled={approveSelectedMutation.isPending}
                    className="btn-emerald btn-runner flex-1"
                  >
                    <CheckCircle2 size={14} />
                    {approveSelectedMutation.isPending ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/executions/${selectedExecutionId}`)}
                    className="btn-secondary flex-1"
                  >
                    <RotateCcw size={14} />
                    Regenerate
                  </button>
                </div>
              ) : selectedExecutionQuery.data?.status === 'completed' && selectedExecutionQuery.data.approved_by ? (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary flex-1 text-xs" onClick={() => void exportSelected('pdf')}>
                    <FileText size={13} />
                    PDF
                  </button>
                  <button type="button" className="btn-secondary flex-1 text-xs" onClick={() => void exportSelected('docx')}>
                    <FileDown size={13} />
                    Word
                  </button>
                </div>
              ) : null}
            </div>
          </motion.div>
        </>
      )}
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, Search, Trash2, Wifi, WifiOff, X } from 'lucide-react'
import { clsx } from 'clsx'
import { monitoringApi } from '../api/client'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { EmptyState } from '../components/ui/EmptyState'
import { ExecutionRowSkeleton } from '../components/ui/Skeleton'
import { useWebSocket } from '../hooks/useWebSocket'
import type { WsEvent } from '../types'

type MonitoringEvent = WsEvent & {
  from_db?: boolean
}

const EVENT_BADGES: Record<string, string> = {
  execution_start: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  execution_complete: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  execution_error: 'bg-red-900/40 text-red-400 border-red-900/60',
  thought: 'bg-cyan-900/30 text-cyan-300 border-cyan-900/50',
  action: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  observation: 'bg-slate-800 text-slate-400 border-slate-700',
  final_answer: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  error: 'bg-red-900/40 text-red-400 border-red-900/60',
  update: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  agent_done: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  tool_call: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  tool_result: 'bg-amber-900/30 text-amber-300 border-amber-900/50',
  stream_chunk: 'bg-slate-800 text-slate-400 border-slate-700',
  telegram_message: 'bg-cyan-900/40 text-cyan-400 border-cyan-900/60',
  workflow_plan: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  ws_connected: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  ws_disconnected: 'bg-slate-800 text-slate-400 border-slate-700',
  hitl_requested: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  hitl_approved: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  hitl_rejected: 'bg-red-900/40 text-red-400 border-red-900/60',
  hitl_timed_out: 'bg-slate-800 text-slate-400 border-slate-700',
  agent_retry: 'bg-yellow-900/40 text-yellow-400 border-yellow-900/60',
  agent_retry_succeeded: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  agent_retry_exhausted: 'bg-red-900/40 text-red-400 border-red-900/60',
  workflow_paused: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  workflow_resumed: 'bg-cyan-900/40 text-cyan-400 border-cyan-900/60',
  workflow_rejected: 'bg-red-900/40 text-red-400 border-red-900/60',
  workflow_timed_out: 'bg-slate-800 text-slate-400 border-slate-700',
  workflow_scheduled_trigger: 'bg-cyan-900/40 text-cyan-400 border-cyan-900/60',
  workflow_webhook_trigger: 'bg-cyan-900/40 text-cyan-400 border-cyan-900/60',
  workflow_rolled_back: 'bg-blue-900/40 text-blue-300 border-blue-900/60',
  parallel_group_started: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-900/60',
  parallel_group_completed: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-900/60',
  parallel_group_done: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-900/60',
  condition_evaluated: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  in_app_notification: 'bg-cyan-900/40 text-cyan-400 border-cyan-900/60',
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
      return `Workflow "${event.workflow}" started (${event.agent_count}/${event.node_count} nodes assigned)${warn} — ${String(event.input || '').slice(0, 60)}`
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
      return 'Scheduled workflow triggered'
    case 'workflow_webhook_trigger':
      return `${event.source || 'Webhook'} triggered workflow`
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
          <span className="flex-shrink-0 text-xs text-accent-300/70 group-hover:text-accent-300">
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

export function Monitoring() {
  const navigate = useNavigate()
  const { events, connected, clearEvents } = useWebSocket()
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
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

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [combinedEvents, autoScroll])

  const allTypes = useMemo(
    () => ['all', ...Array.from(new Set(combinedEvents.map(event => event.type)))],
    [combinedEvents],
  )

  const filtered = useMemo(
    () =>
      combinedEvents.filter(event => {
        const matchType = typeFilter === 'all' || event.type === typeFilter
        const matchSearch = !filter || JSON.stringify(event).toLowerCase().includes(filter.toLowerCase())
        return matchType && matchSearch
      }),
    [combinedEvents, filter, typeFilter],
  )

  const statusColor: Record<string, string> = {
    completed: 'text-emerald-400',
    failed: 'text-red-400',
    cancelled: 'text-slate-400',
    running: 'text-blue-400',
    pending: 'text-yellow-400',
    waiting_approval: 'text-amber-400',
    rejected: 'text-red-400',
    timed_out: 'text-slate-500',
  }

  const statusLabel: Record<string, string> = {
    cancelled: 'Cancelled',
    waiting_approval: 'Awaiting Approval',
    rejected: 'Rejected by Human',
    timed_out: 'Timed Out',
  }

  const handleExecutionClick = (executionId: string) => {
    if (window.innerWidth >= 1024) {
      setSelectedExecutionId(executionId)
      return
    }
    navigate(`/executions/${executionId}`)
  }

  const hasNoRuns = !(recentQuery.data?.length) && !combinedEvents.length

  return (
    <>
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex flex-shrink-0 items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Monitoring</h1>
            <p className="mt-1 text-sm text-slate-400">Real-time agent execution logs and metrics</p>
          </div>
          <div
            className={clsx(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
              connected
                ? 'border-emerald-900/60 bg-emerald-900/20 text-emerald-400'
                : 'border-slate-800 text-slate-500',
            )}
          >
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connected ? `Live · ${events.length} events` : 'Reconnecting...'}
          </div>
        </div>

        <div className="grid flex-shrink-0 grid-cols-4 gap-3">
          {[
            { label: 'Active Runs', value: statsQuery.data?.active_executions ?? 0, color: 'text-blue-400' },
            { label: 'Total Runs', value: statsQuery.data?.executions ?? 0, color: 'text-slate-300' },
            { label: 'Success Rate', value: `${statsQuery.data?.success_rate ?? 0}%`, color: 'text-emerald-400' },
            { label: 'Total Tokens', value: (statsQuery.data?.total_tokens ?? 0).toLocaleString(), color: 'text-amber-400' },
          ].map(stat => (
            <div key={stat.label} className="card px-4 py-3">
              <div className={clsx('text-lg font-bold', stat.color)}>{stat.value}</div>
              <div className="text-xs text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          <div className="card flex w-56 flex-shrink-0 flex-col overflow-hidden">
            <div className="border-b border-slate-800 p-3 text-xs font-semibold text-slate-400">
              Recent Executions
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-2">
              {!recentQuery.data &&
                Array.from({ length: 5 }).map((_, index) => <ExecutionRowSkeleton key={index} />)}
              {(recentQuery.data || []).map((execution: any) => (
                <button
                  key={execution.id}
                  type="button"
                  data-testid="execution-row"
                  className="group w-full rounded px-2 py-2 text-left text-xs text-slate-400 transition-colors hover:bg-slate-800"
                  onClick={() => handleExecutionClick(execution.id)}
                >
                  <div className="truncate font-medium text-slate-300">{execution.workflow_name}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    {execution.status === 'waiting_approval' ? (
                      <Link
                        to="/approvals"
                        className="rounded-full bg-amber-900/30 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-900/50"
                        onClick={event => event.stopPropagation()}
                      >
                        Awaiting Approval
                      </Link>
                    ) : (
                      <span className={statusColor[execution.status] || 'text-slate-600'}>
                        {statusLabel[execution.status] || execution.status}
                      </span>
                    )}
                    <span className="text-[11px] text-white/20 group-hover:text-white/40">Open</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 p-3">
              <Search size={14} className="text-slate-600" />
              <input
                className="flex-1 bg-transparent text-sm text-slate-300 outline-none placeholder-slate-600"
                placeholder="Filter logs..."
                value={filter}
                onChange={event => setFilter(event.target.value)}
              />
              <select
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-400 outline-none"
                value={typeFilter}
                onChange={event => setTypeFilter(event.target.value)}
              >
                {allTypes.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer select-none items-center gap-1 text-xs text-slate-500">
                <input
                  type="checkbox"
                  className="accent-violet-500"
                  checked={autoScroll}
                  onChange={event => setAutoScroll(event.target.checked)}
                />
                Auto-scroll
              </label>
              <button
                type="button"
                className="btn-ghost p-1.5 text-slate-600 hover:text-red-400"
                onClick={clearEvents}
                title="Clear live buffer"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono">
              {hasNoRuns ? (
                <EmptyState
                  icon="🎬"
                  title="No runs yet"
                  description="Run an agent to see the magic happen here. Watch it think, search, and work in real time."
                  action={{ label: 'Run an agent →', onClick: () => navigate('/agents') }}
                />
              ) : logsQuery.isLoading && !combinedEvents.length ? (
                <div className="flex h-full flex-col items-center justify-center text-slate-700">
                  <Activity size={32} className="mb-2 animate-pulse" />
                  <div className="text-sm">Loading monitoring history…</div>
                </div>
              ) : !filtered.length ? (
                <div className="flex h-full flex-col items-center justify-center text-slate-700">
                  <Activity size={32} className="mb-2" />
                  <div className="text-sm">No matching events</div>
                  <div className="mt-1 text-xs">Try a different filter or run a workflow</div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filtered.map((event, index) => (
                    <LogEntry
                      key={`${event.execution_id || 'event'}-${event.timestamp || index}-${event.type}-${index}`}
                      event={event}
                      onOpenExecution={handleExecutionClick}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-600">
              <span>
                {filtered.length} events shown · {combinedEvents.length} total visible
              </span>
              <span className="text-slate-700">
                History comes from DB, live updates come from WebSocket
              </span>
            </div>
          </div>
        </div>
      </div>

      {selectedExecutionId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSelectedExecutionId(null)}
          />
          <div
            data-testid="monitoring-drawer"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-white/[0.08] bg-obsidian-950 shadow-glow-lg"
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Execution Detail</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/executions/${selectedExecutionId}`)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:border-accent-400/30 hover:text-accent-300"
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
              <ExecutionLiveView
                executionId={selectedExecutionId}
                maxHeight="100%"
                onComplete={() => {}}
                onError={() => {}}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { monitoringApi, executionsApi } from '../api/client'
import { useWebSocket } from '../hooks/useWebSocket'
import { Activity, Wifi, WifiOff, Trash2, Search, ChevronDown, ChevronRight, X, Bot, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import type { WsEvent } from '../types'

const EVENT_BADGES: Record<string, string> = {
  execution_start: 'bg-blue-900/40 text-blue-400 border-blue-900/60',
  execution_complete: 'bg-emerald-900/40 text-emerald-400 border-emerald-900/60',
  execution_error: 'bg-red-900/40 text-red-400 border-red-900/60',
  agent_done: 'bg-violet-900/40 text-violet-400 border-violet-900/60',
  tool_call: 'bg-amber-900/40 text-amber-400 border-amber-900/60',
  tool_result: 'bg-amber-900/30 text-amber-300 border-amber-900/50',
  stream_chunk: 'bg-slate-800 text-slate-400 border-slate-700',
  telegram_message: 'bg-cyan-900/40 text-cyan-400 border-cyan-900/60',
  workflow_plan: 'bg-indigo-900/40 text-indigo-400 border-indigo-900/60',
}

function eventContent(ev: WsEvent): string {
  switch (ev.type) {
    case 'execution_start': {
      const unassigned = ev.unassigned_nodes as string[] | undefined
      const warn = unassigned?.length ? ` ⚠ ${unassigned.length} node(s) have no agent: [${unassigned.join(', ')}]` : ''
      return `Workflow "${ev.workflow}" started (${ev.agent_count}/${ev.node_count} nodes assigned)${warn} — ${String(ev.input || '').slice(0, 60)}`
    }
    case 'workflow_plan': return `Plan: ${(ev.plan as string[]).join(' → ')}`
    case 'execution_complete': return `Completed · ${ev.tokens} tokens · $${Number(ev.cost || 0).toFixed(5)}`
    case 'execution_error': return `Error: ${ev.error}`
    case 'agent_done': return `${ev.agent}: ${String(ev.response || '').slice(0, 100)}`
    case 'tool_call': return `${ev.agent} → ${ev.tool}(${String(ev.input || '').slice(0, 60)})`
    case 'tool_result': return `${ev.tool}: ${String(ev.output || '').slice(0, 100)}`
    case 'stream_chunk': return `${ev.agent}: ${String(ev.content || '').slice(0, 80)}`
    case 'telegram_message': return `@${ev.from}: ${String(ev.content || '').slice(0, 80)}`
    default: return JSON.stringify(ev).slice(0, 100)
  }
}

function LogEntry({ ev, onViewResult }: { ev: WsEvent; onViewResult: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const badgeClass = EVENT_BADGES[ev.type] || 'bg-slate-800 text-slate-400 border-slate-700'
  const hasDetail = ev.type === 'agent_done' || ev.type === 'tool_result'
  const isComplete = ev.type === 'execution_complete'

  return (
    <div className="log-entry group">
      <div
        className={clsx('flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors', (hasDetail || isComplete) && 'cursor-pointer')}
        onClick={() => {
          if (isComplete && ev.execution_id) { onViewResult(ev.execution_id); return }
          if (hasDetail) setExpanded(e => !e)
        }}
      >
        <span className="text-xs text-slate-600 font-mono w-20 flex-shrink-0 pt-0.5">
          {new Date(ev.timestamp).toLocaleTimeString('en', { hour12: false })}
        </span>
        <span className={clsx('badge border flex-shrink-0 mt-0.5', badgeClass)}>
          {ev.type.replace('_', ' ')}
        </span>
        <span className="text-xs text-slate-300 flex-1 break-all">{eventContent(ev)}</span>
        {isComplete && (
          <span className="text-emerald-600 group-hover:text-emerald-400 text-xs flex-shrink-0 flex items-center gap-1">
            <Sparkles size={11} /> View result
          </span>
        )}
        {hasDetail && (
          <span className="text-slate-700 group-hover:text-slate-500 flex-shrink-0">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </div>
      {expanded && hasDetail && (
        <div className="ml-24 mr-2 mb-1 p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono text-slate-400 break-all whitespace-pre-wrap">
          {ev.type === 'agent_done' && ev.response}
          {ev.type === 'tool_result' && ev.output}
        </div>
      )}
    </div>
  )
}

function ResultModal({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const { data: execution, isLoading } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.get(executionId),
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-900/40 flex items-center justify-center">
              <Sparkles size={16} className="text-emerald-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-100">Workflow Result</div>
              {execution && (
                <div className="text-xs text-slate-500 mt-0.5">
                  {execution.token_count} tokens · ${execution.cost.toFixed(5)} · {execution.status}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        {/* Input */}
        {execution?.input_message && (
          <div className="px-5 pt-4 flex-shrink-0">
            <div className="text-xs text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Your Query</div>
            <div className="bg-slate-800 rounded-lg px-4 py-3 text-sm text-slate-300 border border-slate-700">
              {execution.input_message}
            </div>
          </div>
        )}

        {/* Output */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-xs text-slate-500 font-medium mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
            <Bot size={12} /> Agent Response
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              Loading result...
            </div>
          ) : execution?.output_message ? (
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {execution.output_message}
            </div>
          ) : (
            <div className="text-slate-500 text-sm py-8 text-center">
              No output yet — the workflow may still be running.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Monitoring() {
  const { events, connected, clearEvents } = useWebSocket()
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null)
  const [resultExecutionId, setResultExecutionId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const { data: stats } = useQuery({
    queryKey: ['stats'], queryFn: monitoringApi.stats, refetchInterval: 3000,
  })
  const { data: recent } = useQuery({
    queryKey: ['recent-executions'], queryFn: () => monitoringApi.recentExecutions(20), refetchInterval: 5000,
  })

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events, autoScroll])

  const allTypes = ['all', ...Array.from(new Set(events.map(e => e.type)))]
  const filtered = events.filter(ev => {
    const matchType = typeFilter === 'all' || ev.type === typeFilter
    const matchSearch = !filter || JSON.stringify(ev).toLowerCase().includes(filter.toLowerCase())
    const matchExec = !selectedExecution || ev.execution_id === selectedExecution
    return matchType && matchSearch && matchExec
  })

  const statusColor: Record<string, string> = {
    completed: 'text-emerald-400', failed: 'text-red-400',
    running: 'text-blue-400', pending: 'text-yellow-400',
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden p-6 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Monitoring</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time agent execution logs and metrics</p>
        </div>
        <div className={clsx('flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border',
          connected ? 'text-emerald-400 border-emerald-900/60 bg-emerald-900/20' : 'text-slate-500 border-slate-800'
        )}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {connected ? `Live · ${events.length} events` : 'Reconnecting...'}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: 'Active Runs', value: stats?.active_executions ?? 0, color: 'text-blue-400' },
          { label: 'Total Runs', value: stats?.executions ?? 0, color: 'text-slate-300' },
          { label: 'Success Rate', value: `${stats?.success_rate ?? 0}%`, color: 'text-emerald-400' },
          { label: 'Total Tokens', value: (stats?.total_tokens ?? 0).toLocaleString(), color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3">
            <div className={clsx('text-lg font-bold', s.color)}>{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Execution list */}
        <div className="w-56 flex-shrink-0 card flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800 text-xs font-semibold text-slate-400">Recent Executions</div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              className={clsx('w-full text-left px-2 py-1.5 rounded text-xs transition-colors', !selectedExecution ? 'bg-violet-900/30 text-violet-400' : 'text-slate-400 hover:bg-slate-800')}
              onClick={() => setSelectedExecution(null)}
            >
              All executions
            </button>
            {(recent || []).map((ex: any) => (
              <button key={ex.id}
                className={clsx('w-full text-left px-2 py-2 rounded text-xs transition-colors group',
                  selectedExecution === ex.id ? 'bg-violet-900/30 text-violet-400' : 'text-slate-400 hover:bg-slate-800'
                )}
                onClick={() => setSelectedExecution(ex.id === selectedExecution ? null : ex.id)}
              >
                <div className="truncate font-medium text-slate-300">{ex.workflow_name}</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className={statusColor[ex.status] || 'text-slate-600'}>{ex.status}</span>
                  {ex.status === 'completed' && (
                    <span
                      className="text-emerald-600 hover:text-emerald-400 transition-colors"
                      onClick={e => { e.stopPropagation(); setResultExecutionId(ex.id) }}
                      title="View result"
                    >
                      <Sparkles size={11} />
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Log stream */}
        <div className="flex-1 card flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 p-3 border-b border-slate-800 flex-shrink-0">
            <Search size={14} className="text-slate-600" />
            <input className="bg-transparent text-sm text-slate-300 outline-none flex-1 placeholder-slate-600"
              placeholder="Filter logs..." value={filter} onChange={e => setFilter(e.target.value)} />
            <select className="bg-slate-800 border border-slate-700 text-xs text-slate-400 rounded px-2 py-1 outline-none"
              value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer select-none">
              <input type="checkbox" className="accent-violet-500" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
              Auto-scroll
            </label>
            <button className="btn-ghost p-1.5 text-slate-600 hover:text-red-400" onClick={clearEvents} title="Clear logs">
              <Trash2 size={14} />
            </button>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono">
            {!filtered.length ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-700">
                <Activity size={32} className="mb-2" />
                <div className="text-sm">Waiting for events...</div>
                <div className="text-xs mt-1">Run a workflow to see live logs</div>
              </div>
            ) : (
              filtered.map((ev, i) => (
                <LogEntry key={i} ev={ev} onViewResult={setResultExecutionId} />
              ))
            )}
          </div>
          <div className="border-t border-slate-800 px-3 py-2 text-xs text-slate-600 flex-shrink-0">
            {filtered.length} events shown · {events.length} total buffered
            <span className="ml-3 text-slate-700">· Click <span className="text-emerald-700">execution complete</span> or <Sparkles size={10} className="inline" /> to see the full answer</span>
          </div>
        </div>
      </div>

      {/* Result modal */}
      {resultExecutionId && (
        <ResultModal executionId={resultExecutionId} onClose={() => setResultExecutionId(null)} />
      )}
    </div>
  )
}

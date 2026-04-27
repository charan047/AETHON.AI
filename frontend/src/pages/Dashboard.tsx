import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { monitoringApi, executionsApi } from '../api/client'
import { Bot, GitBranch, Play, Coins, TrendingUp, Wifi, Sparkles, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useWebSocket } from '../hooks/useWebSocket'
import { clsx } from 'clsx'

function ResultModal({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const { data: execution, isLoading } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.get(executionId),
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-900/40 flex items-center justify-center">
              <Sparkles size={16} className="text-emerald-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-100">Workflow Result</div>
              {execution && <div className="text-xs text-slate-500 mt-0.5">{execution.token_count} tokens · ${execution.cost.toFixed(5)}</div>}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>
        {execution?.input_message && (
          <div className="px-5 pt-4 flex-shrink-0">
            <div className="text-xs text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Your Query</div>
            <div className="bg-slate-800 rounded-lg px-4 py-3 text-sm text-slate-300 border border-slate-700">{execution.input_message}</div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-xs text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Agent Response</div>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-500 text-sm">
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /> Loading...
            </div>
          ) : (
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {execution?.output_message || 'No output available.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon size={22} />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-100">{value}</div>
        <div className="text-sm text-slate-400">{label}</div>
        {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    completed: 'badge-green', failed: 'badge-red', running: 'badge-blue', pending: 'badge-yellow',
  }
  return map[status] || 'badge-gray'
}

export function Dashboard() {
  const [resultId, setResultId] = useState<string | null>(null)

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: monitoringApi.stats,
    refetchInterval: 5000,
  })
  const { data: recent } = useQuery({
    queryKey: ['recent-executions'],
    queryFn: () => monitoringApi.recentExecutions(8),
    refetchInterval: 5000,
  })
  const { events, connected } = useWebSocket()
  const liveEvents = events.slice(-5).reverse()

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Platform overview and real-time activity</p>
        </div>
        <div className={clsx('flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border',
          connected ? 'text-emerald-400 border-emerald-900/60 bg-emerald-900/20' : 'text-slate-500 border-slate-800'
        )}>
          <Wifi size={14} />
          {connected ? 'Live' : 'Connecting...'}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Bot} label="Total Agents" value={stats?.agents ?? '—'} color="bg-violet-900/40 text-violet-400" />
        <StatCard icon={GitBranch} label="Workflows" value={stats?.workflows ?? '—'} color="bg-blue-900/40 text-blue-400" />
        <StatCard icon={Play} label="Executions" value={stats?.executions ?? '—'}
          sub={`${stats?.active_executions ?? 0} running`} color="bg-emerald-900/40 text-emerald-400" />
        <StatCard icon={TrendingUp} label="Success Rate" value={`${stats?.success_rate ?? 0}%`}
          sub={`$${stats?.total_cost?.toFixed(4) ?? '0.0000'} spent`} color="bg-amber-900/40 text-amber-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Executions */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Recent Executions</h2>
          {!recent?.length ? (
            <div className="text-center py-8 text-slate-600 text-sm">No executions yet. Run a workflow to get started.</div>
          ) : (
            <div className="space-y-2">
              {recent.map((ex: any) => (
                <div key={ex.id}
                  className={clsx('flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 transition-colors', ex.status === 'completed' ? 'hover:bg-slate-800 cursor-pointer' : '')}
                  onClick={() => ex.status === 'completed' && setResultId(ex.id)}
                >
                  <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', {
                    'bg-emerald-400': ex.status === 'completed',
                    'bg-red-400': ex.status === 'failed',
                    'bg-blue-400 animate-pulse': ex.status === 'running',
                    'bg-yellow-400': ex.status === 'pending',
                  })} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 truncate font-medium">{ex.workflow_name}</div>
                    <div className="text-xs text-slate-500">{formatDistanceToNow(new Date(ex.started_at), { addSuffix: true })}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500">{ex.token_count}T</span>
                    <span className={statusBadge(ex.status)}>{ex.status}</span>
                    {ex.status === 'completed' && <Sparkles size={13} className="text-emerald-600 hover:text-emerald-400" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Events */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">Live Events</h2>
            {connected && <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
          </div>
          {!liveEvents.length ? (
            <div className="text-center py-8 text-slate-600 text-sm">Waiting for events...</div>
          ) : (
            <div className="space-y-2">
              {liveEvents.map((ev, i) => (
                <div key={i} className="log-entry flex items-start gap-2 text-xs p-2 rounded bg-slate-800/50">
                  <span className={clsx('mt-0.5 px-1.5 py-0.5 rounded font-mono font-medium flex-shrink-0', {
                    'bg-violet-900/50 text-violet-400': ev.type === 'agent_done',
                    'bg-amber-900/50 text-amber-400': ev.type === 'tool_call',
                    'bg-blue-900/50 text-blue-400': ev.type === 'stream_chunk',
                    'bg-emerald-900/50 text-emerald-400': ev.type === 'execution_complete',
                    'bg-red-900/50 text-red-400': ev.type === 'execution_error',
                    'bg-slate-700 text-slate-400': !['agent_done','tool_call','stream_chunk','execution_complete','execution_error'].includes(ev.type),
                  })}>
                    {ev.type}
                  </span>
                  <span className="text-slate-400 truncate">
                    {ev.agent && <span className="text-slate-300">{ev.agent}: </span>}
                    {ev.content || ev.tool || ev.error || ev.workflow || ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tokens */}
      <div className="card p-5">
        <div className="flex items-center gap-3">
          <Coins size={18} className="text-amber-400" />
          <span className="text-sm text-slate-400">Total tokens consumed:</span>
          <span className="text-lg font-bold text-slate-100">{(stats?.total_tokens ?? 0).toLocaleString()}</span>
          <span className="text-slate-600">·</span>
          <span className="text-sm text-slate-400">Estimated cost:</span>
          <span className="text-sm font-semibold text-emerald-400">${(stats?.total_cost ?? 0).toFixed(4)}</span>
        </div>
      </div>

      {resultId && <ResultModal executionId={resultId} onClose={() => setResultId(null)} />}
    </div>
  )
}

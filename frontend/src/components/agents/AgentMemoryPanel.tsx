import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Trash2, X } from 'lucide-react'
import { agentsApi, memoryApi } from '../../api/client'
import type { Agent } from '../../types'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-'
}

export function AgentMemoryPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ['memory', agent.id, 'stats'], queryFn: () => memoryApi.stats(agent.id) })
  const { data: history = [] } = useQuery({ queryKey: ['memory', agent.id, 'history'], queryFn: () => memoryApi.history(agent.id, 10) })
  const { data: config } = useQuery({ queryKey: ['agent-memory-config', agent.id], queryFn: () => agentsApi.getMemoryConfig(agent.id) })

  const updateConfig = useMutation({
    mutationFn: (data: any) => agentsApi.updateMemoryConfig(agent.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-memory-config', agent.id] })
      toast.success('Memory settings updated')
    },
    onError: () => toast.error('Failed to update memory settings'),
  })

  const clearMemory = useMutation({
    mutationFn: () => memoryApi.clearAgent(agent.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['memory', agent.id] })
      toast.success(`Deleted ${result.deleted} memories`)
    },
    onError: () => toast.error('Failed to clear memory'),
  })

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-900/40 text-blue-300">
              <Brain size={20} />
            </div>
            <div>
              <div className="font-semibold text-slate-100">{agent.name} Memory</div>
              <div className="text-xs text-slate-500">Persistent vector memory settings and history</div>
            </div>
          </div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4">
              <div className="text-2xl font-bold text-blue-300">{stats?.total_memories ?? 0}</div>
              <div className="text-xs text-slate-500">Total memories</div>
            </div>
            <div className="card p-4">
              <div className="text-2xl font-bold text-violet-300">{stats?.session_count ?? 0}</div>
              <div className="text-xs text-slate-500">Sessions</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-medium text-slate-300">{formatDate(stats?.oldest_memory)}</div>
              <div className="mt-1 text-xs text-slate-500">Oldest memory</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-medium text-slate-300">{formatDate(stats?.newest_memory)}</div>
              <div className="mt-1 text-xs text-slate-500">Newest memory</div>
            </div>
          </div>

          <div className="card space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Memory enabled</div>
                <div className="text-xs text-slate-500">Retrieve relevant memories before each run.</div>
              </div>
              <button
                className={clsx('h-6 w-12 rounded-full transition-colors', config?.memory_enabled ? 'bg-blue-600' : 'bg-slate-700')}
                onClick={() => updateConfig.mutate({ memory_enabled: !config?.memory_enabled })}
              >
                <span className={clsx('block h-5 w-5 rounded-full bg-white transition-transform', config?.memory_enabled ? 'translate-x-6' : 'translate-x-0.5')} />
              </button>
            </div>

            <label className="block">
              <div className="mb-1 flex justify-between text-sm text-slate-400">
                <span>Max memories per query</span>
                <span>{config?.max_memories_per_query ?? 5}</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                className="w-full accent-blue-500"
                value={config?.max_memories_per_query ?? 5}
                onChange={event => updateConfig.mutate({ max_memories_per_query: parseInt(event.target.value, 10) })}
              />
            </label>

            <label className="block">
              <div className="label">Memory window days</div>
              <input
                type="number"
                min={1}
                className="input"
                value={config?.memory_window_days ?? 30}
                onChange={event => updateConfig.mutate({ memory_window_days: parseInt(event.target.value || '30', 10) })}
              />
            </label>

            <button
              className="btn-danger w-full justify-center"
              onClick={() => {
                if (confirm(`Clear all memory for "${agent.name}"? This cannot be undone.`)) clearMemory.mutate()
              }}
            >
              <Trash2 size={15} /> Clear all memory
            </button>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-300">Recent memories</div>
            <div className="divide-y divide-slate-800">
              {history.map((memory, index) => (
                <div key={index} className="p-4">
                  <div className="line-clamp-3 text-sm text-slate-300">{memory.content}</div>
                  <div className="mt-2 text-xs text-slate-600">
                    {formatDate(String(memory.metadata?.timestamp || ''))}
                  </div>
                </div>
              ))}
              {!history.length && <div className="p-8 text-center text-sm text-slate-600">No memories stored yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

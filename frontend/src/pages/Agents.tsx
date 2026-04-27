import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../api/client'
import { Bot, Plus, Trash2, Edit3, MessageSquare, Brain, Wrench, X, Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import type { Agent } from '../types'

const DEFAULTS: Partial<Agent> = {
  name: '', role: '', description: '', system_prompt: '', model: 'claude-sonnet-4-6',
  tools: [], memory_enabled: true, memory_window: 10, max_tokens: 2000,
  temperature: 0.7, max_iterations: 10, timeout: 120, telegram_enabled: false,
}

function AgentForm({ initial, onSave, onCancel, models, tools }: {
  initial: Partial<Agent>
  onSave: (data: Partial<Agent>) => void
  onCancel: () => void
  models: {id: string; name: string; provider: string}[]
  tools: {id: string; name: string; description: string}[]
}) {
  const [form, setForm] = useState<Partial<Agent>>({ ...DEFAULTS, ...initial })
  const set = (k: keyof Agent, v: unknown) => setForm(f => ({ ...f, [k]: v }))
  const toggleTool = (id: string) => {
    const curr = form.tools || []
    set('tools', curr.includes(id) ? curr.filter(t => t !== id) : [...curr, id])
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-100">{initial.id ? 'Edit Agent' : 'Create Agent'}</h2>
          <button onClick={onCancel} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name *</label>
              <input className="input" placeholder="Research Agent" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Role *</label>
              <input className="input" placeholder="researcher" value={form.role} onChange={e => set('role', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="A brief description..." value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          <div>
            <label className="label">System Prompt *</label>
            <textarea className="input min-h-[120px] resize-y" placeholder="You are a helpful AI agent that..." value={form.system_prompt} onChange={e => set('system_prompt', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Model</label>
              <select className="input" value={form.model} onChange={e => set('model', e.target.value)}>
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Temperature ({form.temperature})</label>
              <input type="range" min="0" max="1" step="0.1" className="w-full mt-2 accent-violet-500"
                value={form.temperature} onChange={e => set('temperature', parseFloat(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Max Tokens</label>
              <input type="number" className="input" value={form.max_tokens} onChange={e => set('max_tokens', parseInt(e.target.value))} />
            </div>
            <div>
              <label className="label">Max Iterations</label>
              <input type="number" className="input" value={form.max_iterations} onChange={e => set('max_iterations', parseInt(e.target.value))} />
            </div>
            <div>
              <label className="label">Timeout (s)</label>
              <input type="number" className="input" value={form.timeout} onChange={e => set('timeout', parseInt(e.target.value))} />
            </div>
          </div>

          {/* Tools */}
          <div>
            <label className="label">Tools</label>
            <div className="grid grid-cols-2 gap-2">
              {tools.map(t => (
                <button key={t.id} type="button"
                  onClick={() => toggleTool(t.id)}
                  className={clsx('flex items-center gap-2 p-2.5 rounded-lg border text-sm text-left transition-colors',
                    (form.tools || []).includes(t.id)
                      ? 'bg-violet-900/30 border-violet-600/50 text-violet-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  )}>
                  <Wrench size={14} />
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs opacity-60">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div className={clsx('w-10 h-5 rounded-full transition-colors relative', form.memory_enabled ? 'bg-violet-600' : 'bg-slate-700')}
                onClick={() => set('memory_enabled', !form.memory_enabled)}>
                <div className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform', form.memory_enabled ? 'translate-x-5' : 'translate-x-0.5')} />
              </div>
              <span className="text-sm text-slate-300">Memory</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div className={clsx('w-10 h-5 rounded-full transition-colors relative', form.telegram_enabled ? 'bg-blue-600' : 'bg-slate-700')}
                onClick={() => set('telegram_enabled', !form.telegram_enabled)}>
                <div className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform', form.telegram_enabled ? 'translate-x-5' : 'translate-x-0.5')} />
              </div>
              <span className="text-sm text-slate-300">Telegram</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-800">
          <button className="btn-primary flex-1" onClick={() => onSave(form)}>
            <Check size={16} /> {initial.id ? 'Update Agent' : 'Create Agent'}
          </button>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function Agents() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)

  const { data: agents = [], isLoading } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const { data: models = [] } = useQuery({ queryKey: ['models'], queryFn: agentsApi.getModels })
  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: agentsApi.getTools })

  const createMut = useMutation({
    mutationFn: agentsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); setEditing(null); toast.success('Agent created!') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed to create agent'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: Partial<Agent>) => agentsApi.update(id!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); setEditing(null); toast.success('Agent updated!') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed to update agent'),
  })
  const deleteMut = useMutation({
    mutationFn: agentsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent deleted') },
  })

  const handleSave = (data: Partial<Agent>) => {
    if (editing?.id) updateMut.mutate({ ...data, id: editing.id })
    else createMut.mutate(data)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Agents</h1>
          <p className="text-slate-400 text-sm mt-1">Create and manage AI agents with configurable tools and behavior</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} /> New Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-48 animate-pulse bg-slate-800/50" />)}
        </div>
      ) : !agents.length ? (
        <div className="text-center py-20">
          <Bot size={48} className="mx-auto text-slate-700 mb-4" />
          <div className="text-slate-400 font-medium">No agents yet</div>
          <div className="text-slate-600 text-sm mt-1 mb-4">Create your first AI agent to get started</div>
          <button className="btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Create Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => (
            <div key={agent.id} className="card card-hover p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-900/40 border border-violet-800/40 flex items-center justify-center">
                    <Bot size={20} className="text-violet-400" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-100">{agent.name}</div>
                    <div className="text-xs text-slate-500">{agent.role}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  {agent.telegram_enabled && <span className="badge badge-blue">TG</span>}
                  <span className={agent.is_active ? 'badge-green badge' : 'badge-gray badge'}>
                    {agent.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {agent.description && <p className="text-sm text-slate-500 line-clamp-2">{agent.description}</p>}

              <div className="flex flex-wrap gap-1.5">
                <span className="badge badge-purple">{agent.model.split('-').slice(0,2).join('-')}</span>
                {agent.memory_enabled && <span className="badge badge-blue"><Brain size={10} className="mr-1" />Memory</span>}
                {(agent.tools || []).map(t => {
                  const found = tools.find((tool: {id: string; name: string}) => tool.id === t)
                  const label = found?.name ?? t.replace(/_/g, ' ')
                  return <span key={t} className="badge badge-gray">{label}</span>
                })}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center border-t border-slate-800 pt-3">
                <div><div className="text-xs text-slate-500">Temp</div><div className="text-sm font-medium text-slate-300">{agent.temperature}</div></div>
                <div><div className="text-xs text-slate-500">Tokens</div><div className="text-sm font-medium text-slate-300">{agent.max_tokens}</div></div>
                <div><div className="text-xs text-slate-500">Iter</div><div className="text-sm font-medium text-slate-300">{agent.max_iterations}</div></div>
              </div>

              <div className="flex gap-2 mt-auto">
                <button className="btn-secondary flex-1 text-xs" onClick={() => setEditing(agent)}>
                  <Edit3 size={13} /> Edit
                </button>
                <button className="btn-danger text-xs px-3" onClick={() => {
                  if (confirm(`Delete agent "${agent.name}"?`)) deleteMut.mutate(agent.id)
                }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <AgentForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          models={models}
          tools={tools}
        />
      )}
    </div>
  )
}

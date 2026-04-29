import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Check, MessageSquare, Plus, Trash2, Wrench, X } from 'lucide-react'
import { agentsApi } from '../api/client'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { GlowCard } from '../components/ui/GlowCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { AgentMemoryPanel } from '../components/agents/AgentMemoryPanel'
import { ReputationCard } from '../components/agents/ReputationCard'
import { SkeletonCard } from '../components/ui/Skeleton'
import type { Agent } from '../types'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

const DEFAULTS: Partial<Agent> = {
  name: '',
  role: '',
  description: '',
  system_prompt: '',
  model: 'llama-3.3-70b-versatile',
  tools: [],
  memory_enabled: true,
  memory_window: 10,
  max_tokens: 2000,
  temperature: 0.7,
  max_iterations: 10,
  timeout: 120,
  max_retries: 3,
  retry_delay_seconds: 5,
  retry_backoff_multiplier: 2.0,
  retry_on_timeout: true,
  telegram_enabled: false,
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
    const current = form.tools || []
    set('tools', current.includes(id) ? current.filter(t => t !== id) : [...current, id])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-obsidian-900">
        <div className="flex items-center justify-between border-b border-white/[0.08] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{initial.id ? 'Configure teammate' : 'Add teammate'}</h2>
            <p className="text-xs text-obsidian-500">Define the role, tools, model, and operating constraints.</p>
          </div>
          <button onClick={onCancel} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <div className="space-y-5 p-5">
          {initial.id && <ReputationCard agent={initial as Agent} />}

          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><label className="label">Role</label><input className="input" value={form.role} onChange={e => set('role', e.target.value)} /></div>
          </div>
          <div><label className="label">Description</label><input className="input" value={form.description} onChange={e => set('description', e.target.value)} /></div>
          <div><label className="label">System Prompt</label><textarea className="input min-h-[140px] resize-y" value={form.system_prompt} onChange={e => set('system_prompt', e.target.value)} /></div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Model</label>
              <select className="input" value={form.model} onChange={e => set('model', e.target.value)}>
                {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Temperature ({form.temperature})</label>
              <input type="range" min="0" max="1" step="0.1" className="w-full accent-accent-500" value={form.temperature} onChange={e => set('temperature', parseFloat(e.target.value))} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div><label className="label">Tokens</label><input type="number" className="input" value={form.max_tokens} onChange={e => set('max_tokens', parseInt(e.target.value))} /></div>
            <div><label className="label">Iterations</label><input type="number" className="input" value={form.max_iterations} onChange={e => set('max_iterations', parseInt(e.target.value))} /></div>
            <div><label className="label">Timeout</label><input type="number" className="input" value={form.timeout} onChange={e => set('timeout', parseInt(e.target.value))} /></div>
            <div><label className="label">Retries</label><input type="number" min={0} max={10} className="input" value={form.max_retries} onChange={e => set('max_retries', parseInt(e.target.value))} /></div>
          </div>

          <div>
            <label className="label">Tools</label>
            <div className="grid gap-2 md:grid-cols-2">
              {tools.map(tool => (
                <button key={tool.id} type="button" onClick={() => toggleTool(tool.id)}
                  className={clsx('rounded-xl border p-3 text-left text-sm transition-all duration-150',
                    (form.tools || []).includes(tool.id)
                      ? 'border-accent-400/40 bg-accent-400/10 text-accent-100 shadow-glow-sm'
                      : 'border-white/[0.08] bg-white/[0.03] text-obsidian-300 hover:bg-white/[0.05]'
                  )}>
                  <div className="flex items-center gap-2 font-medium"><Wrench size={14} /> {tool.name}</div>
                  <div className="mt-1 line-clamp-1 text-xs opacity-60">{tool.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-5">
            {(['memory_enabled', 'telegram_enabled', 'retry_on_timeout'] as const).map(key => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-obsidian-200">
                <input type="checkbox" className="accent-accent-500" checked={Boolean(form[key])} onChange={e => set(key, e.target.checked)} />
                {key.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-3 border-t border-white/[0.08] p-5">
          <button className="btn-primary flex-1" onClick={() => onSave(form)}>
            <Check size={16} /> {initial.id ? 'Save configuration' : 'Add teammate'}
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
  const [memoryAgent, setMemoryAgent] = useState<Agent | null>(null)
  const { data: agents = [], isLoading } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const { data: models = [] } = useQuery({ queryKey: ['models'], queryFn: agentsApi.getModels })
  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: agentsApi.getTools })

  const createMut = useMutation({
    mutationFn: agentsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); setEditing(null); toast.success('Agent created') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed to create agent'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: Partial<Agent>) => agentsApi.update(id!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); setEditing(null); toast.success('Agent updated') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed to update agent'),
  })
  const deleteMut = useMutation({
    mutationFn: agentsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); toast.success('Agent deleted') },
  })

  const handleSave = (data: Partial<Agent>) => editing?.id ? updateMut.mutate({ ...data, id: editing.id }) : createMut.mutate(data)

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Your Team</h1>
          <p className="mt-2 text-sm text-obsidian-400">AI employees working for you 24/7.</p>
        </div>
        <button className="btn-primary h-11" onClick={() => setEditing({})}><Plus size={16} /> Add Agent</button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} className="h-72" />)}
        </div>
      ) : !agents.length ? (
        <GlowCard className="py-24 text-center">
          <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-2xl border border-accent-400/20 bg-accent-400/10 text-accent-300"><UsersIcon /></div>
          <div className="text-lg font-medium text-white">Your team is empty - create your first AI employee</div>
          <p className="mt-2 text-sm text-obsidian-500">Start with one teammate, then let the company grow around real work.</p>
          <button className="btn-primary mt-6" onClick={() => setEditing({})}><Plus size={16} /> Create Agent</button>
        </GlowCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent, index) => (
            <GlowCard key={agent.id} glowColor={index % 2 ? 'cyan' : 'indigo'} className={clsx('p-5 text-center', agent.is_active && 'animate-border-glow')}>
              <div className="flex justify-center"><AgentAvatar name={agent.name} size="xl" running={false} /></div>
              <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-white">{agent.name}</h3>
              <p className="mt-1 text-sm text-obsidian-400">{agent.role}</p>
              {agent.description && <p className="mx-auto mt-2 line-clamp-2 max-w-xs text-xs leading-5 text-obsidian-500">{agent.description}</p>}

              <div className="mt-4 flex justify-center"><StatusBadge status={agent.is_active ? 'active' : 'idle'} /></div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2">
                  <div className="truncate font-mono text-[11px] text-cyan-300">{agent.model.split('-').slice(0, 2).join('-')}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-obsidian-500">Model</div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2">
                  <div className="font-mono text-[11px] text-accent-300">{agent.tools?.length ?? 0}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-obsidian-500">Tools</div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2">
                  <div className="font-mono text-[11px] text-emerald-300">{agent.memory_enabled ? 'On' : 'Off'}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-obsidian-500">Memory</div>
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button className="btn-secondary flex-1 text-xs" onClick={() => setEditing(agent)}>Configure</button>
                <Link to="/workflows" className="btn-secondary flex-1 text-xs"><MessageSquare size={13} /> Chat</Link>
                <button className="btn-secondary px-3 text-xs" onClick={() => setMemoryAgent(agent)}><Brain size={13} /></button>
                <button className="btn-danger px-3 text-xs" onClick={() => confirm(`Delete agent "${agent.name}"?`) && deleteMut.mutate(agent.id)}><Trash2 size={13} /></button>
              </div>
            </GlowCard>
          ))}
        </div>
      )}

      {editing !== null && <AgentForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} models={models} tools={tools} />}
      {memoryAgent && <AgentMemoryPanel agent={memoryAgent} onClose={() => setMemoryAgent(null)} />}
    </div>
  )
}

function UsersIcon() {
  return (
    <div className="flex -space-x-3">
      <AgentAvatar name="Research" size="md" />
      <AgentAvatar name="Ops" size="md" />
      <AgentAvatar name="Sales" size="md" />
    </div>
  )
}

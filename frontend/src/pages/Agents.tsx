import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Briefcase, Check, Loader2, MessageSquare, Plus, Trash2, Wrench, X } from 'lucide-react'
import { clsx } from 'clsx'

import { agentsApi, extractApiError, modelsApi } from '../api/client'
import { AgentMemoryPanel } from '../components/agents/AgentMemoryPanel'
import { ReputationCard } from '../components/agents/ReputationCard'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { EmptyState } from '../components/ui/EmptyState'
import { GlowCard } from '../components/ui/GlowCard'
import { AgentCardSkeleton } from '../components/ui/Skeleton'
import { StatusDot } from '../components/ui/StatusDot'
import { TrustScoreBar } from '../components/ui/TrustScoreBar'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { Agent, ModelConfigRecord } from '../types'


const DEFAULTS: Partial<Agent> = {
  name: '',
  role: '',
  role_slug: 'research_agent',
  seniority_level: 1,
  autonomy_level: 'supervised',
  trust_score: 50,
  description: '',
  system_prompt: '',
  model: 'llama-3.3-70b-versatile',
  model_config_id: null,
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

const ROLE_OPTIONS = [
  { value: 'research_agent', label: 'Research Agent' },
  { value: 'customer_support', label: 'Customer Support' },
  { value: 'documentation_agent', label: 'Documentation Agent' },
  { value: 'sde_1', label: 'SDE 1' },
  { value: 'sde_2', label: 'SDE 2' },
  { value: 'senior_engineer', label: 'Senior Engineer' },
  { value: 'tech_lead', label: 'Tech Lead' },
  { value: 'security_engineer', label: 'Security Engineer' },
  { value: 'product_manager', label: 'Product Manager' },
  { value: 'chief_of_staff', label: 'Chief of Staff' },
]

const AUTONOMY_OPTIONS = [
  { value: 'supervised', label: 'Supervised' },
  { value: 'semi_autonomous', label: 'Semi-Autonomous' },
  { value: 'autonomous', label: 'Autonomous' },
]

function costLabel(value?: number | null) {
  return value == null ? '—' : `$${value.toFixed(2)}`
}

function humanizeModelId(value?: string | null) {
  if (!value) return 'Legacy default'
  return value.replace(/^ollama\//, '')
}

function ModelSummary({
  model,
  fallbackModelId,
}: {
  model: ModelConfigRecord | null
  fallbackModelId?: string | null
}) {
  if (!model) {
    return (
      <div className="space-y-1 text-sm text-white/45">
        <div>Org default model config is not saved yet.</div>
        <div className="text-white/55">Current fallback: {humanizeModelId(fallbackModelId)}</div>
      </div>
    )
  }

  return (
    <div className="space-y-1 text-sm text-white/65">
      <div className="font-medium text-white/85">{model.display_name}</div>
      <div>
        {model.provider} · {model.context_window ? `${Math.round(model.context_window / 1000)}K context` : 'Context unknown'} · Tool calling: {model.supports_tools ? '✓' : '—'}
      </div>
      <div>{costLabel(model.cost_per_million_input_tokens)} / {costLabel(model.cost_per_million_output_tokens)} per 1M tokens</div>
    </div>
  )
}

function AgentForm({
  initial,
  onSave,
  onCancel,
  models,
  savedModels,
  tools,
  isSaving,
  memoryAvailable,
}: {
  initial: Partial<Agent>
  onSave: (data: { agent: Partial<Agent>; modelConfigId: string | null; useOrgDefault: boolean }) => void
  onCancel: () => void
  models: {id: string; name: string; provider: string}[]
  savedModels: ModelConfigRecord[]
  tools: {id: string; name: string; description: string}[]
  isSaving?: boolean
  memoryAvailable: boolean
}) {
  const [form, setForm] = useState<Partial<Agent>>({ ...DEFAULTS, ...initial })
  const [useOrgDefault, setUseOrgDefault] = useState(initial.model_config_id == null)
  const [selectedModelConfigId, setSelectedModelConfigId] = useState<string | null>(initial.model_config_id ?? null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const set = (key: keyof Agent, value: unknown) => setForm(prev => ({ ...prev, [key]: value }))
  const toggleTool = (id: string) => {
    const current = form.tools || []
    set('tools', current.includes(id) ? current.filter(tool => tool !== id) : [...current, id])
  }

  const defaultModel = savedModels.find(model => model.is_default) || null
  const selectedSavedModel = selectedModelConfigId ? savedModels.find(model => model.id === selectedModelConfigId) || null : null
  const hasModelLibrary = savedModels.length > 0
  const busy = Boolean(isSaving || isSubmitting)

  useEffect(() => {
    if (!isSaving) {
      setIsSubmitting(false)
    }
  }, [isSaving])

  const submit = async () => {
    if (busy) {
      return
    }
    if (!form.name?.trim()) {
      toast.error('Agent name is required')
      return
    }
    if (!form.role?.trim()) {
      toast.error('Role is required — e.g. "Market Researcher"')
      return
    }
    if (!form.system_prompt?.trim()) {
      toast.error('System prompt is required — tell this agent what it does')
      return
    }

    const selectedConfig = savedModels.find(m => m.id === selectedModelConfigId) || null
    const fallbackModel = useOrgDefault
      ? (defaultModel?.model_id || form.model)
      : (selectedConfig?.model_id || form.model)

    setIsSubmitting(true)
    try {
      await Promise.resolve(onSave({
        agent: { ...form, model: fallbackModel },
        modelConfigId: useOrgDefault ? null : selectedModelConfigId,
        useOrgDefault,
      }))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div data-testid="agent-form" className="glass-elevated max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/[0.08] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{initial.id ? 'Configure teammate' : 'Add teammate'}</h2>
            <p className="text-xs text-ink-secondary">Define the role, tools, model, and operating constraints.</p>
          </div>
          <button onClick={onCancel} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <div className="space-y-5 p-5">
          {initial.id && <ReputationCard agent={initial as Agent} />}

          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Name</label><input className="input" placeholder="Name" value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><label className="label">Role</label><input className="input" placeholder="Role" value={form.role} onChange={e => set('role', e.target.value)} /></div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Role Profile</h3>
              <p className="mt-1 text-xs text-ink-secondary">Set the teammate identity that powers org structure, autonomy, and trust-aware interfaces.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="label">Role slug</label>
                <select className="input" value={form.role_slug ?? 'research_agent'} onChange={e => set('role_slug', e.target.value)}>
                  {ROLE_OPTIONS.map(role => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Seniority level</label>
                <select className="input" value={form.seniority_level ?? 1} onChange={e => set('seniority_level', parseInt(e.target.value, 10))}>
                  {[1, 2, 3, 4, 5].map(level => (
                    <option key={level} value={level}>Level {level}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Autonomy level</label>
                <select className="input" value={form.autonomy_level ?? 'supervised'} onChange={e => set('autonomy_level', e.target.value)}>
                  {AUTONOMY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div><label className="label">Description</label><input className="input" placeholder="Agent description" value={form.description} onChange={e => set('description', e.target.value)} /></div>
          <div><label className="label">System Prompt</label><textarea className="input min-h-[140px] resize-y" placeholder="System prompt — tell this agent what it does" value={form.system_prompt} onChange={e => set('system_prompt', e.target.value)} /></div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Temperature ({form.temperature})</label>
              <input type="range" min="0" max="1" step="0.1" className="w-full accent-blue-500" value={form.temperature} onChange={e => set('temperature', parseFloat(e.target.value))} />
            </div>
            <div>
              <label className="label">Legacy model string</label>
              <select className="input" value={form.model} onChange={e => set('model', e.target.value)}>
                {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
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
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => toggleTool(tool.id)}
                  className={clsx(
                    'rounded-xl border p-3 text-left text-sm transition-all duration-150',
                    (form.tools || []).includes(tool.id)
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-100 shadow-glow-sm'
                      : 'border-white/[0.08] bg-white/[0.03] text-white/75 hover:bg-white/[0.05]',
                  )}
                >
                  <div className="flex items-center gap-2 font-medium"><Wrench size={14} /> {tool.name}</div>
                  <div className="mt-1 line-clamp-1 text-xs opacity-60">{tool.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Model</h3>
              <p className="mt-1 text-xs text-ink-secondary">Choose whether this teammate inherits the org default or uses a dedicated model config.</p>
            </div>

            {hasModelLibrary ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-5 text-sm text-white/75">
                  <label className="flex items-center gap-2">
                    <input type="radio" className="accent-blue-500" checked={useOrgDefault} onChange={() => setUseOrgDefault(true)} />
                    Use org default
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" className="accent-blue-500" checked={!useOrgDefault} onChange={() => setUseOrgDefault(false)} />
                    Use specific model
                  </label>
                </div>

                {!useOrgDefault && (
                  <select className="input" value={selectedModelConfigId ?? ''} onChange={e => setSelectedModelConfigId(e.target.value || null)}>
                    <option value="">Select a model config</option>
                    {savedModels.filter(model => model.is_active).map(model => (
                      <option key={model.id} value={model.id}>
                        {model.display_name} · {model.provider}
                      </option>
                    ))}
                  </select>
                )}

                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                  {useOrgDefault ? <ModelSummary model={defaultModel} fallbackModelId={form.model} /> : <ModelSummary model={selectedSavedModel} fallbackModelId={form.model} />}
                  <Link to="/settings/models" className="mt-3 inline-flex text-xs text-blue-300 transition hover:text-white">
                    Manage models →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-white/55">
                <p>No saved model configs yet. This agent will use {humanizeModelId(form.model)} until you add configs in the Model Library.</p>
                <Link to="/settings/models" className="inline-flex text-xs text-blue-300 transition hover:text-white">
                  Manage models →
                </Link>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-5">
            {(['memory_enabled', 'telegram_enabled', 'retry_on_timeout'] as const).map(key => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  className="accent-blue-500"
                  checked={Boolean(form[key])}
                  disabled={key === 'memory_enabled' && !memoryAvailable}
                  onChange={e => set(key, e.target.checked)}
                />
                {key.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
          {!memoryAvailable && (
            <p className="text-xs text-amber-300/80">
              Persistent memory is available on Solo and above. New teammates on Free start with memory disabled.
            </p>
          )}
        </div>

        <div className="flex gap-3 border-t border-white/[0.08] p-5">
          <button
            className="btn-primary flex-1"
            onClick={submit}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check size={16} />
                {initial.id ? 'Save configuration' : 'Add teammate'}
              </>
            )}
          </button>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function Agents() {
  const auth = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)
  const [memoryAgent, setMemoryAgent] = useState<Agent | null>(null)
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null)
  const { data: agents = [], isLoading, isError } = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
    refetchOnMount: 'always',
  })
  const { data: models = [], isError: modelsError } = useQuery({ queryKey: ['models'], queryFn: agentsApi.getModels })
  const { data: savedModels = [], isError: savedModelsError } = useQuery({ queryKey: ['model-configs'], queryFn: modelsApi.list })
  const { data: tools = [], isError: toolsError } = useQuery({ queryKey: ['tools'], queryFn: agentsApi.getTools })
  const memoryAvailable = auth.activeOrg?.plan !== 'free'

  const createMut = useMutation({
    mutationFn: agentsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent created')
    },
    onError: error => toast.error(extractApiError(error)),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: Partial<Agent>) => agentsApi.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent updated')
    },
    onError: error => toast.error(extractApiError(error)),
  })
  const deleteMut = useMutation({
    mutationFn: agentsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      setAgentToDelete(null)
      toast.success('Agent deleted')
    },
  })

  const handleSave = async (data: { agent: Partial<Agent>; modelConfigId: string | null; useOrgDefault: boolean }) => {
    try {
      const saved = editing?.id
        ? await updateMut.mutateAsync({ ...data.agent, id: editing.id })
        : await createMut.mutateAsync(data.agent)

      // Model assignment is optional — never let it block modal close.
      if (savedModels.length > 0) {
        try {
          await agentsApi.assignModel(saved.id, data.useOrgDefault ? null : data.modelConfigId)
        } catch (modelErr) {
          toast.warning(
            extractApiError(modelErr) ||
            'Agent saved. Model assignment failed — set it in agent settings.',
          )
        }
      }

      await qc.invalidateQueries({ queryKey: ['agents'] })
      await qc.invalidateQueries({ queryKey: ['model-configs'] })
      setEditing(null)
    } catch (createErr) {
      // Mutation onError already surfaces the toast.
      console.error('Agent save failed:', createErr)
    }
  }

  if (isError || modelsError || savedModelsError || toolsError) {
    return (
      <div className="p-6 text-center text-white/40">
        <p>Could not load agents.</p>
        <button className="mt-3 text-sm text-blue-300" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">AI Team</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            {agents.filter(agent => agent.is_active).length} active · {agents.length} total
          </p>
        </div>
        <button className="btn-primary h-11" onClick={() => setEditing({ memory_enabled: memoryAvailable })}><Plus size={16} /> Add Agent</button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <AgentCardSkeleton key={index} />)}
        </div>
      ) : !agents.length ? (
        <GlowCard className="py-8">
          <EmptyState
            icon={<Briefcase size={28} />}
            title="Your first agent is waiting"
            description="Most founders start with a Market Researcher. It monitors your competitors while you work on everything else."
            action={{ label: 'Browse marketplace →', onClick: () => navigate('/marketplace') }}
            secondaryAction={{ label: 'Create from scratch', onClick: () => setEditing({ memory_enabled: memoryAvailable }) }}
          />
        </GlowCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent, index) => {
            return (
              <GlowCard
                key={agent.id}
                glowColor={index % 2 ? 'emerald' : 'blue'}
                className={clsx('agent-card cursor-pointer overflow-hidden rounded-2xl', agent.is_active && 'border-blue-500/20')}
              >
                <div
                  className="h-0.5 w-full"
                  style={{
                    background: `linear-gradient(90deg, ${agent.client_color || '#2563EB'}, ${(agent.client_color || '#2563EB')}40)`,
                  }}
                />
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <AgentAvatar
                      name={agent.persona_name || agent.name}
                      size="md"
                      running={agent.current_status === 'working'}
                      color={agent.client_color ? `linear-gradient(135deg, ${agent.client_color}22, ${agent.client_color})` : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-white">{agent.persona_name || agent.name}</p>
                        <StatusDot
                          status={agent.current_status === 'working' ? 'working' : agent.current_status === 'waiting_approval' ? 'waiting_approval' : 'idle'}
                          size="sm"
                        />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[#4B5A73]">{agent.role_slug || agent.role}</p>
                    </div>
                  </div>

                  {agent.current_status === 'working' && agent.current_task_summary && (
                    <p className="mt-3 truncate rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-[#8B9DBE]">
                      {agent.current_task_summary}
                    </p>
                  )}

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[#4B5A73]">Trust</span>
                      <span className="font-mono text-[11px] font-semibold text-white">
                        {Math.round(agent.trust_score ?? 50)}%
                      </span>
                    </div>
                    <TrustScoreBar score={agent.trust_score ?? 50} size="xs" showLabel={false} />
                  </div>

                  {agent.client_name && (
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#4B5A73]">
                      <Briefcase size={11} />
                      <span className="truncate">{agent.client_name}</span>
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-center">
                      <div className="font-mono text-xs font-semibold text-blue-300">{agent.tools?.length ?? 0}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-[#4B5A73]">Tools</div>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-center">
                      <div className="font-mono text-xs font-semibold text-emerald-300">{agent.memory_enabled ? 'On' : 'Off'}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-[#4B5A73]">Memory</div>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-center">
                      <div className="font-mono text-xs font-semibold text-white">{agent.is_active ? 'Live' : 'Paused'}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-[#4B5A73]">Status</div>
                    </div>
                  </div>

                  <div className="mt-5 flex gap-2">
                    <button className="btn-secondary flex-1 text-xs" onClick={() => setEditing(agent)}>Configure</button>
                    <Link to="/workflows" className="btn-secondary flex-1 text-xs"><MessageSquare size={13} /> Workflows</Link>
                    <button className="btn-secondary px-3 text-xs" onClick={() => setMemoryAgent(agent)}><Brain size={13} /></button>
                    <button className="btn-danger px-3 text-xs" onClick={() => setAgentToDelete(agent)}><Trash2 size={13} /></button>
                  </div>
                </div>
              </GlowCard>
            )
          })}
        </div>
      )}

      {editing !== null && (
        <AgentForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          models={models}
          savedModels={savedModels}
          tools={tools}
          isSaving={createMut.isPending || updateMut.isPending}
          memoryAvailable={memoryAvailable}
        />
      )}
      {memoryAgent && <AgentMemoryPanel agent={memoryAgent} onClose={() => setMemoryAgent(null)} />}
      <ConfirmDialog
        open={Boolean(agentToDelete)}
        title={`Delete ${agentToDelete?.name || 'agent'}?`}
        description="This removes the teammate from your workspace. Existing execution history stays available, but new workflows cannot use this agent."
        confirmLabel="Delete agent"
        loading={deleteMut.isPending}
        onClose={() => setAgentToDelete(null)}
        onConfirm={() => agentToDelete && deleteMut.mutate(agentToDelete.id)}
      />
    </div>
  )
}

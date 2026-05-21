import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Briefcase, Check, ChevronRight, Loader2, MessageSquare, Plus, Search, Trash2, Wrench, X } from 'lucide-react'
import { clsx } from 'clsx'

import { agentsApi, clientsApi, evalsApi, executionsApi, extractApiError, memoryApi, modelsApi } from '../api/client'
import { ReputationCard } from '../components/agents/ReputationCard'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { PageShell } from '../components/Layout/PageShell'
import { AgentCardSkeleton } from '../components/ui/Skeleton'
import { StatusDot } from '../components/ui/StatusDot'
import { TrustRing } from '../components/ui/TrustRing'
import { FloatingField } from '../components/AuthShell'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { Agent, AgentMemoryItem, AgentPreference, ClientWithStats, ModelConfigRecord } from '../types'


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

const ADVANCED_AGENT_KEYS = [
  'role_slug',
  'seniority_level',
  'autonomy_level',
  'description',
  'temperature',
  'max_tokens',
  'memory_enabled',
  'memory_window',
  'max_iterations',
  'timeout',
  'max_retries',
  'retry_delay_seconds',
  'retry_backoff_multiplier',
  'retry_on_timeout',
  'telegram_enabled',
] as const

const ROLE_NAME_BY_SLUG = new Map(ROLE_OPTIONS.map(role => [role.value, role.label]))
const STAGGER_CLASSES = [
  'animate-d-0',
  'animate-d-1',
  'animate-d-2',
  'animate-d-3',
  'animate-d-4',
  'animate-d-5',
  'animate-d-6',
] as const

function normalizeAgentValue(value: unknown) {
  if (value == null) return null
  if (typeof value === 'string') return value.trim()
  return value
}

function hasCustomAdvancedSettings(agent: Partial<Agent>) {
  return ADVANCED_AGENT_KEYS.some(key => normalizeAgentValue(agent[key]) !== normalizeAgentValue(DEFAULTS[key]))
}

function buildPersonaSuggestions(name: string, roleSlug?: string | null) {
  const roleSuggestions: Record<string, string[]> = {
    research_agent: ['Maya', 'Avery', 'Nora'],
    customer_support: ['Jordan', 'Mila', 'Sage'],
    documentation_agent: ['Quinn', 'Tess', 'Rowan'],
    senior_engineer: ['Alex', 'Sam', 'Kai'],
    product_manager: ['Parker', 'Reese', 'Morgan'],
  }

  const suggestions = new Set<string>()
  const firstWord = name.trim().split(/\s+/)[0]
  if (/^[A-Za-z][A-Za-z'-]{1,}$/.test(firstWord)) {
    suggestions.add(firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase())
  }
  for (const suggestion of roleSuggestions[roleSlug || ''] || ['Maya', 'Jordan', 'Alex']) {
    suggestions.add(suggestion)
  }
  return Array.from(suggestions).slice(0, 4)
}

function presentStatus(status?: string | null) {
  if (!status) return 'idle'
  if (status === 'pending_review') return 'needs review'
  if (status === 'waiting_approval') return 'waiting approval'
  return status.replace(/_/g, ' ')
}

function costLabel(value?: number | null) {
  return value == null ? '—' : `$${value.toFixed(2)}`
}

function humanizeModelId(value?: string | null) {
  if (!value) return 'Legacy default'
  return value.replace(/^ollama\//, '')
}

function roleAccent(roleSlug?: string | null) {
  switch (roleSlug) {
    case 'customer_support':
      return { bg: 'rgba(16,185,129,0.22)', dot: 'dot-green' }
    case 'documentation_agent':
      return { bg: 'rgba(139,92,246,0.22)', dot: 'dot-blue' }
    case 'product_manager':
    case 'chief_of_staff':
      return { bg: 'rgba(245,158,11,0.22)', dot: 'dot-amber' }
    default:
      return { bg: 'rgba(99,102,241,0.22)', dot: 'dot-blue' }
  }
}

function FloatingTextarea({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const lifted = focused || value.length > 0

  return (
    <label className="group relative block">
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-3.5 pb-3 pt-6 text-sm text-white outline-none transition-all duration-150"
        style={{
          minHeight: '120px',
          resize: 'vertical',
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${focused ? 'rgba(99,102,241,0.70)' : 'rgba(255,255,255,0.09)'}`,
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.13)' : 'none',
        }}
      />
      <span
        className="pointer-events-none absolute left-3.5 font-medium transition-all duration-200"
        style={{
          top: lifted ? '8px' : '18px',
          fontSize: lifted ? '10px' : '13px',
          letterSpacing: lifted ? '0.10em' : 'normal',
          textTransform: lifted ? 'uppercase' : 'none',
          color: focused ? 'rgba(165,180,252,0.90)' : 'rgba(255,255,255,0.30)',
        }}
      >
        {label}
      </span>
    </label>
  )
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
  clients,
  isSaving,
  memoryAvailable,
}: {
  initial: Partial<Agent>
  onSave: (data: { agent: Partial<Agent>; modelConfigId: string | null; useOrgDefault: boolean }) => void
  onCancel: () => void
  models: {id: string; name: string; provider: string}[]
  savedModels: ModelConfigRecord[]
  tools: {id: string; name: string; description: string}[]
  clients: ClientWithStats[]
  isSaving?: boolean
  memoryAvailable: boolean
}) {
  const [form, setForm] = useState<Partial<Agent>>({ ...DEFAULTS, ...initial })
  const [useOrgDefault, setUseOrgDefault] = useState(initial.model_config_id == null)
  const [selectedModelConfigId, setSelectedModelConfigId] = useState<string | null>(initial.model_config_id ?? null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(() => hasCustomAdvancedSettings({ ...DEFAULTS, ...initial }))
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

  useEffect(() => {
    setForm({ ...DEFAULTS, ...initial })
    setUseOrgDefault(initial.model_config_id == null)
    setSelectedModelConfigId(initial.model_config_id ?? null)
    setShowAdvanced(hasCustomAdvancedSettings({ ...DEFAULTS, ...initial }))
  }, [initial])

  useEffect(() => {
    if (!form.role?.trim() && form.role_slug) {
      const suggestedRole = ROLE_NAME_BY_SLUG.get(form.role_slug)
      if (suggestedRole) {
        set('role', suggestedRole)
      }
    }
  }, [form.role, form.role_slug])

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

  const personaSuggestions = buildPersonaSuggestions(form.name || '', form.role_slug)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm lg:pl-[264px] lg:pr-6">
      <div data-testid="agent-form" className="glass-elevated max-h-[90vh] w-full max-w-3xl overflow-y-auto lg:max-w-[min(48rem,calc(100vw-320px))]">
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
            <div>
              <FloatingField label="Name" type="text" value={form.name ?? ''} onChange={value => set('name', value)} />
            </div>
            <div>
              <FloatingField label="Persona Name" type="text" value={form.persona_name ?? ''} onChange={value => set('persona_name', value)} />
              <div className="mt-2 flex flex-wrap gap-2">
                {personaSuggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => set('persona_name', suggestion)}
                    className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-200 transition hover:border-blue-400/40 hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={clsx('grid gap-4', clients.length > 0 ? 'md:grid-cols-2' : 'md:grid-cols-1')}>
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role_slug ?? 'research_agent'} onChange={e => set('role_slug', e.target.value)}>
                {ROLE_OPTIONS.map(role => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
            {clients.length > 0 && (
              <div>
                <label className="label">Assign to Client</label>
                <select className="input" value={form.client_id ?? ''} onChange={e => set('client_id', e.target.value || null)}>
                  <option value="">Unassigned</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <FloatingTextarea label="Instructions / System Prompt" value={form.system_prompt ?? ''} onChange={value => set('system_prompt', value)} />
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
                    <input type="radio" className="indigo-blue-500" checked={useOrgDefault} onChange={() => setUseOrgDefault(true)} />
                    Use org default
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" className="indigo-blue-500" checked={!useOrgDefault} onChange={() => setUseOrgDefault(false)} />
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

          <button
            type="button"
            onClick={() => setShowAdvanced(value => !value)}
            className="flex w-full items-center gap-2 py-2 text-xs font-medium text-[#4B5A73] transition-colors hover:text-[#8B9DBE]"
          >
            <ChevronRight size={13} className={clsx('transition-transform', showAdvanced && 'rotate-90')} />
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="space-y-5 border-t border-white/[0.08] pt-2">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-white">Role Profile</h3>
                  <p className="mt-1 text-xs text-ink-secondary">Fine-tune how this teammate is classified and governed inside the org.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <FloatingField label="Role Title" type="text" value={form.role ?? ''} onChange={value => set('role', value)} />
                  </div>
                  <div>
                    <label className="label">Seniority Level</label>
                    <select className="input" value={form.seniority_level ?? 1} onChange={e => set('seniority_level', parseInt(e.target.value, 10))}>
                      {[1, 2, 3, 4, 5].map(level => (
                        <option key={level} value={level}>Level {level}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Autonomy Level</label>
                    <select className="input" value={form.autonomy_level ?? 'supervised'} onChange={e => set('autonomy_level', e.target.value)}>
                      {AUTONOMY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <FloatingField label="Description" type="text" value={form.description ?? ''} onChange={value => set('description', value)} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Temperature ({form.temperature})</label>
                  <input type="range" min="0" max="1" step="0.1" className="w-full indigo-blue-500" value={form.temperature} onChange={e => set('temperature', parseFloat(e.target.value))} />
                </div>
                <div>
                  <label className="label">Max Tokens</label>
                  <input type="number" className="input" value={form.max_tokens} onChange={e => set('max_tokens', parseInt(e.target.value, 10))} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Memory Window</label>
                  <input type="number" className="input" value={form.memory_window} onChange={e => set('memory_window', parseInt(e.target.value, 10))} />
                </div>
                <div>
                  <label className="label">Legacy Model String</label>
                  <select className="input" value={form.model} onChange={e => set('model', e.target.value)}>
                    {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="label">Max Iterations</label><input type="number" className="input" value={form.max_iterations} onChange={e => set('max_iterations', parseInt(e.target.value, 10))} /></div>
                <div><label className="label">Timeout</label><input type="number" className="input" value={form.timeout} onChange={e => set('timeout', parseInt(e.target.value, 10))} /></div>
                <div><label className="label">Max Retries</label><input type="number" min={0} max={10} className="input" value={form.max_retries} onChange={e => set('max_retries', parseInt(e.target.value, 10))} /></div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="label">Retry Delay</label><input type="number" className="input" value={form.retry_delay_seconds} onChange={e => set('retry_delay_seconds', parseInt(e.target.value, 10))} /></div>
                <div><label className="label">Retry Backoff Multiplier</label><input type="number" step="0.1" className="input" value={form.retry_backoff_multiplier} onChange={e => set('retry_backoff_multiplier', parseFloat(e.target.value))} /></div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                  <div className="flex flex-col gap-3">
                    {(['memory_enabled', 'retry_on_timeout', 'telegram_enabled'] as const).map(key => (
                      <label key={key} className="flex cursor-pointer items-center justify-between gap-3 text-sm text-white/75">
                        <span>{key.replace(/_/g, ' ')}</span>
                        <input
                          type="checkbox"
                          className="indigo-blue-500"
                          checked={Boolean(form[key])}
                          disabled={key === 'memory_enabled' && !memoryAvailable}
                          onChange={e => set(key, e.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {!memoryAvailable && (
                <p className="text-xs text-amber-300/80">
                  Persistent memory is available on Solo and above. New teammates on Free start with memory disabled.
                </p>
              )}
            </div>
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
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'contract' | 'memory' | 'preferences'>('overview')
  const [showAddPreference, setShowAddPreference] = useState(false)
  const [manualPreference, setManualPreference] = useState('')
  const { data: agents = [], isLoading, isError } = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
    refetchOnMount: 'always',
  })
  const { data: models = [], isError: modelsError } = useQuery({ queryKey: ['models'], queryFn: agentsApi.getModels })
  const { data: savedModels = [], isError: savedModelsError } = useQuery({ queryKey: ['model-configs'], queryFn: modelsApi.list })
  const { data: tools = [], isError: toolsError } = useQuery({ queryKey: ['tools'], queryFn: agentsApi.getTools })
  const { data: clientsResponse, isError: clientsError } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list })
  const clients = clientsResponse?.clients || []
  const memoryAvailable = auth.activeOrg?.plan !== 'free'
  const filteredAgents = agents.filter(agent => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [agent.name, agent.persona_name || '', agent.role || '', agent.role_slug || '']
      .join(' ')
      .toLowerCase()
      .includes(q)
  }).sort((a, b) => (b.trust_score ?? 50) - (a.trust_score ?? 50))
  const selectedAgent = filteredAgents.find(agent => agent.id === selectedAgentId) || agents.find(agent => agent.id === selectedAgentId) || filteredAgents[0] || agents[0] || null

  const selectedTrustQuery = useQuery({
    queryKey: ['agent-trust-score', selectedAgent?.id],
    queryFn: () => agentsApi.getTrustScore(selectedAgent!.id),
    enabled: Boolean(selectedAgent?.id),
  })
  const selectedPreferencesQuery = useQuery({
    queryKey: ['agent-preferences-inline', selectedAgent?.id],
    queryFn: () => agentsApi.getPreferences(selectedAgent!.id),
    enabled: Boolean(selectedAgent?.id),
  })
  const selectedExecutionsQuery = useQuery({
    queryKey: ['agent-executions', selectedAgent?.id],
    queryFn: () => executionsApi.list(),
    enabled: Boolean(selectedAgent?.id),
    staleTime: 15_000,
  })
  const selectedMemoryStatsQuery = useQuery({
    queryKey: ['memory', selectedAgent?.id, 'stats-inline'],
    queryFn: () => memoryApi.stats(selectedAgent!.id),
    enabled: Boolean(selectedAgent?.id),
  })
  const selectedMemoryHistoryQuery = useQuery({
    queryKey: ['memory', selectedAgent?.id, 'history-inline'],
    queryFn: () => memoryApi.history(selectedAgent!.id, 10),
    enabled: Boolean(selectedAgent?.id),
  })
  const memoryStatusQuery = useQuery({
    queryKey: ['memory-status'],
    queryFn: memoryApi.status,
  })

  useEffect(() => {
    const create = searchParams.get('create')
    if (create === '1') {
      setEditing(current => current ?? { memory_enabled: memoryAvailable })
      const next = new URLSearchParams(searchParams)
      next.delete('create')
      setSearchParams(next, { replace: true })
    }
  }, [memoryAvailable, searchParams, setSearchParams])

  useEffect(() => {
    const agentId = searchParams.get('agent')
    if (!agentId || !agents.length) return
    const match = agents.find(agent => agent.id === agentId)
    if (match) {
      setSelectedAgentId(match.id)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('agent')
    setSearchParams(next, { replace: true })
  }, [agents, searchParams, setSearchParams])

  useEffect(() => {
    if (!selectedAgentId && agents.length) {
      setSelectedAgentId(agents[0].id)
    }
  }, [agents, selectedAgentId])

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
  const quickTestMut = useMutation({
    mutationFn: (agentId: string) => evalsApi.quickTest(agentId),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['evals'] })
      toast.success(`Quick test finished: ${result.passed}/${result.total} passed (${Math.round(result.pass_rate)}%)`)
    },
    onError: error => toast.error(extractApiError(error)),
  })
  const addPreferenceMut = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error('No agent selected')
      return agentsApi.addPreference(selectedAgent.id, manualPreference.trim())
    },
    onSuccess: async () => {
      if (!selectedAgent) return
      await qc.invalidateQueries({ queryKey: ['agent-preferences-inline', selectedAgent.id] })
      setManualPreference('')
      setShowAddPreference(false)
      toast.success('Preference added')
    },
    onError: error => toast.error(extractApiError(error)),
  })
  const deletePreferenceMut = useMutation({
    mutationFn: async (memoryId: string) => {
      if (!selectedAgent) throw new Error('No agent selected')
      return agentsApi.deletePreference(selectedAgent.id, memoryId)
    },
    onSuccess: async () => {
      if (!selectedAgent) return
      await qc.invalidateQueries({ queryKey: ['agent-preferences-inline', selectedAgent.id] })
      toast.success('Preference removed')
    },
    onError: error => toast.error(extractApiError(error)),
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

  if (isError || modelsError || savedModelsError || toolsError || clientsError) {
    return (
      <div className="p-6 text-center text-white/40">
        <p>Could not load agents.</p>
        <button className="mt-3 text-sm text-blue-300" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    )
  }

  const recentExecutions = (selectedExecutionsQuery.data || [])
    .filter(execution => execution.agent_name === (selectedAgent?.persona_name || selectedAgent?.name))
    .slice(0, 5)

  const preferences = selectedPreferencesQuery.data || []
  const memoryHistory = selectedMemoryHistoryQuery.data || []
  const trustScore = selectedAgent?.trust_score ?? 50
  const noTasksYet = (selectedTrustQuery.data?.counters.total_tasks ?? selectedAgent?.total_tasks_completed ?? 0) === 0
  const selectedAccent = roleAccent(selectedAgent?.role_slug)

  const renderPreferences = (fullPage = false) => (
    <div className={clsx('space-y-4', fullPage && 'min-h-[320px]')}>
      <div className="flex flex-wrap gap-2">
        {preferences.length ? preferences.map((preference: AgentPreference) => (
          <span key={preference.id} className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
            <span className="max-w-[320px] truncate">{preference.content_preview || 'Untitled preference'}</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-blue-300/70 transition-colors hover:text-red-300"
              onClick={() => deletePreferenceMut.mutate(preference.id)}
            >
              <X size={12} />
            </button>
          </span>
        )) : (
          <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-5 text-center font-mono text-xs uppercase tracking-[0.14em] text-white/30">
            Approve executions with notes to add preferences automatically.
          </div>
        )}
      </div>
      <div className="space-y-2">
        {showAddPreference ? (
          <input
            value={manualPreference}
            onChange={event => setManualPreference(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (manualPreference.trim().length >= 5) addPreferenceMut.mutate()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setShowAddPreference(false)
                setManualPreference('')
              }
            }}
            placeholder="e.g. Always use bullet points"
            className="input"
          />
        ) : null}
        <div className="flex items-center gap-2">
          {!showAddPreference ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => setShowAddPreference(true)}>
              + Add preference
            </button>
          ) : (
            <>
              <button type="button" className="btn-primary text-xs" disabled={manualPreference.trim().length < 5 || addPreferenceMut.isPending} onClick={() => addPreferenceMut.mutate()}>
                {addPreferenceMut.isPending ? 'Saving…' : 'Save preference'}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => { setShowAddPreference(false); setManualPreference('') }}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <PageShell
      title="AI Team"
      subtitle={`${agents.filter(agent => agent.is_active).length} active · ${agents.length} total`}
      actions={<button className="btn-primary h-11" onClick={() => setEditing({ memory_enabled: memoryAvailable })}><Plus size={16} /> Add Agent</button>}
      contentClassName="space-y-6 p-6"
    >
      {isLoading ? (
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => <AgentCardSkeleton key={index} />)}
          </div>
          <AgentCardSkeleton />
        </div>
      ) : !agents.length ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] px-6 py-16 text-center font-mono text-xs uppercase tracking-[0.16em] text-white/30">
          No agents yet. Add your first teammate.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <section className="surface-card overflow-hidden">
            <div className="border-b border-[var(--border)] p-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                <input
                  className="input pl-9"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search agents"
                />
              </div>
            </div>
            <div className="max-h-[calc(100vh-240px)] overflow-y-auto">
              {filteredAgents.map((agent, index) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    setSelectedAgentId(agent.id)
                    setActiveTab('overview')
                  }}
                  className={clsx(
                    'data-row w-full text-left',
                    STAGGER_CLASSES[Math.min(index, STAGGER_CLASSES.length - 1)],
                    selectedAgent?.id === agent.id
                      ? 'border-l-2 border-l-indigo-400 bg-indigo-500/[0.08]'
                      : '',
                  )}
                >
                  <span className={clsx('status-dot', agent.current_status === 'working' ? `${roleAccent(agent.role_slug).dot} dot-live` : agent.current_status === 'waiting_approval' ? 'dot-amber' : 'dot-muted')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--t1)]">
                      {agent.persona_name || agent.name}
                    </div>
                    <div className="truncate text-xs text-[var(--t2)]">{agent.role || agent.role_slug}</div>
                  </div>
                  <div className="font-mono text-[11px] text-[var(--t2)]">{Math.round(agent.trust_score ?? 50)}</div>
                </button>
              ))}
            </div>
          </section>

          {selectedAgent ? (
            <section className="surface-card overflow-hidden">
              <div className="border-b border-[var(--border)] px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-white"
                      style={{ background: selectedAccent.bg }}
                    >
                      {(selectedAgent.persona_name || selectedAgent.name).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-2xl font-extrabold tracking-tight text-[var(--t1)]">
                        {selectedAgent.persona_name || selectedAgent.name}
                      </h2>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="badge badge-glass">{selectedAgent.role || selectedAgent.role_slug || 'Agent'}</span>
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--t2)]">
                          <span className={clsx('status-dot', selectedAgent.current_status === 'working' ? 'dot-green dot-live' : selectedAgent.current_status === 'waiting_approval' ? 'dot-amber' : 'dot-muted')} />
                          {presentStatus(selectedAgent.current_status)}
                        </span>
                        <div className="flex flex-col items-center gap-1">
                          <TrustRing score={trustScore} radius={20} />
                          <span className="font-mono text-[11px] text-[var(--t3)]">{noTasksYet ? 'no tasks yet' : 'live trust'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary text-xs" onClick={() => setEditing(selectedAgent)}>Configure</button>
                    <button className="btn-secondary text-xs" onClick={() => setActiveTab('memory')}><Brain size={13} /> Memory</button>
                    <button className="btn-danger text-xs" onClick={() => setAgentToDelete(selectedAgent)}><Trash2 size={13} /> Delete</button>
                  </div>
                </div>
              </div>

              <div className="border-b border-[var(--border)] px-5">
                <div className="flex gap-5">
                  {([
                    ['overview', 'Overview'],
                    ['contract', 'Contract'],
                    ['memory', 'Memory'],
                    ['preferences', 'Preferences'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveTab(key)}
                      className={clsx(
                        'relative border-b px-1 py-3 font-mono text-[11px] uppercase tracking-[0.10em]',
                        activeTab === key ? 'border-indigo-400 text-[var(--t1)]' : 'border-transparent text-[var(--t3)]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-5 p-5">
                {activeTab === 'overview' && (
                  <>
                    <div className="space-y-3">
                      <div className="data-row rounded-lg border border-[var(--border)]"><span className="text-sm text-[var(--t2)]">Tasks completed</span><span className="ml-auto font-mono text-sm text-[var(--t1)]">{selectedAgent.total_tasks_completed ?? selectedTrustQuery.data?.counters.total_tasks ?? 0}</span></div>
                      <div className="data-row rounded-lg border border-[var(--border)]"><span className="text-sm text-[var(--t2)]">Success rate</span><span className="ml-auto font-mono text-sm text-[var(--t1)]">{Math.round(selectedTrustQuery.data?.components.task_success_rate ?? 0)}%</span></div>
                      <div className="data-row rounded-lg border border-[var(--border)]"><span className="text-sm text-[var(--t2)]">Trust score</span><span className="ml-auto"><TrustRing score={trustScore} radius={18} /></span></div>
                    </div>

                    <div>
                      <div className="section-title">Recent Executions</div>
                      <div className="surface-card overflow-hidden">
                        {recentExecutions.map(execution => (
                          <Link key={execution.id} to={`/executions/${execution.id}`} className="data-row block">
                            <div className="flex items-center gap-3">
                              <span className={clsx('status-dot', execution.status === 'completed' ? 'dot-green' : execution.status === 'running' ? 'dot-blue dot-live' : execution.status === 'pending_review' || execution.status === 'waiting_approval' ? 'dot-amber' : 'dot-red')} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-[var(--t1)]">{execution.input_message || execution.workflow_name || 'Execution'}</div>
                                <div className="truncate text-xs text-[var(--t2)]">{execution.started_at ? new Date(execution.started_at).toLocaleDateString() : 'Recently'}</div>
                              </div>
                              <span className={clsx('badge font-mono uppercase', execution.status === 'completed' ? 'badge-green' : execution.status === 'running' ? 'badge-blue' : execution.status === 'pending_review' || execution.status === 'waiting_approval' ? 'badge-amber' : 'badge-red')}>
                                {presentStatus(execution.status)}
                              </span>
                            </div>
                          </Link>
                        ))}
                        {!recentExecutions.length && (
                          <div className="m-4 rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center font-mono text-xs uppercase tracking-[0.14em] text-[var(--t3)]">
                            No executions yet
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="section-title">CEO Preferences</div>
                      {renderPreferences()}
                    </div>
                  </>
                )}

                {activeTab === 'contract' && (
                  <div className="grid gap-5 lg:grid-cols-3">
                    <div>
                      <div className="section-title">Allowed Tools</div>
                      <div className="space-y-2">
                        {(selectedAgent.tools || []).map(toolId => {
                          const tool = tools.find(item => item.id === toolId)
                          return <div key={toolId} className="flex items-center gap-2 text-sm text-[var(--t1)]"><span className="status-dot dot-green" />{tool?.name || toolId}</div>
                        })}
                        {!(selectedAgent.tools || []).length && <div className="text-sm text-[var(--t2)]">No tools assigned.</div>}
                      </div>
                    </div>
                    <div>
                      <div className="section-title">Forbidden</div>
                      <div className="space-y-2">
                        {tools.filter(tool => !(selectedAgent.tools || []).includes(tool.id)).slice(0, 8).map(tool => (
                          <div key={tool.id} className="flex items-center gap-2 text-sm text-[var(--t3)] line-through"><span className="status-dot dot-red" />{tool.name}</div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="section-title">Require Approval</div>
                      <div className="space-y-2 text-sm text-[var(--t2)]">
                        <div className="flex items-center gap-2"><span className="status-dot dot-amber" />High-risk actions</div>
                        <div className="flex items-center gap-2"><span className="status-dot dot-amber" />External delivery or outreach</div>
                        <div className="flex items-center gap-2"><span className="status-dot dot-amber" />Anything outside allowed tools</div>
                        <div className="pt-2"><span className="badge badge-glass">{selectedAgent.autonomy_level || 'supervised'}</span></div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'memory' && (
                  <div className="space-y-4">
                    {!memoryStatusQuery.data?.mem0_configured && (
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                        <div className="mb-1 inline-flex items-center gap-2"><span className="badge badge-amber">Memory</span> mem0 is not configured</div>
                        <div>Agents won't learn between sessions until MEM0_API_KEY is configured.</div>
                      </div>
                    )}
                    <div className="data-row rounded-lg border border-[var(--border)]">
                      <span className="text-sm text-[var(--t2)]">Stats</span>
                      <span className="ml-auto font-mono text-sm text-[var(--t1)]">{selectedMemoryStatsQuery.data?.total_memories ?? 0} memories · {selectedMemoryStatsQuery.data?.session_count ?? 0} tasks</span>
                    </div>
                    <div className="surface-card overflow-hidden">
                      {memoryHistory.length ? (
                        memoryHistory.map((memory: AgentMemoryItem, index: number) => (
                          <div key={index} className="data-row cursor-default">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-[var(--t1)]">{memory.content}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="m-4 rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center font-mono text-xs uppercase tracking-[0.14em] text-[var(--t3)]">
                          No memories stored yet
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'preferences' && (
                  renderPreferences(true)
                )}
              </div>
            </section>
          ) : (
            <section className="surface-card flex min-h-[520px] items-center justify-center">
              <div className="rounded-2xl border border-dashed border-[var(--border)] px-6 py-14 text-center font-mono text-xs uppercase tracking-[0.16em] text-[var(--t3)]">
                Select an agent to view details
              </div>
            </section>
          )}
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
          clients={clients}
          isSaving={createMut.isPending || updateMut.isPending}
          memoryAvailable={memoryAvailable}
        />
      )}
      <ConfirmDialog
        open={Boolean(agentToDelete)}
        title={`Delete ${agentToDelete?.name || 'agent'}?`}
        description="This removes the teammate from your workspace. Existing execution history stays available, but new workflows cannot use this agent."
        confirmLabel="Delete agent"
        loading={deleteMut.isPending}
        onClose={() => setAgentToDelete(null)}
        onConfirm={() => agentToDelete && deleteMut.mutate(agentToDelete.id)}
      />
    </PageShell>
  )
}

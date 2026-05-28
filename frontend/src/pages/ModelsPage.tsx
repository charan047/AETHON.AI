import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Loader2,
  Pencil,
  Plus,
  Server,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react'

import { agentsApi, extractApiError, modelsApi } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { GlowCard } from '../components/ui/GlowCard'
import { SkeletonCard } from '../components/ui/Skeleton'
import { toast } from '../lib/toast'
import type { ModelConfigRecord, ModelTemplate, ModelTestResult } from '../types'


type ProviderName = ModelConfigRecord['provider']
type ProviderPill = ProviderName | 'custom-groq'

interface AddModelDraft {
  provider: ProviderName
  model_id: string
  display_name: string
  api_key: string
  base_url: string
  notes: string
  set_as_default: boolean
  context_window?: number | null
  supports_tools: boolean
  supports_vision: boolean
  cost_per_million_input_tokens?: number | null
  cost_per_million_output_tokens?: number | null
}

const PROVIDER_META: Record<ProviderName, { label: string; icon: typeof Bot; tone: string }> = {
  openai: { label: 'OpenAI', icon: Sparkles, tone: 'text-blue-300 bg-blue-500/12 border-blue-500/20' },
  anthropic: { label: 'Anthropic', icon: BrainCircuit, tone: 'text-emerald-300 bg-emerald-500/12 border-emerald-500/20' },
  ollama: { label: 'Local (Ollama)', icon: Server, tone: 'text-amber-300 bg-amber-500/12 border-amber-500/20' },
  custom: { label: 'Custom', icon: Wrench, tone: 'text-white/75 bg-white/[0.06] border-white/[0.10]' },
}

const SIDEBAR_MODEL_QUERY_KEY = ['model-configs', 'sidebar'] as const

function formatCurrency(value?: number | null) {
  if (value == null) return '—'
  if (value === 0) return '$0'
  return `$${value.toFixed(2)}`
}

function formatRelative(date?: string | null) {
  if (!date) return 'Not tested yet'
  const diffMs = Date.now() - new Date(date).getTime()
  const minutes = Math.max(1, Math.round(diffMs / 60_000))
  if (minutes < 60) return `Tested ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Tested ${hours}h ago`
  const days = Math.round(hours / 24)
  return `Tested ${days}d ago`
}

function providerLabel(provider: ProviderName) {
  const meta = PROVIDER_META[provider]
  return meta.label
}

function recommendedRoleLabel(value: string) {
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function StatusDot({ status }: { status?: ModelConfigRecord['test_status'] | null }) {
  if (status === 'ok') {
    return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.55)] animate-pulse motion-reduce:animate-none" />
  }
  if (status === 'failed') {
    return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-400" />
  }
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-white/20" />
}

function TierBadge({ tier }: { tier: string }) {
  const color =
    tier === 'premium' ? 'border-blue-400/30 bg-blue-400/10 text-blue-200'
    : tier === 'standard' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
    : tier === 'economy' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'

  return <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${color}`}>{tier}</span>
}

function ModelCard({
  config,
  onSetDefault,
  onTest,
  onEdit,
  onDelete,
  testing,
  lastTestResult,
}: {
  config: ModelConfigRecord
  onSetDefault: () => void
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
  testing: boolean
  lastTestResult?: ModelTestResult | null
}) {
  const providerMeta = PROVIDER_META[config.provider]
  const ProviderIcon = providerMeta.icon
  const latency = lastTestResult?.success ? lastTestResult.latency_ms : null

  return (
    <GlowCard className="group p-5">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-3">
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${providerMeta.tone}`}>
                <ProviderIcon size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate font-bold text-white">{config.display_name}</div>
                  {config.is_default ? <span className="badge-indigo">Default</span> : null}
                </div>
                <div className="font-mono text-xs text-[#8B9DBE]">{config.model_id}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="font-mono text-xs text-[#8B9DBE]">
          {config.context_window ? `${Math.round(config.context_window / 1000)}k context` : 'context —'} · {config.supports_tools ? 'tools on' : 'tools off'} · {config.supports_vision ? 'vision on' : 'vision off'}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {config.test_status === 'ok' ? (
            <span className="badge-emerald">{latency ? `${latency}ms` : 'Passed'}</span>
          ) : null}
          {config.test_status === 'failed' ? (
            <span className="badge-red">Failed</span>
          ) : null}
          <span className="font-mono text-[#8B9DBE]">{formatRelative(config.last_tested_at)}</span>
          <span className="font-mono text-[#8B9DBE]">{config.agent_count} agent{config.agent_count === 1 ? '' : 's'}</span>
        </div>

        {config.test_status === 'failed' && config.test_error ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">
            {config.test_error.slice(0, 120)}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 opacity-100 transition-opacity duration-150 lg:opacity-80 lg:group-hover:opacity-100">
          <button className="btn-secondary btn-sm" onClick={onTest} disabled={testing}>
            {testing ? <><Loader2 size={14} className="animate-spin" /> Testing…</> : 'Test'}
          </button>
          {!config.is_default ? (
            <button className="btn-ghost btn-sm" onClick={onSetDefault}>
              Set Default
            </button>
          ) : null}
          <button className="btn-secondary btn-sm" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </button>
          <button className="btn-danger btn-sm" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </GlowCard>
  )
}

function TemplateCard({ template, onSelect }: { template: ModelTemplate; onSelect: () => void }) {
  const providerMeta = PROVIDER_META[template.provider]
  const ProviderIcon = providerMeta.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className="card cursor-pointer rounded-2xl p-4 text-left transition-all duration-150 hover:border-blue-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${providerMeta.tone}`}>
            <ProviderIcon size={12} />
            {providerLabel(template.provider)}
          </div>
          <div className="mt-1 text-base font-semibold text-white">{template.display_name}</div>
        </div>
        <TierBadge tier={template.tier} />
      </div>
      <p className="text-sm leading-6 text-white/55">{template.description}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-white/35">
        <span>Speed: {template.speed}</span>
        <span>·</span>
        <span>{formatCurrency(template.cost_per_million_input_tokens)} / {formatCurrency(template.cost_per_million_output_tokens)}</span>
      </div>
      <div className="mt-3 text-xs text-white/40">
        Recommended for: {template.recommended_for.map(recommendedRoleLabel).join(', ')}
      </div>
    </button>
  )
}

function AddModelModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (config: ModelConfigRecord) => void
}) {
  const queryClient = useQueryClient()
  const { data: templates = [] } = useQuery({
    queryKey: ['model-templates'],
    queryFn: modelsApi.templates,
    enabled: open,
  })

  const groupedTemplates = useMemo(() => {
    return templates.reduce<Record<string, ModelTemplate[]>>((acc, template) => {
      acc[template.provider] = acc[template.provider] || []
      acc[template.provider].push(template)
      return acc
    }, {})
  }, [templates])

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedTemplate, setSelectedTemplate] = useState<ModelTemplate | null>(null)
  const [customProviderName, setCustomProviderName] = useState('Other')
  const [allowUntestedSave, setAllowUntestedSave] = useState(false)
  const [testedResult, setTestedResult] = useState<ModelTestResult | null>(null)
  const [draft, setDraft] = useState<AddModelDraft>({
    provider: 'openai',
    model_id: '',
    display_name: '',
    api_key: '',
    base_url: '',
    notes: '',
    set_as_default: false,
    context_window: undefined,
    supports_tools: true,
    supports_vision: false,
    cost_per_million_input_tokens: undefined,
    cost_per_million_output_tokens: undefined,
  })

  const reset = () => {
    setStep(1)
    setSelectedTemplate(null)
    setCustomProviderName('Other')
    setAllowUntestedSave(false)
    setTestedResult(null)
    setDraft({
      provider: 'openai',
      model_id: '',
      display_name: '',
      api_key: '',
      base_url: '',
      notes: '',
      set_as_default: false,
      context_window: undefined,
      supports_tools: true,
      supports_vision: false,
      cost_per_million_input_tokens: undefined,
      cost_per_million_output_tokens: undefined,
    })
  }

  const close = () => {
    reset()
    onClose()
  }

  const selectTemplate = (template: ModelTemplate | null) => {
    setSelectedTemplate(template)
    setAllowUntestedSave(false)
    setTestedResult(null)
    if (template) {
      setDraft({
        provider: template.provider,
        model_id: template.model_id,
        display_name: template.display_name,
        api_key: '',
        base_url: template.provider === 'ollama' ? 'http://localhost:11434' : '',
        notes: '',
        set_as_default: false,
        context_window: template.context_window,
        supports_tools: template.supports_tools,
        supports_vision: template.supports_vision,
        cost_per_million_input_tokens: template.cost_per_million_input_tokens,
        cost_per_million_output_tokens: template.cost_per_million_output_tokens,
      })
    } else {
      setDraft({
        provider: 'custom',
        model_id: '',
        display_name: '',
        api_key: '',
        base_url: '',
        notes: '',
        set_as_default: false,
        context_window: undefined,
        supports_tools: true,
        supports_vision: false,
        cost_per_million_input_tokens: undefined,
        cost_per_million_output_tokens: undefined,
      })
    }
    setStep(2)
  }

  const testMutation = useMutation({
    mutationFn: () => modelsApi.test({
      provider: draft.provider,
      model_id: draft.model_id,
      api_key: draft.api_key || undefined,
      base_url: draft.base_url || undefined,
    }),
    onSuccess: result => {
      setTestedResult(result)
      if (result.success) {
        toast.success(`Connected in ${result.latency_ms}ms`)
      } else {
        toast.error(result.error || 'Connection test failed')
      }
    },
    onError: error => {
      toast.error(extractApiError(error))
    },
  })

  const createMutation = useMutation({
    mutationFn: () => modelsApi.create({
      provider: draft.provider,
      model_id: draft.model_id,
      display_name: draft.display_name,
      api_key: draft.api_key || undefined,
      base_url: draft.base_url || undefined,
      notes: draft.notes || undefined,
      set_as_default: draft.set_as_default,
      context_window: draft.context_window,
      supports_tools: draft.supports_tools,
      supports_vision: draft.supports_vision,
      cost_per_million_input_tokens: draft.cost_per_million_input_tokens,
      cost_per_million_output_tokens: draft.cost_per_million_output_tokens,
    }),
    onSuccess: config => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      queryClient.invalidateQueries({ queryKey: SIDEBAR_MODEL_QUERY_KEY })
      toast.success(`${config.display_name} added`)
      setStep(3)
      onCreated(config)
    },
    onError: error => {
      toast.error(extractApiError(error))
    },
  })

  if (!open) return null

  const canSave = testedResult?.success || allowUntestedSave

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-elevated flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-[#4B5A73]">Model Control Plane</div>
            <div className="mt-1 text-xl font-semibold text-white">Add Model</div>
          </div>
          <button className="btn-secondary text-xs" onClick={close}>Close</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 1 && (
            <div className="mx-auto max-w-6xl space-y-8">
              {Object.entries(groupedTemplates).map(([provider, items]) => (
                <section key={provider} className="space-y-4">
                  <div className="text-sm font-semibold text-white">{providerLabel(provider as ProviderName)}</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.map(template => (
                      <TemplateCard key={`${template.provider}:${template.model_id}`} template={template} onSelect={() => selectTemplate(template)} />
                    ))}
                  </div>
                </section>
              ))}

              <button
                type="button"
                onClick={() => selectTemplate(null)}
                className="grid w-full cursor-pointer place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-12 text-center text-white/65 transition duration-150 hover:border-blue-500/30 hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <div className="space-y-2">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                    <Plus size={18} />
                  </div>
                  <div className="text-base font-semibold text-white">Add Custom Model</div>
                  <div className="text-sm text-white/45">Together.ai, Groq, Mistral, LM Studio, or any OpenAI-compatible endpoint.</div>
                </div>
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                <div className="text-sm text-white/45">{providerLabel(draft.provider)}</div>
                <div className="mt-1 text-lg font-semibold text-white">{draft.display_name || 'New model config'}</div>
              </div>

              <div className="space-y-3">
                <div className="label">Provider</div>
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: 'openai', label: 'OpenAI' },
                    { key: 'anthropic', label: 'Anthropic' },
                    { key: 'custom-groq', label: 'Groq' },
                    { key: 'custom', label: 'Custom' },
                    { key: 'ollama', label: 'Ollama' },
                  ] as Array<{ key: ProviderPill; label: string }>).map(option => {
                    const active =
                      (option.key === 'custom-groq' && draft.provider === 'custom' && customProviderName === 'Groq') ||
                      option.key === draft.provider
                    const basePillClass = active
                      ? 'rounded-full border border-blue-500/30 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-300'
                      : 'btn-secondary rounded-full px-4 py-2 text-sm'

                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          if (option.key === 'custom-groq') {
                            setCustomProviderName('Groq')
                            setDraft(prev => ({ ...prev, provider: 'custom', base_url: prev.base_url || '' }))
                            return
                          }
                          if (option.key === 'custom') {
                            setCustomProviderName('Other')
                            setDraft(prev => ({ ...prev, provider: 'custom' }))
                            return
                          }
                          const provider: ProviderName = option.key
                          setDraft(prev => ({ ...prev, provider }))
                        }}
                        className={basePillClass}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {draft.provider === 'custom' && (
                <div>
                  <label className="label">Provider Name</label>
                  <select className="input" value={customProviderName} onChange={e => setCustomProviderName(e.target.value)}>
                    {['Together.ai', 'Groq', 'Mistral', 'LM Studio', 'Other'].map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <FloatingField label="Display Name" type="text" value={draft.display_name} onChange={value => setDraft(prev => ({ ...prev, display_name: value }))} required />
                <FloatingField label="Model ID" type="text" value={draft.model_id} onChange={value => setDraft(prev => ({ ...prev, model_id: value }))} required />
              </div>

              {(draft.provider === 'openai' || draft.provider === 'anthropic' || draft.provider === 'custom') && (
                <FloatingField label="API Key" type="password" value={draft.api_key} onChange={value => setDraft(prev => ({ ...prev, api_key: value }))} />
              )}

              {(draft.provider === 'ollama' || draft.provider === 'custom') && (
                <div>
                  <FloatingField label="Base URL" type="text" value={draft.base_url} onChange={value => setDraft(prev => ({ ...prev, base_url: value }))} />
                  {draft.provider === 'ollama' && (
                    <div className="mt-2 text-xs text-white/40">
                      Make sure Ollama is running: <code>ollama serve</code>. <a className="text-blue-300 transition hover:text-blue-200" href="https://ollama.ai" target="_blank" rel="noreferrer">Install Ollama →</a>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="label">Notes</label>
                <textarea className="input min-h-[110px] resize-y" value={draft.notes} onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value }))} />
              </div>

              <label className="flex items-center gap-3 text-sm text-white/65">
                <input
                  type="checkbox"
                  className="indigo-blue-500"
                  checked={draft.set_as_default}
                  onChange={e => setDraft(prev => ({ ...prev, set_as_default: e.target.checked }))}
                />
                Set as org default
              </label>

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="mb-3 text-sm font-semibold text-white">Test Before Save</div>
                <button className="btn-primary" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
                  {testMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Testing connection…</> : 'Test Connection'}
                </button>
                {testedResult && (
                  <div className={`mt-4 rounded-xl border p-3 text-sm ${testedResult.success ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-red-400/20 bg-red-400/10 text-red-100'}`}>
                    {testedResult.success ? `Connected · ${testedResult.latency_ms}ms · ${testedResult.response_preview}` : `Error: ${testedResult.error}`}
                  </div>
                )}
                {!testedResult?.success && (
                  <button
                    type="button"
                    onClick={() => setAllowUntestedSave(true)}
                    className="mt-3 cursor-pointer text-xs text-white/35 transition hover:text-white/55"
                  >
                    Save without testing
                  </button>
                )}
              </div>

              <div className="flex gap-3">
                <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button
                  className="btn-primary flex-1"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !canSave || !draft.display_name || !draft.model_id}
                >
                  {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : 'Save Model'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center space-y-5 py-24 text-center">
              <div className="grid h-20 w-20 place-items-center rounded-3xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-200">
                <CheckCircle2 size={34} />
              </div>
              <div>
                <div className="text-2xl font-semibold text-white">{draft.display_name} added successfully</div>
                <div className="mt-2 text-white/45">Your org can assign this model to agents immediately.</div>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button className="btn-primary" onClick={() => { close(); document.getElementById('agent-model-assignment')?.scrollIntoView({ behavior: 'smooth' }) }}>
                  Assign to agents now <ArrowRight size={16} />
                </button>
                <button className="btn-secondary" onClick={reset}>Add another model</button>
                <button className="btn-secondary" onClick={close}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EditModelModal({
  config,
  onClose,
}: {
  config: ModelConfigRecord | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(config?.display_name ?? '')
  const [notes, setNotes] = useState(config?.notes ?? '')
  const [isActive, setIsActive] = useState(config?.is_active ?? true)
  const [rotateKey, setRotateKey] = useState('')

  useEffect(() => {
    setDisplayName(config?.display_name ?? '')
    setNotes(config?.notes ?? '')
    setIsActive(config?.is_active ?? true)
    setRotateKey('')
  }, [config])

  const updateMutation = useMutation({
    mutationFn: () => modelsApi.update(config!.id, { display_name: displayName, notes, is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      queryClient.invalidateQueries({ queryKey: SIDEBAR_MODEL_QUERY_KEY })
      toast.success('Model updated')
      onClose()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const rotateMutation = useMutation({
    mutationFn: () => modelsApi.rotateKey(config!.id, rotateKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      queryClient.invalidateQueries({ queryKey: SIDEBAR_MODEL_QUERY_KEY })
      setRotateKey('')
      toast.success('API key rotated')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  if (!config) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass-elevated w-full max-w-xl p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-white">Edit {config.display_name}</div>
            <div className="text-sm text-white/35">{providerLabel(config.provider)}</div>
          </div>
          <button className="btn-secondary text-xs" onClick={onClose}>Close</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Display Name</label>
            <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-[110px] resize-y" value={notes ?? ''} onChange={e => setNotes(e.target.value)} />
          </div>
          <label className="flex items-center gap-3 text-sm text-white/65">
            <input type="checkbox" className="indigo-blue-500" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            Active
          </label>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Rotate API Key</div>
            <input type="password" className="input" value={rotateKey} onChange={e => setRotateKey(e.target.value)} placeholder="Enter new API key" />
            <button className="btn-secondary mt-3" onClick={() => rotateMutation.mutate()} disabled={!rotateKey || rotateMutation.isPending}>
              {rotateMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Rotate key'}
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button className="btn-primary flex-1" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : 'Save changes'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function ModelsPage() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ModelConfigRecord | null>(null)
  const [configToDelete, setConfigToDelete] = useState<ModelConfigRecord | null>(null)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [testingConfigId, setTestingConfigId] = useState<string | null>(null)
  const [latestTestResults, setLatestTestResults] = useState<Record<string, ModelTestResult>>({})

  const { data: configs = [], isLoading: loadingConfigs } = useQuery({
    queryKey: ['model-configs'],
    queryFn: modelsApi.list,
  })
  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: ['agents', 'model-assignment'],
    queryFn: agentsApi.list,
  })

  const defaultConfig = configs.find(config => config.is_default) || null

  const testMutation = useMutation({
    mutationFn: async (config: ModelConfigRecord) => {
      setTestingConfigId(config.id)
      return modelsApi.testSaved(config.id)
    },
    onSuccess: result => {
      if (testingConfigId) {
        setLatestTestResults(prev => ({ ...prev, [testingConfigId]: result }))
      }
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      queryClient.invalidateQueries({ queryKey: SIDEBAR_MODEL_QUERY_KEY })
      if (result.success) toast.success(`Connected in ${result.latency_ms}ms`)
      else toast.error(result.error || 'Test failed')
    },
    onError: error => toast.error(extractApiError(error)),
    onSettled: () => setTestingConfigId(null),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => modelsApi.setDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      queryClient.invalidateQueries({ queryKey: SIDEBAR_MODEL_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['agents', 'model-assignment'] })
      toast.success('Default model updated')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => modelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      queryClient.invalidateQueries({ queryKey: SIDEBAR_MODEL_QUERY_KEY })
      setConfigToDelete(null)
      toast.success('Model removed')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const assignModelMutation = useMutation({
    mutationFn: ({ agentId, modelConfigId }: { agentId: string; modelConfigId: string | null }) =>
      agentsApi.assignModel(agentId, modelConfigId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agents', 'model-assignment'] })
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      toast.success('Agent model updated')
      setEditingAgentId(null)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  return (
    <div className="space-y-8 p-6 animate-fade-up motion-reduce:animate-none">
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="page-title">AI Models</h1>
            <p className="page-sub">Test, assign, and monitor the models your agency relies on across every agent.</p>
          </div>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={16} /> Add Model
          </button>
        </div>

        {loadingConfigs ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...Array(4)].map((_, index) => <SkeletonCard key={index} className="h-64" />)}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {configs.map(config => (
              <ModelCard
                key={config.id}
                config={config}
                onSetDefault={() => setDefaultMutation.mutate(config.id)}
                onTest={() => testMutation.mutate(config)}
                onEdit={() => setEditingConfig(config)}
                onDelete={() => setConfigToDelete(config)}
                testing={testingConfigId === config.id}
                lastTestResult={latestTestResults[config.id]}
              />
            ))}
            {!configs.length && (
              <GlowCard className="col-span-full py-20 text-center">
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/40">
                  <Cpu size={24} />
                </div>
                <div className="text-lg font-medium text-white">No model configs yet</div>
                <div className="mt-2 text-sm text-white/45">Add your first provider key and make it available to the whole agency.</div>
              </GlowCard>
            )}
          </div>
        )}
      </section>

      <section id="agent-model-assignment" className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Agent Model Assignment</h2>
          <p className="mt-1 text-sm text-[#8B9DBE]">Agents without a specific model inherit the org default automatically.</p>
        </div>

        <GlowCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-white/[0.08] bg-[rgba(8,13,26,0.90)] text-white/45 backdrop-blur-xl">
                <tr>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Current Model</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {(loadingAgents ? [] : agents).map(agent => {
                  const specificConfig = agent.model_config_id ? configs.find(config => config.id === agent.model_config_id) : null
                  const currentConfig = specificConfig || defaultConfig
                  const usingDefault = !agent.model_config_id
                  const hasFailedConfig = currentConfig?.test_status === 'failed'

                  return (
                    <tr key={agent.id} className="border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.025] last:border-b-0">
                      <td className="px-4 py-4 text-white">{agent.name}</td>
                      <td className="px-4 py-4 text-white/50">{agent.role}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 text-white/75">
                          <span>{currentConfig?.display_name || agent.model || 'Default'}</span>
                          {usingDefault && (
                            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                              default
                            </span>
                          )}
                          {hasFailedConfig && <ShieldAlert size={14} className="text-amber-300" />}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {editingAgentId === agent.id ? (
                          <select
                            className="input h-10 min-w-[240px]"
                            value={agent.model_config_id ?? ''}
                            onChange={e => assignModelMutation.mutate({
                              agentId: agent.id,
                              modelConfigId: e.target.value || null,
                            })}
                          >
                            <option value="">Use org default ({defaultConfig?.display_name || 'Not set'})</option>
                            {configs.filter(config => config.is_active).map(config => (
                              <option key={config.id} value={config.id}>
                                {config.display_name} · {PROVIDER_META[config.provider].label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button className="btn-secondary text-xs" onClick={() => setEditingAgentId(agent.id)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!loadingAgents && !agents.length && (
            <div className="px-4 py-10 text-center text-sm text-white/45">No agents yet.</div>
          )}
        </GlowCard>
      </section>

      <AddModelModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void 0} />
      <EditModelModal config={editingConfig} onClose={() => setEditingConfig(null)} />
      <ConfirmDialog
        open={Boolean(configToDelete)}
        title={`Delete ${configToDelete?.display_name || 'model'}?`}
        description="Are you sure? This cannot be undone."
        confirmLabel="Delete model"
        loading={deleteMutation.isPending}
        onClose={() => setConfigToDelete(null)}
        onConfirm={() => configToDelete && deleteMutation.mutate(configToDelete.id)}
      />
    </div>
  )
}

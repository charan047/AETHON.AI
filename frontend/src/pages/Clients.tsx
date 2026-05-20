import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { motion } from 'framer-motion'
import {
  Archive,
  ArrowRight,
  Briefcase,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Globe2,
  Loader2,
  Mail,
  MoreHorizontal,
  PlayCircle,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Unplug,
  Users,
  X,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { agentsApi, clientsApi, executionsApi, extractApiError, workflowsApi } from '../api/client'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { StatusDot } from '../components/ui/StatusDot'
import { TrustRing } from '../components/ui/TrustRing'
import { toast } from '../lib/toast'
import type { Agent, ClientCreateInput, ClientDetail, ClientWithStats, Workflow, WorkflowInputVariable } from '../types'

const CLIENT_COLORS = [
  '#3B82F6',
  '#2563EB',
  '#10B981',
  '#F59E0B',
  '#F43F5E',
  '#34D399',
] as const

const SERVICE_OPTIONS = [
  'Content Marketing',
  'Research',
  'Outreach',
  'Support',
  'Analytics',
  'Custom',
]

function normalizeClientColor(hex: string | null | undefined) {
  if (!hex) return '#3B82F6'
  if (hex.toLowerCase() === '#6366f1') return '#3B82F6'
  if (hex.toLowerCase() === '#8b5cf6') return '#60A5FA'
  return hex
}

function colorWithAlpha(hex: string | null | undefined, alpha = '22') {
  return `${normalizeClientColor(hex)}${alpha}`
}

function clientInitials(client: Pick<ClientWithStats, 'name' | 'company_name'>) {
  const source = (client.company_name || client.name || 'Client').trim()
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('')
}

function agentInitials(agent: Pick<Agent, 'persona_name' | 'name'>) {
  const source = (agent.persona_name || agent.name || 'Agent').trim()
  return source[0]?.toUpperCase() || 'A'
}

function relativeTime(value: string | null | undefined) {
  if (!value) return 'No activity yet'
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true })
  } catch {
    return 'No activity yet'
  }
}

function statusTone(status: ClientWithStats['status']) {
  if (status === 'active') {
    return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
  }
  if (status === 'paused') {
    return 'border-amber-400/25 bg-amber-400/10 text-amber-300'
  }
  return 'border-white/[0.08] bg-white/[0.04] text-white/45'
}

function executionStatusColor(status: string) {
  if (status === 'completed') return 'bg-emerald-400'
  if (status === 'running' || status === 'pending') return 'bg-amber-400'
  return 'bg-red-400'
}

function formatRole(roleSlug?: string | null, fallback?: string | null) {
  if (fallback?.trim()) return fallback
  if (!roleSlug) return 'Agent'
  return roleSlug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase())
}

function portalUrlForToken(token: string | null | undefined) {
  if (!token) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/portal/${token}`
}

function normalizeWorkflowInputVariables(inputVariables?: WorkflowInputVariable[] | null): WorkflowInputVariable[] {
  return (inputVariables || []).map((variable, index) => ({
    name: String(variable.name || `input_${index + 1}`),
    label: String(variable.label || variable.name || `Input ${index + 1}`),
    type: variable.type === 'select' || variable.type === 'number' ? variable.type : 'text',
    required: Boolean(variable.required),
    default: String(variable.default || ''),
    options: Array.isArray(variable.options)
      ? variable.options.map(option => String(option).trim()).filter(Boolean)
      : [],
  }))
}

function workflowVariablePrefill(variable: WorkflowInputVariable, client: ClientWithStats | ClientDetail) {
  const key = `${variable.name} ${variable.label}`.toLowerCase()
  if (key.includes('client') && key.includes('name')) return client.name || ''
  if (key.includes('company')) return client.company_name || client.name || ''
  if (key === 'client' || key.startsWith('client ')) return client.name || ''
  return variable.default || ''
}

function buildDispatchDefaults(workflow: Workflow | null, client: ClientWithStats | ClientDetail) {
  const variables = normalizeWorkflowInputVariables(workflow?.input_variables)
  return variables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable.name] = workflowVariablePrefill(variable, client)
    return acc
  }, {})
}

function buildSuggestedDocTitle(workflow: Workflow | null, client: ClientWithStats | ClientDetail) {
  if (!workflow) return ''
  return `${workflow.name} — ${client.name}`
}

function StatsCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: string
  accent: string
  hint: string
}) {
  return (
    <GlassCard
      padding="lg"
      className="rounded-2xl border-white/[0.08] bg-obsidian-900/90"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-white/35">{label}</div>
          <div className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">{value}</div>
          <div className="mt-2 text-sm text-ink-muted">{hint}</div>
        </div>
        <div
          className="h-11 w-11 rounded-2xl border border-white/[0.08]"
          style={{ backgroundColor: colorWithAlpha(accent, '18') }}
        />
      </div>
    </GlassCard>
  )
}

function QuickDispatchForm({
  client,
  workflows,
  workflowsLoading,
  workflowsError,
  compact = false,
  onStarted,
}: {
  client: ClientWithStats | ClientDetail
  workflows: Workflow[]
  workflowsLoading: boolean
  workflowsError: boolean
  compact?: boolean
  onStarted?: (executionId: string) => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const [rawInput, setRawInput] = useState('')
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [validationError, setValidationError] = useState<string | null>(null)
  const [lastExecutionId, setLastExecutionId] = useState<string | null>(null)

  const selectedWorkflow = useMemo(
    () => workflows.find(workflow => workflow.id === selectedWorkflowId) || null,
    [workflows, selectedWorkflowId],
  )
  const inputVariables = useMemo(
    () => normalizeWorkflowInputVariables(selectedWorkflow?.input_variables),
    [selectedWorkflow],
  )

  useEffect(() => {
    if (!selectedWorkflow) {
      setInputValues({})
      setRawInput('')
      setValidationError(null)
      return
    }
    setInputValues(buildDispatchDefaults(selectedWorkflow, client))
    setRawInput(selectedWorkflow.description || buildSuggestedDocTitle(selectedWorkflow, client))
    setValidationError(null)
  }, [client, selectedWorkflow])

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkflow) {
        throw new Error('Select a workflow first')
      }

      if (inputVariables.length > 0) {
        const missing = inputVariables
          .filter(variable => variable.required && !(inputValues[variable.name] || '').trim())
          .map(variable => variable.label || variable.name)
        if (missing.length > 0) {
          throw new Error(`Please fill the required inputs: ${missing.join(', ')}`)
        }

        return workflowsApi.run(
          selectedWorkflow.id,
          Object.fromEntries(
            Object.entries(inputValues).map(([key, value]) => [key, value.trim()]),
          ),
          client.id,
        )
      }

      if (!rawInput.trim()) {
        throw new Error('Task input is required')
      }

      return executionsApi.run(selectedWorkflow.id, rawInput.trim(), client.id)
    },
    onSuccess: execution => {
      setValidationError(null)
      setLastExecutionId(execution.execution_id)
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client', client.id] })
      qc.invalidateQueries({ queryKey: ['client-activity', client.id] })
      toast.success('Started — watch it in Monitoring')
      onStarted?.(execution.execution_id)
    },
    onError: error => {
      const message = extractApiError(error)
      setValidationError(message)
      toast.error(message)
    },
  })

  const submit = () => {
    setValidationError(null)
    runMutation.mutate()
  }

  const inputClassName = 'input h-11 rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60'

  return (
    <div className={clsx('space-y-4', compact && 'space-y-3')}>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Workflow</label>
        <select
          value={selectedWorkflowId}
          onChange={event => setSelectedWorkflowId(event.target.value)}
          disabled={workflowsLoading || runMutation.isPending}
          className={clsx(inputClassName, 'cursor-pointer')}
        >
          <option value="">{workflowsLoading ? 'Loading workflows…' : 'Select a workflow…'}</option>
          {workflows.map(workflow => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
      </div>

      {workflowsError && (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          Could not load workflows for quick dispatch.
        </div>
      )}

      {selectedWorkflow && inputVariables.length > 0 && (
        <div className="space-y-3">
          {inputVariables.map(variable => (
            <div key={variable.name}>
              <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">
                {variable.label}
                {variable.required && <span className="ml-1 text-red-300">*</span>}
              </label>
              {variable.type === 'select' ? (
                <select
                  value={inputValues[variable.name] ?? ''}
                  onChange={event => setInputValues(current => ({ ...current, [variable.name]: event.target.value }))}
                  className={clsx(inputClassName, 'cursor-pointer')}
                  disabled={runMutation.isPending}
                >
                  <option value="">Select {variable.label.toLowerCase()}…</option>
                  {(variable.options || []).map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={variable.type === 'number' ? 'number' : 'text'}
                  value={inputValues[variable.name] ?? ''}
                  onChange={event => setInputValues(current => ({ ...current, [variable.name]: event.target.value }))}
                  className={inputClassName}
                  placeholder={variable.default || variable.label}
                  disabled={runMutation.isPending}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {selectedWorkflow && inputVariables.length === 0 && (
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Task Input</label>
          <textarea
            value={rawInput}
            onChange={event => setRawInput(event.target.value)}
            className="input min-h-[108px] rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
            placeholder={`What should ${selectedWorkflow.name} do for ${client.name}?`}
            disabled={runMutation.isPending}
          />
        </div>
      )}

      {validationError && (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {validationError}
        </div>
      )}

      {lastExecutionId && (
        <button
          type="button"
          onClick={() => navigate(`/executions/${lastExecutionId}`)}
          className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-blue-300 transition-colors duration-200 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          <ArrowRight size={14} />
          Open execution
        </button>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!selectedWorkflowId || runMutation.isPending || workflowsLoading}
        className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
      >
        {runMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
        {runMutation.isPending ? 'Starting…' : `Run for ${client.name}`}
      </button>
    </div>
  )
}

function QuickDispatchModal({
  client,
  workflows,
  workflowsLoading,
  workflowsError,
  onClose,
}: {
  client: ClientWithStats
  workflows: Workflow[]
  workflowsLoading: boolean
  workflowsError: boolean
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-[28px] border border-white/[0.08] bg-base-bg p-6 shadow-glow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">Run for {client.name}</h2>
              <p className="mt-1 text-sm text-ink-muted">Kick off client work without leaving the clients page.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/50 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
              aria-label="Close quick dispatch"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-6">
            <QuickDispatchForm
              client={client}
              workflows={workflows}
              workflowsLoading={workflowsLoading}
              workflowsError={workflowsError}
              compact
            />
          </div>
        </div>
      </div>
    </>
  )
}

function ClientsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <GlassCard
            key={index}
            padding="lg"
            className="rounded-2xl border-white/[0.08] bg-obsidian-900/90"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-9 w-24" />
            <Skeleton className="mt-3 h-3 w-32" />
          </GlassCard>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} className="min-h-[250px]" />
        ))}
      </div>
    </div>
  )
}

function ClientDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 rounded-[28px]" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <div className="space-y-6">
          <Skeleton className="h-80 rounded-[28px]" />
          <Skeleton className="h-72 rounded-[28px]" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-[28px]" />
          <Skeleton className="h-96 rounded-[28px]" />
        </div>
      </div>
    </div>
  )
}

function ClientCard({
  client,
  index,
  onOpen,
  onEdit,
  onRun,
}: {
  client: ClientWithStats
  index: number
  onOpen: () => void
  onEdit: () => void
  onRun: () => void
}) {
  const animationClass = `animate-d-${Math.min(index, 6)}`
  return (
    <motion.article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      whileHover={{ y: -2 }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={clsx(
        'glass-card group cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08] border-l-[3px] p-5 transition-all duration-200 ease-out hover:border-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
        animationClass,
      )}
      style={{
        borderLeftColor: normalizeClientColor(client.color),
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 24px rgba(0,0,0,0.28), 0 0 0 1px ${colorWithAlpha(client.color, '10')}`,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] text-sm font-semibold text-white"
            style={{ backgroundColor: colorWithAlpha(client.color, '33') }}
          >
            {clientInitials(client)}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold tracking-tight text-white">{client.name}</h3>
            <p className="truncate text-sm text-[#8B9DBE]">{client.company_name || client.service_type || 'Agency client workspace'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={event => {
            event.stopPropagation()
            onEdit()
          }}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/50 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          aria-label={`Edit ${client.name}`}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      <div className="mt-5 border-y border-white/[0.06] py-4">
        <div className="font-mono text-xs text-[#8B9DBE]">
          {client.agent_count} agents · {client.execution_count_30d} runs
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-[#8B9DBE]">
          <span>Last activity</span>
          <span className="truncate text-right">{relativeTime(client.last_activity)}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {client.portal_enabled ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Portal live
          </span>
        ) : (
          <span className="text-xs text-white/30">Portal disabled</span>
        )}
        <button
          type="button"
          onClick={event => {
            event.stopPropagation()
            onRun()
          }}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white/70 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          <PlayCircle size={12} />
          Run
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-white/45 transition-colors duration-200 group-hover:text-blue-300">
          View <ArrowRight size={13} />
        </span>
      </div>
    </motion.article>
  )
}

function ClientForm({
  initial,
  onClose,
  onSubmit,
  isSaving,
}: {
  initial: Partial<ClientDetail> | null
  onClose: () => void
  onSubmit: (data: ClientCreateInput) => Promise<void>
  isSaving: boolean
}) {
  const [form, setForm] = useState<ClientCreateInput>({
    name: initial?.name || '',
    company_name: initial?.company_name || '',
    contact_email: initial?.contact_email || '',
    description: initial?.description || '',
    service_type: initial?.service_type || '',
    notes: initial?.notes || '',
    color: initial?.color || CLIENT_COLORS[0],
  })

  useEffect(() => {
    setForm({
      name: initial?.name || '',
      company_name: initial?.company_name || '',
      contact_email: initial?.contact_email || '',
      description: initial?.description || '',
      service_type: initial?.service_type || '',
      notes: initial?.notes || '',
      color: initial?.color || CLIENT_COLORS[0],
    })
  }, [initial])

  const set = (key: keyof ClientCreateInput, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Client name is required')
      return
    }
    if (form.contact_email?.trim()) {
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())
      if (!valid) {
        toast.error('Enter a valid contact email')
        return
      }
    }
    await onSubmit({
      ...form,
      name: form.name.trim(),
      company_name: form.company_name?.trim() || null,
      contact_email: form.contact_email?.trim() || null,
      description: form.description?.trim() || null,
      service_type: form.service_type?.trim() || null,
      notes: form.notes?.trim() || null,
      color: form.color || CLIENT_COLORS[0],
    })
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-white/[0.08] bg-base-bg shadow-glow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              {initial?.id ? 'Edit client' : 'Add client'}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Create a client workspace to deploy AI agents on their behalf.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/50 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            aria-label="Close client form"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Client Name *</label>
              <input
                value={form.name}
                onChange={event => set('name', event.target.value)}
                className="input h-12 rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                placeholder="Acme Growth Lab"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Company Name</label>
                <input
                  value={form.company_name || ''}
                  onChange={event => set('company_name', event.target.value)}
                  className="input h-12 rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                  placeholder="Acme Inc."
                />
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Contact Email</label>
                <input
                  value={form.contact_email || ''}
                  onChange={event => set('contact_email', event.target.value)}
                  className="input h-12 rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                  placeholder="ops@acme.com"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Service Type</label>
              <select
                value={form.service_type || ''}
                onChange={event => set('service_type', event.target.value)}
                className="input h-12 rounded-2xl border-white/[0.08] bg-base-surface text-white focus-visible:ring-blue-500/60"
              >
                <option value="">Select a service</option>
                {SERVICE_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Description</label>
              <textarea
                value={form.description || ''}
                onChange={event => set('description', event.target.value)}
                className="input min-h-[120px] rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                placeholder="What kind of outcomes is this client hiring your agency to deliver?"
              />
            </div>

            <div>
              <label className="mb-3 block text-xs uppercase tracking-[0.16em] text-white/35">Color</label>
              <div className="flex flex-wrap gap-3">
                {CLIENT_COLORS.map(color => {
                  const selected = (form.color || CLIENT_COLORS[0]) === color
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => set('color', color)}
                      className={clsx(
                        'h-11 w-11 cursor-pointer rounded-2xl border transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
                        selected ? 'border-white/60 ring-2 ring-white/20' : 'border-white/[0.08]',
                      )}
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${color}`}
                    />
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Notes</label>
              <textarea
                value={form.notes || ''}
                onChange={event => set('notes', event.target.value)}
                className="input min-h-[96px] rounded-2xl border-white/[0.08] bg-base-surface text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                placeholder="Internal notes for your team only."
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-white/[0.08] px-6 py-5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {initial?.id ? 'Save changes' : 'Add client'}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/70 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            Cancel
          </button>
        </div>
      </aside>
    </>
  )
}

function AssignAgentModal({
  client,
  assignedAgents,
  availableAgents,
  onClose,
  onAssign,
  onRemove,
  isAssigning,
  removingAgentId,
}: {
  client: ClientDetail
  assignedAgents: Agent[]
  availableAgents: Agent[]
  onClose: () => void
  onAssign: (agentId: string) => void
  onRemove: (agent: Agent) => void
  isAssigning: boolean
  removingAgentId: string | null
}) {
  const renderAgentRow = (agent: Agent, actionLabel: string, action: () => void, destructive = false) => (
    <div key={agent.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-blue-600/12 text-sm font-semibold text-white">
        {agentInitials(agent)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{agent.persona_name || agent.name}</div>
        <div className="truncate text-xs text-ink-muted">{formatRole(agent.role_slug, agent.role)}</div>
      </div>
      <button
        type="button"
        onClick={action}
        disabled={isAssigning || removingAgentId === agent.id}
        className={clsx(
          'inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
          destructive
            ? 'border border-red-400/20 bg-red-400/10 text-red-200 hover:bg-red-400/15'
            : 'border border-white/[0.08] bg-white/[0.05] text-white/75 hover:bg-white/[0.08] hover:text-white',
        )}
      >
        {removingAgentId === agent.id ? <Loader2 size={14} className="animate-spin" /> : null}
        {actionLabel}
      </button>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xl"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/[0.08] bg-base-bg shadow-glow-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">Assign agent to {client.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">Attach specialists to this client workspace and rebalance ownership without leaving the page.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/50 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            aria-label="Close assign agent modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/60">Assigned</h3>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-white/50">
                {assignedAgents.length}
              </span>
            </div>
            {assignedAgents.length ? (
              <div className="space-y-3">
                {assignedAgents.map(agent => renderAgentRow(agent, 'Remove', () => onRemove(agent), true))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-ink-muted">
                No agents assigned yet.
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/60">Available</h3>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-white/50">
                {availableAgents.length}
              </span>
            </div>
            {availableAgents.length ? (
              <div className="space-y-3">
                {availableAgents.map(agent => renderAgentRow(agent, 'Assign', () => onAssign(agent.id)))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-ink-muted">
                All agents are already assigned.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function ClientsList({
  onEditClient,
}: {
  onEditClient: (client: Partial<ClientDetail>) => void
}) {
  const navigate = useNavigate()
  const [quickRunClient, setQuickRunClient] = useState<ClientWithStats | null>(null)
  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
    refetchOnMount: 'always',
  })
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: workflowsApi.list,
  })

  const clients = clientsQuery.data?.clients || []
  const totalRuns30d = clients.reduce((sum, client) => sum + client.execution_count_30d, 0)
  const totalAgents = clients.reduce((sum, client) => sum + client.agent_count, 0)
  const activeClients = clients.filter(client => client.status === 'active').length

  const stats = useMemo(() => ([
    {
      label: 'Total Clients',
      value: String(clientsQuery.data?.total || 0),
      accent: '#3B82F6',
      hint: 'Active client workspaces under management',
    },
    {
      label: 'Active',
      value: String(activeClients),
      accent: '#10B981',
      hint: 'Currently engaged and delivering work',
    },
    {
      label: 'Runs (30d)',
      value: String(totalRuns30d),
      accent: '#06B6D4',
      hint: 'Recent workflow executions across client accounts',
    },
    {
      label: 'Agents Deployed',
      value: String(totalAgents),
      accent: '#F59E0B',
      hint: 'Specialists currently assigned across clients',
    },
  ]), [activeClients, clientsQuery.data?.total, totalAgents, totalRuns30d])

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">{activeClients} active accounts</p>
        </div>
        <button
          type="button"
          onClick={() => onEditClient({ color: CLIENT_COLORS[0] })}
          className="btn-runner btn-primary inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          <Plus size={16} />
          Add Client
        </button>
      </header>

      {clientsQuery.isLoading ? (
        <ClientsSkeleton />
      ) : clientsQuery.isError ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-center text-red-200">
          <p>Could not load clients.</p>
          <button
            type="button"
            onClick={() => clientsQuery.refetch()}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-blue-300 transition-colors duration-200 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      ) : !clients.length ? (
        <div className="rounded-[28px] border border-white/[0.08] bg-base-surface p-10 text-center shadow-glow-sm">
          <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-3xl border border-blue-500/20 bg-blue-600/10 text-blue-300">
            <Briefcase size={34} />
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-white">Add your first client</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-muted">
            Create a client workspace to deploy AI agents on their behalf.
          </p>
          <button
            type="button"
            onClick={() => onEditClient({ color: CLIENT_COLORS[0] })}
            className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-5 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            <Plus size={16} />
            Add Your First Client
          </button>
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((client, index) => (
              <ClientCard
                key={client.id}
                client={client}
                index={index}
                onOpen={() => navigate(`/clients/${client.id}`)}
                onEdit={() => onEditClient(client)}
                onRun={() => setQuickRunClient(client)}
              />
            ))}
          </section>
        </>
      )}

      {quickRunClient && (
        <QuickDispatchModal
          client={quickRunClient}
          workflows={workflowsQuery.data || []}
          workflowsLoading={workflowsQuery.isLoading}
          workflowsError={workflowsQuery.isError}
          onClose={() => setQuickRunClient(null)}
        />
      )}
    </div>
  )
}

function ClientDetailPage({
  clientId,
  onEditClient,
  onArchiveClient,
  onClose,
}: {
  clientId: string
  onEditClient: (client: Partial<ClientDetail>) => void
  onArchiveClient: (client: ClientDetail) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [agentToRemove, setAgentToRemove] = useState<Agent | null>(null)
  const [detailsDraft, setDetailsDraft] = useState({
    contact_email: '',
    service_type: '',
    description: '',
    notes: '',
  })

  const clientQuery = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => clientsApi.get(clientId),
    enabled: Boolean(clientId),
  })
  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
    enabled: Boolean(clientId),
  })
  const activityQuery = useQuery({
    queryKey: ['client-activity', clientId],
    queryFn: () => clientsApi.getActivity(clientId),
    enabled: Boolean(clientId),
  })
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: workflowsApi.list,
    enabled: Boolean(clientId),
  })

  useEffect(() => {
    if (clientQuery.data) {
      setDetailsDraft({
        contact_email: clientQuery.data.contact_email || '',
        service_type: clientQuery.data.service_type || '',
        description: clientQuery.data.description || '',
        notes: clientQuery.data.notes || '',
      })
    }
  }, [clientQuery.data])

  const agents = agentsQuery.data || []
  const assignedAgents = useMemo(
    () => agents.filter(agent => agent.client_id === clientId),
    [agents, clientId],
  )
  const availableAgents = useMemo(
    () => agents.filter(agent => !agent.client_id),
    [agents],
  )
  const activityItems = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    return (activityQuery.data?.activity || []).filter(item => {
      if (!item.started_at) return false
      return new Date(item.started_at).getTime() >= cutoff
    })
  }, [activityQuery.data?.activity])

  const assignMutation = useMutation({
    mutationFn: ({ agentId, nextClientId }: { agentId: string; nextClientId: string | null }) =>
      clientsApi.assignAgent(agentId, nextClientId),
    onMutate: async ({ agentId, nextClientId }) => {
      await qc.cancelQueries({ queryKey: ['agents'] })
      const previousAgents = qc.getQueryData<Agent[]>(['agents']) || []
      qc.setQueryData<Agent[]>(['agents'], current =>
        (current || []).map(agent =>
          agent.id === agentId ? { ...agent, client_id: nextClientId } : agent,
        ),
      )
      return { previousAgents }
    },
    onError: (error, _variables, context) => {
      if (context?.previousAgents) {
        qc.setQueryData(['agents'], context.previousAgents)
      }
      setAgentToRemove(null)
      toast.error(extractApiError(error))
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client', clientId] })
      setAgentToRemove(null)
      if (variables.nextClientId) {
        setAssignModalOpen(false)
      }
      toast.success(variables.nextClientId ? 'Agent assigned' : 'Agent removed')
    },
  })

  const portalToggleMutation = useMutation({
    mutationFn: async () => {
      if (clientQuery.data?.portal_enabled) {
        return clientsApi.disablePortal(clientId)
      }
      return clientsApi.enablePortal(clientId)
    },
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client', clientId] })
      if (clientQuery.data?.portal_enabled) {
        toast.success('Client portal disabled')
      } else {
        toast.success(`Client portal enabled: ${'portal_url' in data ? data.portal_url : '/portal'}`)
      }
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const regeneratePortalMutation = useMutation({
    mutationFn: () => clientsApi.regenerateToken(clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', clientId] })
      toast.success('Portal link regenerated')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const saveDetailsMutation = useMutation({
    mutationFn: () =>
      clientsApi.update(clientId, {
        contact_email: detailsDraft.contact_email.trim() || null,
        service_type: detailsDraft.service_type.trim() || null,
        description: detailsDraft.description.trim() || null,
        notes: detailsDraft.notes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client', clientId] })
      toast.success('Client details saved')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const copyPortalLink = async () => {
    const url = portalUrlForToken(clientQuery.data?.portal_token)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Portal link copied')
    } catch {
      toast.error('Could not copy portal link')
    }
  }

  if (clientQuery.isLoading || agentsQuery.isLoading) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-white/[0.07] bg-transparent">
          <div className="glass-elevated m-0 flex h-full flex-col rounded-none border-0 border-l border-white/[0.07] p-6">
            <ClientDetailSkeleton />
          </div>
        </aside>
      </>
    )
  }

  if (clientQuery.isError || !clientQuery.data) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-white/[0.07] bg-transparent">
          <div className="glass-elevated m-0 flex h-full flex-col rounded-none border-0 border-l border-white/[0.07] p-6">
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-center text-red-200">
              <p>Could not load this client workspace.</p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button type="button" onClick={() => clientQuery.refetch()} className="btn-secondary">
                  <RefreshCw size={14} />
                  Try again
                </button>
                <button type="button" onClick={onClose} className="btn-primary">Back</button>
              </div>
            </div>
          </div>
        </aside>
      </>
    )
  }

  const client = clientQuery.data
  const portalUrl = portalUrlForToken(client.portal_token)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-white/[0.07] bg-transparent">
        <div className="glass-elevated m-0 flex h-full flex-col rounded-none border-0 border-l border-white/[0.07] p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] text-base font-semibold text-white"
                style={{ backgroundColor: colorWithAlpha(client.color, '30') }}
              >
                {clientInitials(client)}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold tracking-tight text-white">{client.name}</h2>
                <p className="truncate text-sm text-[#8B9DBE]">{client.company_name || client.service_type || 'Agency client workspace'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onEditClient(client)} className="btn-secondary btn-sm">
                <PencilLine size={14} />
                Edit
              </button>
              <button type="button" onClick={() => onArchiveClient(client)} className="btn-danger btn-sm">
                <Archive size={14} />
                Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-icon text-white/45 hover:text-white"
                aria-label="Close client details"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
            <section>
              <div className="section-title">Overview</div>
              <div className="glass-card space-y-3 rounded-2xl p-4">
                <div className="data-row cursor-default rounded-xl border-none bg-transparent px-0 py-0">
                  <div className="min-w-0 flex-1 text-sm text-white">Contact</div>
                  <div className="truncate font-mono text-xs text-[#8B9DBE]">{client.contact_email || 'Not set'}</div>
                </div>
                <div className="data-row cursor-default rounded-xl border-none bg-transparent px-0 py-0">
                  <div className="min-w-0 flex-1 text-sm text-white">Service</div>
                  <div className="truncate font-mono text-xs text-[#8B9DBE]">{client.service_type || 'Not set'}</div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-6 text-[#8B9DBE]">
                  {client.description || 'No description yet.'}
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-6 text-[#8B9DBE]">
                  {client.notes || 'No internal notes yet.'}
                </div>
                <div className="border-t border-white/[0.06] pt-4">
                  <div className="mb-3 text-sm font-medium text-white">Quick dispatch</div>
                  <QuickDispatchForm
                    client={client}
                    workflows={workflowsQuery.data || []}
                    workflowsLoading={workflowsQuery.isLoading}
                    workflowsError={workflowsQuery.isError}
                    compact
                  />
                </div>
              </div>
            </section>

            <section>
              <div className="section-title">Agents</div>
              <div className="glass-card rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-[#8B9DBE]">{assignedAgents.length} assigned</div>
                  <button type="button" onClick={() => setAssignModalOpen(true)} className="btn-primary btn-sm">
                    <Plus size={14} />
                    Assign
                  </button>
                </div>
                {assignedAgents.length ? (
                  <div className="space-y-3">
                    {assignedAgents.map(agent => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => navigate('/agents')}
                        className="data-row w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-blue-600/12 text-xs font-semibold text-white">
                          {agentInitials(agent)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white">{agent.persona_name || agent.name}</div>
                          <div className="truncate text-xs text-[#8B9DBE]">{formatRole(agent.role_slug, agent.role)}</div>
                        </div>
                        <TrustRing score={agent.trust_score ?? 0} radius={14} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-[#8B9DBE]">
                    No agents assigned yet.
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="section-title">Activity</div>
              <div className="glass-card rounded-2xl p-4">
                {activityQuery.isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-2xl" />)}
                  </div>
                ) : activityQuery.isError ? (
                  <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                    Could not load recent activity.
                  </div>
                ) : !activityItems.length ? (
                  <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-[#8B9DBE]">
                    No activity yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activityItems.map(item => (
                      <button
                        key={item.execution_id}
                        type="button"
                        onClick={() => navigate(`/executions/${item.execution_id}`)}
                        className="data-row w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left"
                      >
                        <span className={clsx('status-dot', executionStatusColor(item.status))} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white">{item.agent_name || 'Workflow agent'}</div>
                          <div className="truncate text-xs text-[#8B9DBE]">{item.input_message_preview}</div>
                        </div>
                        <div className="font-mono text-[11px] text-[#8B9DBE]">{relativeTime(item.started_at)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="section-title">Portal</div>
              <div className="glass-card rounded-2xl p-4">
                {!client.portal_enabled ? (
                  <div className="space-y-4">
                    <div className="text-sm leading-6 text-[#8B9DBE]">
                      Share a read-only portal link so your client can follow progress without logging in.
                    </div>
                    <button type="button" onClick={() => portalToggleMutation.mutate()} disabled={portalToggleMutation.isPending} className="btn-primary btn-sm">
                      {portalToggleMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Globe2 size={14} />}
                      Enable Portal
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      Portal live
                    </div>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <div className="truncate font-mono text-sm text-white/80">{portalUrl}</div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={copyPortalLink} className="btn-secondary btn-sm">
                        <Copy size={14} />
                        Copy
                      </button>
                      <a href={portalUrl} target="_blank" rel="noreferrer" className="btn-primary btn-sm">
                        <ExternalLink size={14} />
                        Open
                      </a>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => regeneratePortalMutation.mutate()} disabled={regeneratePortalMutation.isPending} className="btn-secondary btn-sm">
                        {regeneratePortalMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Regenerate
                      </button>
                      <button type="button" onClick={() => portalToggleMutation.mutate()} disabled={portalToggleMutation.isPending} className="btn-danger btn-sm">
                        {portalToggleMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                        Disable
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </aside>

      {assignModalOpen && (
        <AssignAgentModal
          client={client}
          assignedAgents={assignedAgents}
          availableAgents={availableAgents}
          onClose={() => setAssignModalOpen(false)}
          onAssign={agentId => assignMutation.mutate({ agentId, nextClientId: clientId })}
          onRemove={agent => setAgentToRemove(agent)}
          isAssigning={assignMutation.isPending}
          removingAgentId={assignMutation.isPending ? agentToRemove?.id || null : null}
        />
      )}

      <ConfirmDialog
        open={Boolean(agentToRemove)}
        title={`Remove ${agentToRemove?.persona_name || agentToRemove?.name || 'agent'} from this client?`}
        description="The agent stays in your agency but will no longer be assigned to this client account."
        confirmLabel="Remove agent"
        loading={assignMutation.isPending}
        onClose={() => setAgentToRemove(null)}
        onConfirm={() => {
          if (agentToRemove) {
            assignMutation.mutate(
              { agentId: agentToRemove.id, nextClientId: null },
              { onSuccess: () => setAgentToRemove(null) },
            )
          }
        }}
      />
    </>
  )
}

export function Clients() {
  const navigate = useNavigate()
  const { clientId } = useParams()
  const qc = useQueryClient()
  const [formState, setFormState] = useState<Partial<ClientDetail> | null>(null)
  const [clientToArchive, setClientToArchive] = useState<ClientDetail | null>(null)

  const createMutation = useMutation({
    mutationFn: clientsApi.create,
    onSuccess: client => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      toast.success('Client added')
      setFormState(null)
      navigate(`/clients/${client.id}`)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ClientCreateInput> }) =>
      clientsApi.update(id, data),
    onSuccess: (_client, variables) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client', variables.id] })
      toast.success('Client updated')
      setFormState(null)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const archiveMutation = useMutation({
    mutationFn: clientsApi.archive,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      if (clientToArchive?.id) {
        qc.invalidateQueries({ queryKey: ['client', clientToArchive.id] })
      }
      toast.success('Client archived')
      setClientToArchive(null)
      navigate('/clients')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const handleSubmit = async (data: ClientCreateInput) => {
    if (formState?.id) {
      await updateMutation.mutateAsync({ id: formState.id, data })
      return
    }
    await createMutation.mutateAsync(data)
  }

  return (
    <>
      <ClientsList onEditClient={client => setFormState(client)} />

      {clientId ? (
        <ClientDetailPage
          clientId={clientId}
          onEditClient={client => setFormState(client)}
          onArchiveClient={client => setClientToArchive(client)}
          onClose={() => navigate('/clients')}
        />
      ) : null}

      {formState && (
        <ClientForm
          initial={formState}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          isSaving={createMutation.isPending || updateMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={Boolean(clientToArchive)}
        title={`Archive ${clientToArchive?.name || 'client'}?`}
        description="This marks the client as completed and unassigns all linked agents. Execution history remains intact."
        confirmLabel="Archive client"
        loading={archiveMutation.isPending}
        onClose={() => setClientToArchive(null)}
        onConfirm={() => clientToArchive && archiveMutation.mutate(clientToArchive.id)}
      />
    </>
  )
}

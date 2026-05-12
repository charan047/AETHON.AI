import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
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
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Unplug,
  Users,
  X,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { agentsApi, clientsApi, extractApiError } from '../api/client'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { StatusDot } from '../components/ui/StatusDot'
import { TrustScoreBar } from '../components/ui/TrustScoreBar'
import { toast } from '../lib/toast'
import type { Agent, ClientCreateInput, ClientDetail, ClientWithStats } from '../types'

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
  return 'border-white/10 bg-white/[0.04] text-white/45'
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
          <div className="mt-2 text-sm text-obsidian-400">{hint}</div>
        </div>
        <div
          className="h-11 w-11 rounded-2xl border border-white/10"
          style={{ backgroundColor: colorWithAlpha(accent, '18') }}
        />
      </div>
    </GlassCard>
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
  onOpen,
  onEdit,
}: {
  client: ClientWithStats
  onOpen: () => void
  onEdit: () => void
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="group cursor-pointer rounded-2xl border border-white/[0.08] border-l-[3px] bg-obsidian-900 p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-white/[0.12] hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
      style={{ borderLeftColor: normalizeClientColor(client.color) }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-white"
            style={{ backgroundColor: colorWithAlpha(client.color, '26') }}
          >
            {clientInitials(client)}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-white">
              {client.company_name || client.name}
            </h3>
            <p className="truncate text-sm text-obsidian-400">
              {client.service_type || 'Agency client workspace'}
            </p>
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

      <div className="mt-5 space-y-3 border-y border-white/[0.06] py-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-white/25">Agents</div>
            <div className="mt-1 font-semibold text-white">{client.agent_count}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-white/25">Runs</div>
            <div className="mt-1 font-semibold text-white">{client.execution_count_30d}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-white/25">Last</div>
            <div className="mt-1 truncate font-semibold text-white">{relativeTime(client.last_activity)}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', statusTone(client.status))}>
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
          {client.status}
        </span>
        {client.portal_enabled && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-600/10 px-2.5 py-1 text-xs font-medium text-blue-300">
            <Globe2 size={12} />
            Portal On
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-white/45 transition-colors duration-200 group-hover:text-blue-300">
          View <ArrowRight size={13} />
        </span>
      </div>
    </article>
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
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-white/[0.08] bg-obsidian-950 shadow-glow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              {initial?.id ? 'Edit client' : 'Add client'}
            </h2>
            <p className="mt-1 text-sm text-obsidian-400">
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
                className="input h-12 rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                placeholder="Acme Growth Lab"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Company Name</label>
                <input
                  value={form.company_name || ''}
                  onChange={event => set('company_name', event.target.value)}
                  className="input h-12 rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                  placeholder="Acme Inc."
                />
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Contact Email</label>
                <input
                  value={form.contact_email || ''}
                  onChange={event => set('contact_email', event.target.value)}
                  className="input h-12 rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                  placeholder="ops@acme.com"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Service Type</label>
              <select
                value={form.service_type || ''}
                onChange={event => set('service_type', event.target.value)}
                className="input h-12 rounded-2xl border-white/[0.08] bg-obsidian-900 text-white focus-visible:ring-blue-500/60"
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
                className="input min-h-[120px] rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
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
                        selected ? 'border-white/60 ring-2 ring-white/20' : 'border-white/10',
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
                className="input min-h-[96px] rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
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
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-blue-600/12 text-sm font-semibold text-white">
        {agentInitials(agent)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{agent.persona_name || agent.name}</div>
        <div className="truncate text-xs text-obsidian-400">{formatRole(agent.role_slug, agent.role)}</div>
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
        className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/[0.08] bg-obsidian-950 shadow-glow-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">Assign agent to {client.name}</h2>
            <p className="mt-1 text-sm text-obsidian-400">Attach specialists to this client workspace and rebalance ownership without leaving the page.</p>
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
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-obsidian-400">
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
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-sm text-obsidian-400">
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
  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
    refetchOnMount: 'always',
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
      <header className="sticky top-0 z-20 -mx-6 border-b border-white/[0.06] bg-obsidian-950/92 px-6 pb-5 pt-2 backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">Clients</h1>
            <p className="mt-2 text-sm text-obsidian-400">Manage the businesses you serve.</p>
          </div>
          <button
            type="button"
            onClick={() => onEditClient({ color: CLIENT_COLORS[0] })}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            <Plus size={16} />
            Add Client
          </button>
        </div>
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
        <div className="rounded-[28px] border border-white/[0.08] bg-obsidian-900 p-10 text-center shadow-glow-sm">
          <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-3xl border border-blue-500/20 bg-blue-600/10 text-blue-300">
            <Briefcase size={34} />
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-white">Add your first client</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-obsidian-400">
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
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(item => (
              <StatsCard key={item.label} {...item} />
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clients.map(client => (
              <ClientCard
                key={client.id}
                client={client}
                onOpen={() => navigate(`/clients/${client.id}`)}
                onEdit={() => onEditClient(client)}
              />
            ))}
          </section>
        </>
      )}
    </div>
  )
}

function ClientDetailPage({
  clientId,
  onEditClient,
  onArchiveClient,
}: {
  clientId: string
  onEditClient: (client: Partial<ClientDetail>) => void
  onArchiveClient: (client: ClientDetail) => void
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
      <div className="space-y-6 p-6">
        <ClientDetailSkeleton />
      </div>
    )
  }

  if (clientQuery.isError || !clientQuery.data) {
    return (
      <div className="space-y-6 p-6">
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-center text-red-200">
          <p>Could not load this client workspace.</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => clientQuery.refetch()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-white/75 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              <RefreshCw size={14} />
              Try again
            </button>
            <Link
              to="/clients"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
            >
              Back to clients
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const client = clientQuery.data
  const portalUrl = portalUrlForToken(client.portal_token)

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2 text-sm text-white/45">
          <Link to="/clients" className="cursor-pointer transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60">
            Clients
          </Link>
          <ChevronRight size={14} />
          <span className="text-white/70">{client.company_name || client.name}</span>
        </div>

        <section className="rounded-[28px] border border-white/[0.08] bg-obsidian-900 p-6 shadow-glow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[24px] border border-white/10 text-xl font-semibold text-white"
                style={{ backgroundColor: colorWithAlpha(client.color, '26') }}
              >
                {clientInitials(client)}
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">{client.name}</h1>
                <p className="mt-2 text-sm text-obsidian-400">
                  {[client.company_name, client.service_type].filter(Boolean).join(' · ') || 'Agency client workspace'}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', statusTone(client.status))}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                    {client.status}
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-white/45">
                    {assignedAgents.length} agents
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onEditClient(client)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/75 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
              >
                <PencilLine size={15} />
                Edit
              </button>
              <button
                type="button"
                onClick={() => onArchiveClient(client)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-medium text-red-200 transition-colors duration-200 hover:bg-red-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
              >
                <Archive size={15} />
                Archive
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
          <div className="space-y-6">
            <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-obsidian-900/95">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight text-white">AI Team</h2>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-white/45">
                      {assignedAgents.length}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-obsidian-400">Agents currently deployed on this account.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  <Plus size={16} />
                  Assign Agent
                </button>
              </div>

              {assignedAgents.length ? (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {assignedAgents.map(agent => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => navigate('/agents')}
                      className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.12] hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-blue-600/12 text-sm font-semibold text-white">
                        {agentInitials(agent)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{agent.persona_name || agent.name}</div>
                        <div className="mt-1 text-xs text-obsidian-400">{formatRole(agent.role_slug, agent.role)}</div>
                        <div className="mt-3">
                          <TrustScoreBar score={agent.trust_score ?? 0} size="xs" />
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <StatusDot status={(agent.current_status as 'working' | 'idle' | 'blocked' | 'in_meeting' | 'reviewing' | 'waiting_approval' | 'queued') || 'idle'} showLabel size="xs" />
                          <span className="text-xs text-white/35">Open team view</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-obsidian-400">
                  No agents assigned yet. Add one to start delivering work for this client.
                </div>
              )}
              {agentsQuery.isError && (
                <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                  Could not load the full agency roster for assignment.
                </div>
              )}
            </GlassCard>

            <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-obsidian-900/95">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-white">Recent Activity</h2>
                  <p className="mt-2 text-sm text-obsidian-400">Last 14 days of execution activity for this account.</p>
                </div>
              </div>

              {activityQuery.isLoading ? (
                <div className="mt-5 space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 rounded-2xl" />
                  ))}
                </div>
              ) : activityQuery.isError ? (
                <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                  Could not load recent activity.
                </div>
              ) : activityQuery.isError ? (
                <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                  Could not load recent activity.
                </div>
              ) : !activityItems.length ? (
                <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-obsidian-400">
                  No activity yet. Run a workflow and assign it to this client.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {activityItems.map(item => (
                    <button
                      key={item.execution_id}
                      type="button"
                      onClick={() => navigate(`/executions/${item.execution_id}`)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      <span className={clsx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', executionStatusColor(item.status))} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">
                          {item.agent_name || 'Workflow agent'} ran: <span className="text-white/70">{item.input_message_preview}</span>
                        </div>
                        <div className="mt-1 text-xs text-obsidian-400">{relativeTime(item.started_at)}</div>
                      </div>
                      <ArrowRight size={14} className="mt-0.5 shrink-0 text-white/30" />
                    </button>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          <div className="space-y-6">
            <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-obsidian-900/95">
              <div className="flex items-center gap-2">
                <Globe2 size={18} className="text-blue-300" />
                <h2 className="text-xl font-semibold tracking-tight text-white">Client Portal</h2>
              </div>

              {!client.portal_enabled ? (
                <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                  <p className="text-sm leading-6 text-obsidian-300">
                    Share a read-only portal link with your client. They can see agent activity without logging in.
                  </p>
                  <button
                    type="button"
                    onClick={() => portalToggleMutation.mutate()}
                    disabled={portalToggleMutation.isPending}
                    className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  >
                    {portalToggleMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Globe2 size={15} />}
                    Enable Portal
                  </button>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Active
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                    <div className="truncate font-mono text-sm text-white/80">{portalUrl}</div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={copyPortalLink}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/75 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      <Copy size={15} />
                      Copy Link
                    </button>
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      <ExternalLink size={15} />
                      Open Portal
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <button
                      type="button"
                      onClick={() => portalToggleMutation.mutate()}
                      disabled={portalToggleMutation.isPending}
                      className="inline-flex cursor-pointer items-center gap-2 text-red-300 transition-colors duration-200 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                    >
                      {portalToggleMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                      Disable Portal
                    </button>
                    <button
                      type="button"
                      onClick={() => regeneratePortalMutation.mutate()}
                      disabled={regeneratePortalMutation.isPending}
                      className="inline-flex cursor-pointer items-center gap-2 text-blue-300 transition-colors duration-200 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      {regeneratePortalMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Regenerate Link
                    </button>
                  </div>
                  <p className="text-xs leading-5 text-white/35">Regenerating the link immediately invalidates the old portal URL.</p>
                </div>
              )}
            </GlassCard>

            <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-obsidian-900/95">
              <h2 className="text-xl font-semibold tracking-tight text-white">Client Details</h2>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Contact Email</label>
                  <div className="relative">
                    <Mail size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      value={detailsDraft.contact_email}
                      onChange={event => setDetailsDraft(prev => ({ ...prev, contact_email: event.target.value }))}
                      className="input h-12 rounded-2xl border-white/[0.08] bg-obsidian-900 pl-10 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                      placeholder="ops@client.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Service Type</label>
                  <input
                    value={detailsDraft.service_type}
                    onChange={event => setDetailsDraft(prev => ({ ...prev, service_type: event.target.value }))}
                    className="input h-12 rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                    placeholder="Research"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Description</label>
                  <textarea
                    value={detailsDraft.description}
                    onChange={event => setDetailsDraft(prev => ({ ...prev, description: event.target.value }))}
                    className="input min-h-[110px] rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                    placeholder="How your agency is helping this client."
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/35">Notes</label>
                  <textarea
                    value={detailsDraft.notes}
                    onChange={event => setDetailsDraft(prev => ({ ...prev, notes: event.target.value }))}
                    className="input min-h-[110px] rounded-2xl border-white/[0.08] bg-obsidian-900 text-white placeholder:text-white/20 focus-visible:ring-blue-500/60"
                    placeholder="Internal context for this account."
                  />
                </div>
                <button
                  type="button"
                  onClick={() => saveDetailsMutation.mutate()}
                  disabled={saveDetailsMutation.isPending}
                  className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                >
                  {saveDetailsMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save Changes
                </button>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>

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
      {clientId ? (
        <ClientDetailPage
          clientId={clientId}
          onEditClient={client => setFormState(client)}
          onArchiveClient={client => setClientToArchive(client)}
        />
      ) : (
        <ClientsList onEditClient={client => setFormState(client)} />
      )}

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

import { type ReactNode, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  KeyRound,
  Link2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'

import { a2aApi, extractApiError } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState'
import { GlassCard } from '../components/ui/GlassCard'
import { SkeletonCard } from '../components/ui/Skeleton'
import { toast } from '../lib/toast'
import type { ExternalAgentRecord } from '../types'

function groupByTrust(agents: ExternalAgentRecord[]) {
  return {
    pending: agents.filter(agent => agent.trust_status === 'pending'),
    trusted: agents.filter(agent => agent.trust_status === 'trusted'),
    blocked: agents.filter(agent => agent.trust_status === 'blocked'),
  }
}

function roleTint(provider?: string | null) {
  const value = (provider || '').toLowerCase()
  if (value.includes('research')) return 'from-indigo-500/25 to-indigo-400/10 text-indigo-300'
  if (value.includes('support')) return 'from-violet-500/25 to-violet-400/10 text-violet-300'
  if (value.includes('data') || value.includes('analysis')) return 'from-emerald-500/25 to-emerald-400/10 text-emerald-300'
  return 'from-blue-600/20 to-blue-500/10 text-blue-300'
}

function currency(value: number) {
  return `$${value.toFixed(2)}`
}

function deriveSpendRows(agents: ExternalAgentRecord[]) {
  const now = Date.now()
  return agents.map(agent => {
    const daysLive = Math.max(
      1,
      Math.ceil((now - new Date(agent.added_at).getTime()) / 86_400_000),
    )
    const dailyUsed = agent.total_cost_usd / daysLive
    const dailyBudget = Math.max(dailyUsed * 1.5, 5)
    const monthlyBudget = Math.max(agent.total_cost_usd * 1.5, 50)
    const monthlyUsed = agent.total_cost_usd
    return {
      id: agent.id,
      agent: agent.name,
      category: agent.provider_name || 'External',
      dailyUsed,
      dailyBudget,
      monthlyUsed,
      monthlyBudget,
    }
  })
}

function AgentPreview({
  agent,
  action,
}: {
  agent: ExternalAgentRecord
  action?: ReactNode
}) {
  const skills = (agent.skills || [])
    .map(skill => String(skill.name || skill.id || '').trim())
    .filter(Boolean)
    .slice(0, 4)

  return (
    <GlassCard padding="lg" className="rounded-[24px] border-white/[0.08] bg-white/[0.03]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${roleTint(agent.provider_name)}`}>
            <span className="text-sm font-bold">{(agent.name || 'A').charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{agent.name}</div>
            <div className="text-xs text-[#8B9DBE]">{agent.provider_name || 'Unknown provider'}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {skills.length > 0 ? (
                skills.map(skill => (
                  <span key={skill} className="badge-glass">
                    {skill}
                  </span>
                ))
              ) : (
                <span className="text-xs text-[#8B9DBE]">No skills declared</span>
              )}
            </div>
          </div>
        </div>
        {action}
      </div>
    </GlassCard>
  )
}

function PendingCard({
  agent,
  working,
  onTrust,
  onBlock,
}: {
  agent: ExternalAgentRecord
  working: boolean
  onTrust: () => void
  onBlock: () => void
}) {
  return (
    <div className="card-amber rounded-[24px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.06] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${roleTint(agent.provider_name)}`}>
            <span className="text-sm font-bold">{(agent.name || 'A').charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{agent.name}</div>
            <div className="text-xs text-[#8B9DBE]">{agent.provider_name || 'Unknown provider'}</div>
            <p className="mt-2 text-sm text-[#C9D7EE]">{agent.description || 'No description provided.'}</p>
          </div>
        </div>

        <div className="badge-amber">pending</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onTrust}
          disabled={working}
          className="btn-emerald btn-sm"
        >
          {working ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
          Trust
        </button>
        <button
          type="button"
          onClick={onBlock}
          disabled={working}
          className="btn-danger btn-sm"
        >
          {working ? <Loader2 size={13} className="animate-spin" /> : <ShieldX size={13} />}
          Block
        </button>
      </div>
    </div>
  )
}

function TrustedCard({
  agent,
  working,
  onUntrust,
  onSetApiKey,
}: {
  agent: ExternalAgentRecord
  working: boolean
  onUntrust: () => void
  onSetApiKey: (apiKey: string) => void
}) {
  const [apiKey, setApiKey] = useState('')

  return (
    <GlassCard padding="lg" className="rounded-[24px] border-white/[0.08] bg-white/[0.03]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{agent.name}</div>
          <div className="mt-1 text-xs text-[#8B9DBE]">{agent.provider_name || 'Unknown provider'}</div>
        </div>
        <button type="button" onClick={onUntrust} disabled={working} className="btn-ghost btn-sm">
          {working ? <Loader2 size={13} className="animate-spin" /> : 'Untrust'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-[#4B5A73]">Calls</div>
          <div className="mt-2 font-mono text-sm text-white">{agent.total_calls}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-[#4B5A73]">Cost</div>
          <div className="mt-2 font-mono text-sm text-white">{currency(agent.total_cost_usd)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.20em] text-[#4B5A73]">
          <KeyRound size={12} />
          API Key
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder={agent.has_api_key ? 'Stored securely — paste new key to replace' : 'Paste API key'}
            className="input flex-1"
          />
          <button
            type="button"
            onClick={() => onSetApiKey(apiKey)}
            disabled={working || !apiKey.trim()}
            className="btn-secondary btn-sm"
          >
            {working ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}

export function ExternalAgents() {
  const queryClient = useQueryClient()
  const [discoverUrl, setDiscoverUrl] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [discoveredPreview, setDiscoveredPreview] = useState<ExternalAgentRecord | null>(null)

  const query = useQuery({
    queryKey: ['a2a', 'external-agents'],
    queryFn: a2aApi.listExternalAgents,
    refetchInterval: 15_000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['a2a', 'external-agents'] })

  const discoverMutation = useMutation({
    mutationFn: (url: string) => a2aApi.discoverExternalAgent(url),
    onSuccess: agent => {
      setDiscoveredPreview(agent)
      setDiscoverUrl('')
      void refresh()
      toast.success(`Discovered ${agent.name} — review and trust it before use`)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const trustMutation = useMutation({
    mutationFn: (id: string) => a2aApi.trustExternalAgent(id),
    onMutate: id => setPendingAction(id),
    onSettled: () => setPendingAction(null),
    onSuccess: () => {
      void refresh()
      toast.success('External agent trusted')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const blockMutation = useMutation({
    mutationFn: (id: string) => a2aApi.blockExternalAgent(id),
    onMutate: id => setPendingAction(id),
    onSettled: () => setPendingAction(null),
    onSuccess: () => {
      void refresh()
      toast.success('External agent blocked')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const untrustMutation = useMutation({
    mutationFn: (id: string) => a2aApi.untrustExternalAgent(id),
    onMutate: id => setPendingAction(id),
    onSettled: () => setPendingAction(null),
    onSuccess: () => {
      void refresh()
      toast.success('External agent moved back to pending review')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const apiKeyMutation = useMutation({
    mutationFn: ({ id, apiKey }: { id: string; apiKey: string }) => a2aApi.setExternalAgentApiKey(id, apiKey),
    onMutate: ({ id }) => setPendingAction(id),
    onSettled: () => setPendingAction(null),
    onSuccess: agent => {
      void refresh()
      toast.success(`Stored API key for ${agent.name}`)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const grouped = groupByTrust(query.data?.items || [])
  const spendRows = useMemo(() => deriveSpendRows(grouped.trusted), [grouped.trusted])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="page-title">External Agents</h1>
        <p className="page-sub">A2A-compatible agents you can call</p>
      </div>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="section-title">Discover</div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            value={discoverUrl}
            onChange={event => setDiscoverUrl(event.target.value)}
            placeholder="Agent Card URL"
            className="input flex-1"
          />
          <button
            type="button"
            onClick={() => discoverMutation.mutate(discoverUrl)}
            disabled={discoverMutation.isPending || !discoverUrl.trim()}
            className="btn-primary btn-runner"
          >
            {discoverMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            Discover
          </button>
        </div>

        {discoveredPreview && (
          <div className="mt-4">
            <AgentPreview
              agent={discoveredPreview}
              action={<span className="btn-secondary btn-sm">Added</span>}
            />
          </div>
        )}
      </GlassCard>

      {query.isLoading && (
        <div className="space-y-4">
          <SkeletonCard className="h-32 rounded-[28px]" />
          <SkeletonCard className="h-32 rounded-[28px]" />
        </div>
      )}

      {!query.isLoading && query.isError && (
        <GlassCard padding="none" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title="Could not load external agents"
            description="The registry is temporarily unavailable. Try again in a moment."
          />
        </GlassCard>
      )}

      {!query.isLoading && !query.isError && query.data && query.data.items.length === 0 && (
        <GlassCard padding="none" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
          <EmptyState
            icon={<Bot size={24} />}
            title="No external agents added yet"
            description="Discover your first Agent Card to start delegating work beyond your agency."
          />
        </GlassCard>
      )}

      {!query.isLoading && !query.isError && grouped.pending.length > 0 && (
        <section className="space-y-4">
          <div className="section-title">Pending Review</div>
          <div className="grid gap-4">
            {grouped.pending.map(agent => (
              <PendingCard
                key={agent.id}
                agent={agent}
                working={pendingAction === agent.id}
                onTrust={() => trustMutation.mutate(agent.id)}
                onBlock={() => blockMutation.mutate(agent.id)}
              />
            ))}
          </div>
        </section>
      )}

      {!query.isLoading && !query.isError && grouped.trusted.length > 0 && (
        <section className="space-y-4">
          <div className="section-title">Trusted</div>
          <div className="grid gap-4">
            {grouped.trusted.map(agent => (
              <TrustedCard
                key={agent.id}
                agent={agent}
                working={pendingAction === agent.id}
                onUntrust={() => untrustMutation.mutate(agent.id)}
                onSetApiKey={apiKey => apiKeyMutation.mutate({ id: agent.id, apiKey })}
              />
            ))}
          </div>
        </section>
      )}

      {!query.isLoading && !query.isError && grouped.blocked.length > 0 && (
        <section className="space-y-4">
          <div className="section-title">Blocked</div>
          <div className="grid gap-4">
            {grouped.blocked.map(agent => (
              <AgentPreview
                key={agent.id}
                agent={agent}
                action={
                  <button
                    type="button"
                    onClick={() => untrustMutation.mutate(agent.id)}
                    disabled={pendingAction === agent.id}
                    className="btn-ghost btn-sm"
                  >
                    {pendingAction === agent.id ? <Loader2 size={13} className="animate-spin" /> : 'Move to review'}
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="section-title mb-0 border-none pb-0">Spending Mandates</div>
          <button type="button" className="btn-secondary btn-sm">
            + Create Mandate
          </button>
        </div>

        {spendRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.10] px-4 py-8 text-center text-sm text-[#8B9DBE]">
            Trust an external agent to start tracking usage and spend.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
            {spendRows.map(row => {
              const dailyPct = Math.min(100, (row.dailyUsed / row.dailyBudget) * 100)
              const monthlyPct = Math.min(100, (row.monthlyUsed / row.monthlyBudget) * 100)

              return (
                <div key={row.id} className="row">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">{row.agent}</div>
                    <div className="text-xs text-[#8B9DBE]">{row.category}</div>
                  </div>

                  <div className="min-w-[180px]">
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                      <span className="text-[#8B9DBE]">daily</span>
                      <span className="font-mono text-[#C9D7EE]">
                        {currency(row.dailyUsed)} / {currency(row.dailyBudget)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-indigo-400" style={{ width: `${dailyPct}%` }} />
                    </div>
                  </div>

                  <div className="min-w-[180px]">
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                      <span className="text-[#8B9DBE]">monthly</span>
                      <span className="font-mono text-[#C9D7EE]">
                        {currency(row.monthlyUsed)} / {currency(row.monthlyBudget)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-indigo-400" style={{ width: `${monthlyPct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 text-xs text-[#8B9DBE]">
          <AlertCircle size={13} className="text-indigo-300" />
          Derived from trusted-agent usage and total cost until persisted mandates are added.
        </div>
      </GlassCard>
    </div>
  )
}

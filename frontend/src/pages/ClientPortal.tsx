import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, Clock3, Copy, ExternalLink, Globe2, Loader2, ShieldCheck, UserRound, XCircle } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { portalApi } from '../api/client'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton } from '../components/ui/Skeleton'
import { toast } from '../lib/toast'

type PortalStatus = 'completed' | 'running' | 'pending' | 'failed' | 'cancelled' | 'timed_out' | 'rejected'

interface PortalActivityItem {
  id: string
  status: PortalStatus
  agent_name: string | null
  agent_role: string | null
  input_preview: string
  started_at: string | null
  completed_at: string | null
  output_preview: string
}

interface PortalAgent {
  name: string
  persona_name: string | null
  role: string | null
  current_status: string
  tasks_completed: number
}

interface PortalPayload {
  client_name: string
  service_type: string | null
  agency_name: string
  portal_enabled: boolean
  color: string
  last_updated_at: string | null
  recent_activity: PortalActivityItem[]
  agents: PortalAgent[]
  stats: {
    executions_this_week: number
    completed_this_week: number
    agents_active: number
  }
}

function colorWithAlpha(hex: string | null | undefined, alpha = '22') {
  if (!hex) return '#2563EB22'
  return `${hex}${alpha}`
}

function relativeTime(value: string | null | undefined) {
  if (!value) return 'Unknown'
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true })
  } catch {
    return 'Unknown'
  }
}

function statusMeta(status: PortalStatus) {
  if (status === 'completed') {
    return {
      label: 'Completed',
      icon: CheckCircle2,
      dot: 'bg-emerald-400',
      badge: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    }
  }
  if (status === 'running' || status === 'pending') {
    return {
      label: 'In Progress',
      icon: Clock3,
      dot: 'bg-amber-400',
      badge: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
    }
  }
  return {
    label: 'Needs Attention',
    icon: XCircle,
    dot: 'bg-red-400',
    badge: 'border-red-400/25 bg-red-400/10 text-red-300',
  }
}

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-[#0B0F19] text-white">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-28 rounded-[28px]" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <GlassCard key={index} padding="lg" className="rounded-[24px] border-white/[0.08] bg-white/[0.03]">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-10 w-16" />
              <Skeleton className="mt-3 h-3 w-28" />
            </GlassCard>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <Skeleton className="h-64 rounded-[28px]" />
            <Skeleton className="h-80 rounded-[28px]" />
          </div>
          <Skeleton className="h-[520px] rounded-[28px]" />
        </div>
      </div>
    </div>
  )
}

function PortalError() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0B0F19] px-6 text-white">
      <div className="max-w-md rounded-[28px] border border-white/[0.08] bg-white/[0.03] p-8 text-center shadow-glow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-white/[0.08] bg-white/[0.04] text-white/70">
          <Globe2 size={28} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">This portal is not available.</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          The link may have expired or been disabled. Contact your agency.
        </p>
      </div>
    </div>
  )
}

function ActivityRow({
  item,
  expanded,
  onToggle,
  accent,
}: {
  item: PortalActivityItem
  expanded: boolean
  onToggle: () => void
  accent: string
}) {
  const meta = statusMeta(item.status)
  const Icon = meta.icon

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full cursor-pointer rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">
                {(item.agent_name || 'Your AI team')} {item.status === 'completed' ? 'finished' : item.status === 'running' || item.status === 'pending' ? 'is working on' : 'attempted'}:{' '}
                <span className="text-white/72">"{item.input_preview}"</span>
              </div>
              {item.agent_role && <div className="mt-1 text-xs text-white/35">{item.agent_role}</div>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">{relativeTime(item.completed_at || item.started_at)}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${meta.badge}`}>
                <Icon size={12} />
                {meta.label}
              </span>
            </div>
          </div>

          {expanded && item.output_preview && (
            <div
              className="mt-4 rounded-2xl border border-white/[0.08] p-4 text-sm leading-6 text-white/72"
              style={{ backgroundColor: colorWithAlpha(accent, '10') }}
            >
              {item.output_preview}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

export function ClientPortal() {
  const { token } = useParams<{ token: string }>()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal', token],
    queryFn: () => portalApi.get(token as string) as Promise<PortalPayload>,
    retry: false,
    staleTime: 60_000,
    enabled: Boolean(token),
  })

  const lastUpdated = useMemo(
    () => relativeTime(data?.last_updated_at || null),
    [data?.last_updated_at],
  )

  if (isLoading) return <PortalSkeleton />
  if (isError || !data) return <PortalError />

  const accent = data.color || '#2563EB'

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Portal link copied')
    } catch {
      toast.error('Could not copy portal link')
    }
  }

  return (
    <div className="min-h-screen bg-[#0B0F19] text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-[30px] border border-white/[0.08] bg-white/[0.03] shadow-glow-sm">
          <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium text-white/75">{data.agency_name}</div>
            <span
              className="inline-flex w-fit items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/35"
            >
              Powered by Aethon
              <ExternalLink size={12} />
            </span>
          </div>
          <div className="h-1 w-full" style={{ backgroundColor: accent }} />
          <div className="px-6 py-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/50">
              <ShieldCheck size={13} />
              Agency Update
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              {data.client_name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/45">
              {data.service_type && <span>{data.service_type}</span>}
              {data.service_type && <span className="h-1 w-1 rounded-full bg-white/20" />}
              <span>Last updated {lastUpdated}</span>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              label: 'Tasks This Week',
              value: data.stats.executions_this_week,
              icon: Clock3,
            },
            {
              label: 'Completed',
              value: data.stats.completed_this_week,
              icon: CheckCircle2,
            },
            {
              label: 'Agents Working For You',
              value: data.stats.agents_active,
              icon: UserRound,
            },
          ].map(item => {
            const Icon = item.icon
            return (
              <GlassCard key={item.label} padding="lg" className="rounded-[24px] border-white/[0.08] bg-white/[0.03]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-white/35">{item.label}</div>
                    <div className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white">{item.value}</div>
                  </div>
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08]"
                    style={{ backgroundColor: colorWithAlpha(accent, '14') }}
                  >
                    <Icon size={18} style={{ color: accent }} />
                  </div>
                </div>
              </GlassCard>
            )
          })}
        </section>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Your AI Team</h2>
                  <p className="mt-2 text-sm text-white/45">The specialists currently working on your account.</p>
                </div>
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/70 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                >
                  <Copy size={14} />
                  Copy Link
                </button>
              </div>

              {data.agents.length ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {data.agents.map(agent => {
                    const working = agent.current_status === 'working'
                    return (
                      <div key={`${agent.name}-${agent.role}`} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] text-sm font-semibold text-white"
                            style={{ backgroundColor: colorWithAlpha(accent, '16') }}
                          >
                            {(agent.persona_name || agent.name || 'A').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-white">{agent.persona_name || agent.name}</div>
                            <div className="mt-1 truncate text-xs text-white/40">{agent.role || 'AI Specialist'}</div>
                            <div className="mt-3 flex items-center justify-between">
                              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${working ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/[0.08] bg-white/[0.04] text-white/55'}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${working ? 'bg-emerald-400' : 'bg-white/30'}`} />
                                {working ? 'Working' : 'Idle'}
                              </span>
                              <span className="text-xs text-white/35">Tasks completed: {agent.tasks_completed}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-white/45">
                  Your agency is setting up your AI team.
                </div>
              )}
            </GlassCard>

            <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-white">Recent Activity</h2>
                <p className="mt-2 text-sm text-white/45">The latest work completed by your AI team.</p>
              </div>

              {data.recent_activity.length ? (
                <div className="mt-5 space-y-3">
                  {data.recent_activity.map(item => (
                    <ActivityRow
                      key={item.id}
                      item={item}
                      expanded={expandedId === item.id}
                      onToggle={() => setExpandedId(current => current === item.id ? null : item.id)}
                      accent={accent}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-white/45">
                  No recent activity. Work will appear here once started.
                </div>
              )}
            </GlassCard>
          </div>

          <GlassCard padding="lg" className="h-fit rounded-[28px] border-white/[0.08] bg-white/[0.03]">
            <div className="flex items-center gap-2 text-white/75">
              <ShieldCheck size={16} style={{ color: accent }} />
              <span className="text-xs uppercase tracking-[0.18em]">Transparency Report</span>
            </div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white">What you’re seeing</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">
              This portal updates automatically as your agency’s AI team completes work for your account. You can use it as a lightweight project snapshot without needing to log in.
            </p>

            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/35">Coverage</div>
              <div className="mt-3 space-y-3 text-sm text-white/60">
                <div className="flex items-center justify-between">
                  <span>Recent tasks shown</span>
                  <span className="font-medium text-white">10 latest</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Status refresh cadence</span>
                  <span className="font-medium text-white">Automatic</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Portal access</span>
                  <span className="font-medium text-white">Read only</span>
                </div>
              </div>
            </div>

            <footer className="mt-8 border-t border-white/[0.08] pt-5 text-sm text-white/40">
              <p>This report is automatically updated by your AI team.</p>
              <p className="mt-2">Questions? Contact {data.agency_name}.</p>
              <span
                className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/30"
              >
                Powered by Aethon
                <ExternalLink size={12} />
              </span>
            </footer>
          </GlassCard>
        </div>
      </div>
    </div>
  )
}

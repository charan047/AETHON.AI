import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, Copy, ExternalLink, Globe2, Loader2, ShieldCheck, UserRound, XCircle, Zap } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { portalApi } from '../api/client'
import { ReportMarkdown } from '../components/mission/ReportMarkdown'
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
  recent_missions: Array<{
    title: string
    completed_at: string | null
    report_preview: string | null
    full_report_available: boolean
    report?: string | null
  }>
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
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827]">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-28 rounded-[28px]" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-[24px] border border-[#E4E7EB] bg-white p-6 shadow-sm">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-10 w-16" />
              <Skeleton className="mt-3 h-3 w-28" />
            </div>
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
    <div className="grid min-h-screen place-items-center bg-[#FAFAFA] px-6 text-[#111827]">
      <div className="max-w-md rounded-[28px] border border-[#E4E7EB] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-[#E4E7EB] bg-[#F4F6F8] text-[#6B7280]">
          <Globe2 size={28} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[#111827]">This portal is not available.</h1>
        <p className="mt-3 text-sm leading-6 text-[#6B7280]">
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
      className="w-full cursor-pointer rounded-2xl border border-[#E4E7EB] bg-white p-4 text-left shadow-sm transition-all duration-200 hover:border-[#CBD5E1] hover:bg-[#FCFCFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#111827]">
                {(item.agent_name || 'Your AI team')} {item.status === 'completed' ? 'finished' : item.status === 'running' || item.status === 'pending' ? 'is working on' : 'attempted'}:{' '}
                <span className="text-[#4B5563]">"{item.input_preview}"</span>
              </div>
              {item.agent_role && <div className="mt-1 text-xs text-[#6B7280]">{item.agent_role}</div>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6B7280]">{relativeTime(item.completed_at || item.started_at)}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${meta.badge}`}>
                <Icon size={12} />
                {meta.label}
              </span>
            </div>
          </div>

          {expanded && item.output_preview && (
            <div
              className="mt-4 rounded-2xl border border-[#E4E7EB] p-4 text-sm leading-6 text-[#374151]"
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
  const [expandedReport, setExpandedReport] = useState<string | null>(null)

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
    <div
      className="min-h-screen text-[#111827]"
      style={{
        backgroundColor: '#FAFAFA',
        backgroundImage: 'radial-gradient(circle, rgba(17,24,39,0.06) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-[30px] border border-[#E4E7EB] bg-white shadow-sm">
          <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                <Zap size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#111827]">{data.agency_name}</div>
                <div className="text-xs text-[#6B7280]">Powered by Aethon</div>
              </div>
            </div>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-[#E4E7EB] bg-white px-3 py-2 text-sm text-[#4B5563] transition-colors duration-200 hover:bg-[#F9FAFB] hover:text-[#111827]"
            >
              <Copy size={14} />
              Copy link
            </button>
          </div>
          <div className="h-1 w-full" style={{ backgroundColor: accent }} />
          <div className="px-6 py-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#E4E7EB] bg-[#F8FAFC] px-3 py-1 text-xs font-medium text-[#6B7280]">
              <ShieldCheck size={13} />
              Agency Update
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#111827] sm:text-4xl">
              {data.client_name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#6B7280]">
              {data.service_type && <span>{data.service_type}</span>}
              {data.service_type && <span className="h-1 w-1 rounded-full bg-[#CBD5E1]" />}
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
              <div key={item.label} className="rounded-[24px] border border-[#E4E7EB] bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[#6B7280]">{item.label}</div>
                    <div className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#111827]">{item.value}</div>
                  </div>
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E4E7EB]"
                    style={{ backgroundColor: colorWithAlpha(accent, '14') }}
                  >
                    <Icon size={18} style={{ color: accent }} />
                  </div>
                </div>
              </div>
            )
          })}
        </section>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-[#E4E7EB] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">Completed work</h2>
                  <p className="mt-2 text-sm text-[#6B7280]">The latest client-facing output completed for your account.</p>
                </div>
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
                <div className="mt-5 rounded-2xl border border-dashed border-[#E4E7EB] bg-[#FAFAFA] p-5 text-sm text-[#6B7280]">
                  No completed work yet. Updates will appear here automatically.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-[#E4E7EB] bg-white p-6 shadow-sm">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">Recent missions</h2>
                <p className="mt-2 text-sm text-[#6B7280]">Mission summaries and reports delivered to this account.</p>
              </div>

              {data.recent_missions.length ? (
                <div className="mt-5 space-y-3">
                  {data.recent_missions.map(report => {
                    const key = `${report.title}-${report.completed_at || 'pending'}`
                    const open = expandedReport === key
                    return (
                      <div key={key} className="rounded-2xl border border-[#E4E7EB] bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#111827]">{report.title}</div>
                            <div className="mt-1 text-xs text-[#6B7280]">
                              {report.completed_at ? `Completed ${relativeTime(report.completed_at)}` : 'In progress'}
                            </div>
                            {report.report_preview && !open && (
                              <div className="mt-3 text-sm leading-6 text-[#4B5563]">{report.report_preview}</div>
                            )}
                          </div>
                          {report.full_report_available && (
                            <button
                              type="button"
                              onClick={() => setExpandedReport(current => current === key ? null : key)}
                              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#E4E7EB] bg-white px-3 py-2 text-xs font-medium text-[#4B5563] transition hover:bg-[#F9FAFB] hover:text-[#111827]"
                            >
                              {open ? 'Hide Report' : 'Read Report'}
                              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          )}
                        </div>

                        {open && report.report && (
                          <div className="mt-4 rounded-2xl border border-[#E4E7EB] bg-[#FAFAFA] p-4">
                            <ReportMarkdown content={report.report} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-[#E4E7EB] bg-[#FAFAFA] p-5 text-sm text-[#6B7280]">
                  No mission reports yet.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-[#E4E7EB] bg-white p-6 shadow-sm">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">Agent activity</h2>
                <p className="mt-2 text-sm text-[#6B7280]">A simple timeline of which specialists are active on this account.</p>
              </div>
              <div className="mt-5 space-y-3">
                {data.agents.length ? data.agents.map(agent => {
                  const working = agent.current_status === 'working'
                  return (
                    <div key={`${agent.name}-${agent.role}`} className="flex items-start gap-3 rounded-2xl border border-[#E4E7EB] bg-white p-4 shadow-sm">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#E4E7EB] text-sm font-semibold text-[#111827]"
                        style={{ backgroundColor: colorWithAlpha(accent, '16') }}
                      >
                        {(agent.persona_name || agent.name || 'A').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[#111827]">{agent.persona_name || agent.name}</div>
                        <div className="mt-1 truncate text-xs text-[#6B7280]">{agent.role || 'AI Specialist'}</div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${working ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-600' : 'border-[#E4E7EB] bg-[#F8FAFC] text-[#6B7280]'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${working ? 'bg-emerald-500' : 'bg-[#CBD5E1]'}`} />
                            {working ? 'Working' : 'Idle'}
                          </span>
                          <span className="text-xs text-[#6B7280]">Tasks completed: {agent.tasks_completed}</span>
                        </div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="rounded-2xl border border-dashed border-[#E4E7EB] bg-[#FAFAFA] p-5 text-sm text-[#6B7280]">
                    Your agency is setting up your AI team.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="h-fit rounded-[28px] border border-[#E4E7EB] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-[#374151]">
              <ShieldCheck size={16} style={{ color: accent }} />
              <span className="text-xs uppercase tracking-[0.18em]">Transparency Report</span>
            </div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#111827]">What you’re seeing</h2>
            <p className="mt-3 text-sm leading-6 text-[#6B7280]">
              This portal updates automatically as your agency’s AI team completes work for your account. You can use it as a lightweight project snapshot without needing to log in.
            </p>

            <div className="mt-6 rounded-2xl border border-[#E4E7EB] bg-[#FAFAFA] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[#6B7280]">Coverage</div>
              <div className="mt-3 space-y-3 text-sm text-[#4B5563]">
                <div className="flex items-center justify-between">
                  <span>Recent tasks shown</span>
                  <span className="font-medium text-[#111827]">10 latest</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Status refresh cadence</span>
                  <span className="font-medium text-[#111827]">Automatic</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Portal access</span>
                  <span className="font-medium text-[#111827]">Read only</span>
                </div>
              </div>
            </div>

            <footer className="mt-8 border-t border-[#E4E7EB] pt-5 text-sm text-[#6B7280]">
              <p>This report is automatically updated by your AI team.</p>
              <p className="mt-2">Questions? Contact {data.agency_name}.</p>
              <span className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#9CA3AF]">
                Powered by Aethon
                <ExternalLink size={12} />
              </span>
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}

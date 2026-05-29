import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Globe2,
  Loader2,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react'
import { useParams } from 'react-router-dom'

import { portalApi } from '../api/client'
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

interface PortalDeliverable {
  id: string
  name: string
  description?: string | null
  file_type: string
  size_bytes: number
  content_type?: string | null
  created_at: string | null
  updated_at: string | null
  download_url: string | null
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
  files: PortalDeliverable[]
  deliverables: PortalDeliverable[]
  deliverable_count: number
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

function formatPortalDate(value: string | null | undefined) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

function formatBytes(bytes?: number | null) {
  const value = Number(bytes || 0)
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function statusMeta(status: PortalStatus) {
  if (status === 'completed') {
    return {
      label: 'Completed',
      dot: 'bg-emerald-500',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    }
  }
  if (status === 'running' || status === 'pending') {
    return {
      label: 'In Progress',
      dot: 'bg-amber-500',
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
    }
  }
  return {
    label: 'Needs Attention',
    dot: 'bg-red-500',
    badge: 'border-red-200 bg-red-50 text-red-700',
  }
}

function portalFileMeta(fileType: string) {
  if (fileType === 'document') {
    return { icon: FileText, tone: 'bg-blue-50 text-blue-600' }
  }
  if (fileType === 'pdf') {
    return { icon: FileCode2, tone: 'bg-red-50 text-red-600' }
  }
  if (fileType === 'markdown') {
    return { icon: FileSpreadsheet, tone: 'bg-purple-50 text-purple-600' }
  }
  if (fileType === 'docx') {
    return { icon: FileText, tone: 'bg-blue-50 text-blue-600' }
  }
  if (fileType === 'image') {
    return { icon: FileImage, tone: 'bg-green-50 text-green-600' }
  }
  return { icon: FileText, tone: 'bg-gray-50 text-gray-600' }
}

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827]">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-28 rounded-[28px]" />
        <Skeleton className="h-52 rounded-[28px]" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
          <Skeleton className="h-[420px] rounded-[28px]" />
          <Skeleton className="h-[360px] rounded-[28px]" />
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
}: {
  item: PortalActivityItem
}) {
  const meta = statusMeta(item.status)

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#111827]">
                {item.agent_name || 'Your AI team'}
              </div>
              {item.agent_role ? (
                <div className="mt-1 text-xs text-[#6B7280]">{item.agent_role}</div>
              ) : null}
            </div>
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${meta.badge}`}>
              {meta.label}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#374151]">
            <span className="font-medium text-[#111827]">Task:</span> {item.input_preview || 'Work in progress'}
          </p>
          {item.output_preview ? (
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">
              {item.output_preview}
            </p>
          ) : null}
          <div className="mt-3 text-xs text-[#9CA3AF]">
            {relativeTime(item.completed_at || item.started_at)}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ClientPortal() {
  const { token } = useParams<{ token: string }>()

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
  const deliverables = data.deliverables?.length ? data.deliverables : data.files || []

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
        backgroundImage: 'radial-gradient(circle, rgba(17,24,39,0.05) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-[30px] border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
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
              className="inline-flex w-fit items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#4B5563] transition-colors duration-200 hover:bg-[#F9FAFB] hover:text-[#111827]"
            >
              <Copy size={14} />
              Copy link
            </button>
          </div>

          <div className="h-1 w-full" style={{ backgroundColor: accent }} />

          <div className="px-6 py-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1 text-xs font-medium text-[#6B7280]">
              <ShieldCheck size={13} />
              Client workspace
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#111827] sm:text-4xl">
              {data.client_name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#6B7280]">
              {data.service_type ? <span>{data.service_type}</span> : null}
              {data.service_type ? <span className="h-1 w-1 rounded-full bg-[#CBD5E1]" /> : null}
              <span>Last updated {lastUpdated}</span>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">Your Deliverables</h2>
              <p className="mt-2 text-sm text-[#6B7280]">
                {deliverables.length
                  ? `${data.deliverable_count || deliverables.length} file${(data.deliverable_count || deliverables.length) === 1 ? '' : 's'} ready to download`
                  : 'Your deliverables will appear here as your agency completes work for you.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-[#6B7280]">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1.5">
                <Download size={14} />
                Presigned access
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1.5">
                <CheckCircle2 size={14} />
                Client-ready files
              </span>
            </div>
          </div>

          {deliverables.length ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {deliverables.map(file => {
                const meta = portalFileMeta(file.file_type)
                const Icon = meta.icon
                return (
                  <div
                    key={file.id}
                    className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.tone}`}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-gray-900">{file.name}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {formatPortalDate(file.created_at || file.updated_at)}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 uppercase">
                            {file.file_type}
                          </span>
                          <span className="font-mono">{formatBytes(file.size_bytes)}</span>
                        </div>
                      </div>
                    </div>

                    {file.download_url ? (
                      <a
                        href={file.download_url}
                        download={file.name}
                        className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                      >
                        <Download size={14} />
                        Download
                      </a>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-2 text-center text-sm text-gray-500">
                        Download link is being prepared.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-6 text-sm leading-6 text-[#6B7280]">
              Your deliverables will appear here as your agency completes work for you.
            </div>
          )}
        </section>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <section className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">Recent Work</h2>
                <p className="mt-2 text-sm text-[#6B7280]">
                  A lighter activity feed showing the latest work completed for your account.
                </p>
              </div>
              <div className="rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1 text-xs text-[#6B7280]">
                {data.recent_activity.length} items
              </div>
            </div>

            {data.recent_activity.length ? (
              <div className="mt-5 space-y-3">
                {data.recent_activity.map(item => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-5 text-sm text-[#6B7280]">
                No completed work yet. Updates will appear here automatically.
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">Team</h2>
                <p className="mt-2 text-sm text-[#6B7280]">
                  The specialists who have worked on this account.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {data.agents.length ? data.agents.map(agent => {
                  const working = agent.current_status === 'working'
                  return (
                    <div key={`${agent.name}-${agent.role}`} className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#E5E7EB] text-sm font-semibold text-[#111827]"
                          style={{ backgroundColor: colorWithAlpha(accent, '16') }}
                        >
                          {(agent.persona_name || agent.name || 'A').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-[#111827]">{agent.persona_name || agent.name}</div>
                          <div className="mt-1 truncate text-xs text-[#6B7280]">{agent.role || 'AI Specialist'}</div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${working ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#E5E7EB] bg-[#F8FAFC] text-[#6B7280]'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${working ? 'bg-emerald-500' : 'bg-[#CBD5E1]'}`} />
                              {working ? 'Working' : 'Idle'}
                            </span>
                            <span className="text-xs text-[#6B7280]">Tasks completed: {agent.tasks_completed}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-5 text-sm text-[#6B7280]">
                    Your agency is setting up your AI team.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-[#374151]">
                <ShieldCheck size={16} style={{ color: accent }} />
                <span className="text-xs uppercase tracking-[0.18em]">Workspace Snapshot</span>
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#111827]">What you’re seeing</h2>
              <p className="mt-3 text-sm leading-6 text-[#6B7280]">
                This portal updates automatically as your agency’s AI team finishes work for your account. Deliverables are placed at the top so you can download what matters first.
              </p>

              <div className="mt-6 rounded-2xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[#6B7280]">Coverage</div>
                <div className="mt-3 space-y-3 text-sm text-[#4B5563]">
                  <div className="flex items-center justify-between">
                    <span>Files available</span>
                    <span className="font-medium text-[#111827]">{data.deliverable_count || deliverables.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Recent work shown</span>
                    <span className="font-medium text-[#111827]">{data.recent_activity.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Portal access</span>
                    <span className="font-medium text-[#111827]">Read only</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {[
                  {
                    label: 'Tasks This Week',
                    value: data.stats.executions_this_week,
                    icon: Loader2,
                  },
                  {
                    label: 'Completed',
                    value: data.stats.completed_this_week,
                    icon: CheckCircle2,
                  },
                  {
                    label: 'Agents Working',
                    value: data.stats.agents_active,
                    icon: UserRound,
                  },
                ].map(item => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="rounded-2xl border border-[#E5E7EB] bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#6B7280]">{item.label}</div>
                          <div className="mt-2 text-2xl font-semibold tracking-tight text-[#111827]">{item.value}</div>
                        </div>
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#E5E7EB]"
                          style={{ backgroundColor: colorWithAlpha(accent, '14') }}
                        >
                          <Icon size={16} style={{ color: accent }} className={item.label === 'Tasks This Week' ? '' : ''} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}

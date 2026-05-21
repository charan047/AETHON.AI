import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileText, FileUp, Loader2 } from 'lucide-react'

import { missionsApi } from '../api/client'
import { GlassCard } from '../components/ui/GlassCard'
import { MarkdownContent } from '../components/ui/MarkdownContent'
import { Skeleton } from '../components/ui/Skeleton'
import { extractApiError } from '../api/client'
import { toast } from '../lib/toast'

function formatDateTime(value?: string | null) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

function formatDuration(startedAt?: string | null, completedAt?: string | null) {
  if (!startedAt) return 'Unknown'
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const minutes = Math.max(1, Math.round((end - start) / 60000))
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

export function MissionReport() {
  const { id } = useParams<{ id: string }>()
  const [timelineOpen, setTimelineOpen] = useState(true)
  const queryClient = useQueryClient()

  const missionQuery = useQuery({
    queryKey: ['mission', id],
    queryFn: () => missionsApi.get(id as string),
    enabled: Boolean(id),
    refetchInterval: query =>
      query.state.data?.status === 'active' || query.state.data?.status === 'planning'
        ? 5_000
        : false,
  })
  const reportQuery = useQuery({
    queryKey: ['mission-report', id],
    queryFn: () => missionsApi.getReport(id as string),
    enabled: Boolean(id),
  })

  const reportContent = reportQuery.data?.report || missionQuery.data?.report || ''
  const approveReportMutation = useMutation({
    mutationFn: () => missionsApi.approveReport(id as string),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mission', id] }),
        queryClient.invalidateQueries({ queryKey: ['mission-report', id] }),
      ])
      toast.success('Mission report approved for the client portal')
    },
    onError: error => {
      toast.error(extractApiError(error))
    },
  })
  const sectionCount = useMemo(
    () => reportContent.split('\n').filter(line => line.trim().startsWith('## ')).length,
    [reportContent],
  )

  if (missionQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-24 rounded-[28px]" />
        <Skeleton className="h-[480px] rounded-[28px]" />
      </div>
    )
  }

  if (missionQuery.isError || !missionQuery.data) {
    return (
      <div className="p-6">
        <GlassCard padding="lg" className="rounded-[28px] border-red-400/20 bg-red-500/10">
          <div className="text-red-100">
            <div className="text-lg font-semibold">Could not load mission report</div>
            <div className="mt-2 text-sm text-red-100/80">
              {extractApiError(missionQuery.error)}
            </div>
          </div>
        </GlassCard>
      </div>
    )
  }

  const mission = missionQuery.data
  const canApproveForPortal = Boolean(
    mission.client_id &&
      reportContent &&
      mission.status === 'completed' &&
      !mission.report_delivered,
  )

  const exportWord = () => {
    const blob = new Blob(
      [
        `<html><head><meta charset="utf-8"><title>${mission.title || mission.goal}</title></head><body>${reportContent.replace(/\n/g, '<br/>')}</body></html>`,
      ],
      { type: 'application/msword' },
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(mission.title || 'mission-report').replace(/\s+/g, '-').toLowerCase()}.doc`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = () => {
    window.print()
  }

  return (
    <div className="space-y-6 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4B5A73]">Mission Report</div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
              {mission.title || mission.goal}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-sm text-[#8B9DBE]">
              <span>{formatDateTime(mission.completed_at)}</span>
              <span className="h-1 w-1 rounded-full bg-[#2D3748]" />
              <span>{formatDuration(mission.created_at, mission.completed_at)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {mission.client_name && (
              <span className="badge badge-glass">{mission.client_name}</span>
            )}
            <button
              type="button"
              onClick={exportPdf}
              className="btn-secondary btn-sm"
            >
              <FileText size={13} />
              Export PDF
            </button>
            <button
              type="button"
              onClick={exportWord}
              className="btn-secondary btn-sm"
            >
              <FileUp size={13} />
              Export Word
            </button>
          </div>
        </div>

        {!mission.report_delivered ? (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Approval required before this report appears in the client portal.</div>
              <div className="mt-1 text-amber-100/75">
                {mission.client_id
                  ? 'Review the report, then approve it for portal delivery.'
                  : 'Attach this mission to a client before it can be approved for portal delivery.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => approveReportMutation.mutate()}
              disabled={!canApproveForPortal || approveReportMutation.isPending}
              className="btn-amber btn-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approveReportMutation.isPending ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} />
                  Approve for Client Portal
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-100">
            Approved for the client portal. The client can now see this mission report.
          </div>
        )}
      </GlassCard>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4B5A73]">Client-ready report</div>
              <div className="mt-2 text-sm text-[#8B9DBE]">
                {sectionCount > 0 ? `${sectionCount} sections detected` : 'Report content'}
              </div>
            </div>
          </div>

          {reportQuery.isLoading && !reportContent ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : reportContent ? (
            <div className="space-y-5">
              <MarkdownContent content={reportContent} className="text-[15px] leading-7" />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-[#8B9DBE]">
              This mission is still running. The final report will appear here once all tasks complete.
            </div>
          )}
      </GlassCard>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setTimelineOpen(value => !value)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4B5A73]">TASK BREAKDOWN</div>
                <div className="mt-2 text-sm text-[#8B9DBE]">Each mission step, its timing, and execution trail.</div>
              </div>
              {timelineOpen ? <ChevronDown size={16} className="text-[#8B9DBE]" /> : <ChevronRight size={16} className="text-[#8B9DBE]" />}
            </button>

            {timelineOpen && (
              <div className="mt-5 space-y-3">
                {mission.tasks.map(task => (
                  <div key={task.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{task.title}</div>
                        <div className="mt-1 text-xs text-[#8B9DBE]">
                          {formatDateTime(task.started_at)} → {formatDateTime(task.completed_at)}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-[#8B9DBE]">
                        {task.status}
                      </div>
                    </div>

                    {task.output_summary && (
                      <div className="mt-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
                        <MarkdownContent content={task.output_summary} className="text-sm" />
                      </div>
                    )}

                    {task.execution_id && (
                      <Link
                        to={`/executions/${task.execution_id}`}
                        className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-blue-300 transition hover:text-blue-200"
                      >
                        View execution
                        <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
      </GlassCard>
      </div>
    </div>
  )
}

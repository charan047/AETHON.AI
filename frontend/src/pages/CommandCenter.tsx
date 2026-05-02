import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  GitPullRequest,
  Mail,
  Plus,
  Radio,
  TrendingUp,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useDashboard } from '../hooks/useDashboard'
import { approvalsApi } from '../api/client'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { LiveActivityFeed } from '../components/dashboard/LiveActivityFeed'
import { BusinessContextWidget } from '../components/dashboard/BusinessContextWidget'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import type { DashboardSummary } from '../types'
import { toast } from '../lib/toast'

function money(value = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function runwayTone(months: number | null | undefined) {
  if (months == null) return 'text-obsidian-400'
  if (months > 18) return 'text-emerald-300'
  if (months >= 6) return 'text-amber-300'
  return 'text-red-300'
}

function artifactIcon(type: string) {
  if (type.includes('github') || type.includes('pr')) return GitPullRequest
  if (type.includes('email')) return Mail
  return FileText
}

function statusCopy(agent: DashboardSummary['team_status'][number]) {
  if (agent.status === 'working') return agent.current_task || 'Running workflow...'
  if (agent.status === 'waiting_approval') return agent.current_task || 'Awaiting approval'
  if (agent.last_active) return `Last active ${formatDistanceToNow(new Date(agent.last_active), { addSuffix: true })}`
  return 'Ready for work'
}

export function CommandCenter() {
  const queryClient = useQueryClient()
  const { summary, loading } = useDashboard()
  const [dismissedAttention, setDismissedAttention] = useState<Set<string>>(new Set())

  if (loading || !summary) {
    return (
      <div className="flex h-full min-h-screen flex-col overflow-hidden bg-obsidian-950 p-5">
        <div className="mb-5 flex h-16 items-center justify-between rounded-2xl border border-white/[0.08] bg-obsidian-925 px-5">
          <Skeleton className="h-8 w-72" />
          <div className="hidden gap-4 md:flex">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_300px]">
          <div className="hidden space-y-3 lg:block">
            <SkeletonCard className="h-40" />
            <SkeletonCard className="h-40" />
          </div>
          <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-obsidian-925 p-4">
            {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
          <div className="hidden space-y-3 lg:block">
            <SkeletonCard className="h-64" />
            <SkeletonCard className="h-44" />
          </div>
        </div>
      </div>
    )
  }

  const profile = summary.company_profile
  const activeCount = summary.team_status.filter(agent => agent.status === 'working' || agent.status === 'waiting_approval').length
  const visibleAttention = summary.pending_attention.filter((item, index) => {
    const key = item.id || `${item.type}-${item.title}-${index}`
    return !dismissedAttention.has(key)
  })
  const dismissAttention = (item: DashboardSummary['pending_attention'][number], index: number, verb = 'Dismissed') => {
    const key = item.id || `${item.type}-${item.title}-${index}`
    setDismissedAttention(current => new Set(current).add(key))
    toast.success(verb)
  }
  const decideApproval = async (id: string | undefined, decision: 'approve' | 'reject') => {
    if (!id) return
    try {
      if (decision === 'approve') await approvalsApi.approve(id)
      else await approvalsApi.reject(id)
      toast.success(decision === 'approve' ? 'Approved' : 'Rejected')
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Decision failed')
    }
  }

  return (
    <div className="flex h-full min-h-screen flex-col overflow-hidden bg-obsidian-950 text-slate-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] bg-obsidian-925 px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.05em] text-white">{profile.name}</h1>
            {profile.industry && <span className="badge-blue hidden sm:inline-flex">{profile.industry}</span>}
            {profile.stage && <span className="badge-purple hidden sm:inline-flex">{profile.stage}</span>}
          </div>
        </div>

        <div className="hidden items-center gap-7 md:flex">
          <div>
            <div className="flex items-center gap-1.5 text-lg font-semibold text-emerald-300">
              {money(profile.monthly_revenue)} <TrendingUp size={14} />
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-obsidian-500">MRR</div>
          </div>
          <div>
            <div className={clsx('text-lg font-semibold', runwayTone(profile.runway_months))}>
              {profile.runway_months == null ? '--' : `${profile.runway_months} mo`}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-obsidian-500">Runway</div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-white">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.7)]" />
              {activeCount}/{summary.team_status.length} agents active
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-obsidian-500">Team Active</div>
          </div>
        </div>

        <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 shadow-glow-sm">
          <span className="font-semibold">This Week</span>
          <span className="ml-2 text-obsidian-400">
            {summary.this_week.tasks_completed} tasks · {summary.this_week.success_rate}% success
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_1fr_300px]">
        <aside className="hidden min-h-0 flex-col border-r border-white/[0.08] bg-obsidian-925 lg:flex">
          <div className="flex h-14 items-center justify-between border-b border-white/[0.08] px-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Your Team</h2>
              <p className="text-xs text-obsidian-500">Live operator roster</p>
            </div>
            <Radio size={16} className="text-cyan-300" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {summary.team_status.map(agent => (
                <Link key={agent.agent_id} to="/agents" className="block rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 transition hover:border-white/[0.12] hover:bg-white/[0.045]">
                  <div className="flex gap-3">
                    <AgentAvatar name={agent.name} size="md" running={agent.status === 'working'} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{agent.name}</div>
                      <div className="truncate text-xs text-obsidian-500">{agent.role}</div>
                      <div className="mt-2 flex items-start gap-2 text-xs">
                        <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', agent.status === 'working' ? 'animate-pulse bg-accent-400' : agent.status === 'waiting_approval' ? 'bg-amber-400' : 'bg-obsidian-600')} />
                        <span className={clsx(agent.status === 'working' ? 'text-accent-200' : agent.status === 'waiting_approval' ? 'text-amber-200' : 'text-obsidian-500')}>
                          {agent.status === 'working' ? 'Running' : agent.status === 'waiting_approval' ? 'Waiting' : 'Idle'} · {statusCopy(agent)}
                        </span>
                      </div>
                    </div>
                    {agent.approval_rate != null && (
                      <span className="h-fit rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                        {Math.round(agent.approval_rate * 100)}%
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
          <div className="border-t border-white/[0.08] p-3">
            <Link to="/agents" className="btn-secondary w-full text-xs"><Plus size={14} /> Add team member</Link>
          </div>
        </aside>

        <LiveActivityFeed />

        <aside className="hidden min-h-0 flex-col overflow-y-auto bg-obsidian-925 lg:flex">
          <div className="border-b border-white/[0.08] p-3">
            <BusinessContextWidget />
          </div>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Needs Attention</h2>
              <p className="text-xs text-obsidian-500">Human input queue</p>
            </div>
            <AlertTriangle size={16} className={visibleAttention.length ? 'text-amber-300' : 'text-emerald-300'} />
          </div>
          <div className="p-3">
            {!visibleAttention.length ? (
              <div className="grid min-h-64 place-items-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <CheckCircle2 size={25} />
                  </div>
                  <p className="text-sm font-medium text-white">You're all caught up</p>
                  <p className="mt-1 text-xs text-obsidian-500">No approvals or alerts waiting.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleAttention.map((item, index) => (
                  <div key={`${item.title}-${index}`} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className={item.priority === 'urgent' ? 'badge-red' : 'badge-yellow'}>{item.priority}</span>
                      {item.created_at && <span className="font-mono text-[10px] text-obsidian-500">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>}
                    </div>
                    <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-obsidian-400">{item.agent_name}: {item.description}</p>
                    <div className="mt-3 flex gap-2">
                      {item.type === 'approval' ? (
                        <>
                          <button className="btn-primary h-8 flex-1 px-3 text-xs" onClick={() => decideApproval(item.id, 'approve')}>Approve</button>
                          <button className="btn-danger h-8 flex-1 px-3 text-xs" onClick={() => decideApproval(item.id, 'reject')}>Reject</button>
                        </>
                      ) : item.type === 'budget_alert' ? (
                        <>
                          <Link to={item.action_url?.startsWith('/') ? item.action_url : '/billing'} className="btn-primary h-8 flex-1 px-3 text-xs">View Details</Link>
                          <button className="btn-secondary h-8 px-3 text-xs" onClick={() => dismissAttention(item, index)}>Dismiss</button>
                        </>
                      ) : (
                        <>
                          <button className="btn-secondary h-8 flex-1 px-3 text-xs" onClick={() => dismissAttention(item, index, 'Acknowledged')}>Acknowledge</button>
                          <Link to={item.action_url || '/monitoring'} className="btn-primary h-8 flex-1 px-3 text-xs">Investigate</Link>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="h-[180px] shrink-0 border-t border-white/[0.08] bg-obsidian-925">
        <div className="flex h-11 items-center justify-between px-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">This Week's Output</h2>
          </div>
          <span className="font-mono text-xs text-obsidian-500">{summary.this_week.artifacts_produced} artifacts produced</span>
        </div>
        <div className="flex gap-3 overflow-x-auto px-5 pb-4">
          {summary.recent_artifacts.length ? summary.recent_artifacts.map((artifact, index) => {
            const Icon = artifactIcon(artifact.type)
            return artifact.url ? (
                <a
                  key={`${artifact.title}-${index}`}
                  href={artifact.url}
                  className="group w-64 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4 transition hover:-translate-y-0.5 hover:border-accent-400/30 hover:shadow-glow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-5 text-white">{artifact.title}</p>
                      <p className="mt-2 truncate text-xs text-obsidian-500">{artifact.agent_name}</p>
                      {artifact.created_at && <p className="mt-1 font-mono text-[10px] text-obsidian-600">{formatDistanceToNow(new Date(artifact.created_at), { addSuffix: true })}</p>}
                    </div>
                  </div>
                </a>
              ) : (
                <div
                  key={`${artifact.title}-${index}`}
                  className="w-64 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-5 text-white">{artifact.title}</p>
                      <p className="mt-2 truncate text-xs text-obsidian-500">{artifact.agent_name}</p>
                      {artifact.created_at && <p className="mt-1 font-mono text-[10px] text-obsidian-600">{formatDistanceToNow(new Date(artifact.created_at), { addSuffix: true })}</p>}
                    </div>
                  </div>
                </div>
              )
          }) : (
            <div className="grid h-28 w-full place-items-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-sm text-obsidian-500">
              No artifacts yet this week. Connect GitHub or Email, then let the team ship.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

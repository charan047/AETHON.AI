import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { animate, motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { clsx } from 'clsx'
import { monitoringApi } from '../api/client'
import { useDashboard } from '../hooks/useDashboard'
import { useWebSocket } from '../hooks/useWebSocket'
import type { DashboardSummary, Execution, WsEvent } from '../types'
import { GlassCard } from '../components/ui/GlassCard'
import { DashboardSkeleton, ExecutionRowSkeleton } from '../components/ui/Skeleton'
import { StatusDot } from '../components/ui/StatusDot'
import { TrustScoreBar } from '../components/ui/TrustScoreBar'

type ActivityEntry = {
  id: string
  label: string
  tone: 'green' | 'blue' | 'amber' | 'red' | 'purple'
  executionId?: string | null
  agentName: string
  timestamp?: string | null
}

function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    const controls = animate(displayValue, value || 0, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: latest => setDisplayValue(latest),
    })
    return () => controls.stop()
  }, [value])

  return (
    <motion.span className="tabular-nums">
      {Math.round(displayValue).toLocaleString()}
      {suffix}
    </motion.span>
  )
}

function formatDuration(seconds?: number | null) {
  if (seconds == null) return 'In progress'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function statusTone(status: string) {
  if (status === 'completed') return 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20'
  if (status === 'failed' || status === 'rejected' || status === 'timed_out') return 'text-accent-red bg-accent-red/10 border-accent-red/20'
  if (status === 'waiting_approval') return 'text-accent-amber bg-accent-amber/10 border-accent-amber/20'
  return 'text-accent-green bg-accent-green/10 border-accent-green/20'
}

function mapEventToActivity(event: WsEvent): ActivityEntry | null {
  const type = String(event.type || '')
  const agentName = String(event.agent_name || event.agent || event.name || 'Company')
  const executionId = typeof event.execution_id === 'string' ? event.execution_id : null

  if (type === 'execution_complete' || type === 'workflow_completed') {
    return {
      id: `${type}-${event.timestamp}-${executionId || agentName}`,
      label: `${agentName} completed a run`,
      tone: 'green',
      executionId,
      agentName,
      timestamp: event.timestamp,
    }
  }
  if (type === 'execution_start' || type === 'agent_started') {
    return {
      id: `${type}-${event.timestamp}-${executionId || agentName}`,
      label: `${agentName} started working`,
      tone: 'blue',
      executionId,
      agentName,
      timestamp: event.timestamp,
    }
  }
  if (type.includes('approval') || type.includes('hitl') || type === 'workflow_paused') {
    return {
      id: `${type}-${event.timestamp}-${executionId || agentName}`,
      label: `${agentName} is waiting for approval`,
      tone: 'amber',
      executionId,
      agentName,
      timestamp: event.timestamp,
    }
  }
  if (type.includes('error') || type.includes('failed') || type.includes('rejected')) {
    return {
      id: `${type}-${event.timestamp}-${executionId || agentName}`,
      label: `${agentName} hit a problem`,
      tone: 'red',
      executionId,
      agentName,
      timestamp: event.timestamp,
    }
  }
  if (type === 'tool_call' || type === 'tool_result') {
    return {
      id: `${type}-${event.timestamp}-${executionId || agentName}`,
      label: `${agentName} used ${String(event.tool || 'a tool')}`,
      tone: 'purple',
      executionId,
      agentName,
      timestamp: event.timestamp,
    }
  }
  return null
}

function toneClasses(tone: ActivityEntry['tone']) {
  if (tone === 'green') return 'border-l-accent-green bg-accent-green/[0.04]'
  if (tone === 'blue') return 'border-l-accent-cyan bg-accent-cyan/[0.04]'
  if (tone === 'amber') return 'border-l-accent-amber bg-accent-amber/[0.05]'
  if (tone === 'red') return 'border-l-accent-red bg-accent-red/[0.04]'
  return 'border-l-accent-purple bg-accent-purple/[0.04]'
}

function EmptyRoster({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-purple/12 text-2xl shadow-glow-purple">
        🤖
      </div>
      <div className="text-base font-semibold text-content-primary">Your first agent is waiting.</div>
      <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-content-secondary">
        Most founders start with a Market Researcher.
      </p>
      <button className="btn-primary mt-5 h-10 px-4 text-sm" onClick={onBrowse}>
        Browse agents
        <ArrowRight size={14} />
      </button>
    </div>
  )
}

function rosterStatus(status: DashboardSummary['team_status'][number]['status']) {
  if (status === 'working') return 'working'
  if (status === 'waiting_approval') return 'waiting_approval'
  return 'idle'
}

function rosterSubtitle(agent: DashboardSummary['team_status'][number]) {
  if (agent.current_task) return agent.current_task
  if (agent.last_active) return `Last active ${formatDistanceToNow(new Date(agent.last_active), { addSuffix: true })}`
  return 'Standing by for work'
}

export function Dashboard() {
  const navigate = useNavigate()
  const { summary, loading } = useDashboard()
  const { events } = useWebSocket()
  const { data: recentExecutions = [], isLoading: executionsLoading } = useQuery({
    queryKey: ['dashboard-recent-executions'],
    queryFn: () => monitoringApi.recentExecutions(5),
    refetchInterval: 30_000,
  })

  const activityFeed = events
    .map(mapEventToActivity)
    .filter((entry): entry is ActivityEntry => Boolean(entry))
    .slice(-15)
    .reverse()

  if (loading || !summary) {
    return <DashboardSkeleton />
  }

  const trustScore = Math.round(summary.overview.average_trust_score || 0)
  const statCards = [
    {
      title: 'Agents Active',
      value: summary.overview.agents_active,
      meta: `${summary.overview.agent_count} in the company`,
      icon: Bot,
      accent: 'text-accent-green',
      glow: 'green' as const,
    },
    {
      title: 'Tasks Today',
      value: summary.overview.tasks_today,
      meta: `${summary.this_week.tasks_completed} completed this week`,
      icon: Sparkles,
      accent: 'text-accent-cyan',
      glow: 'cyan' as const,
    },
    {
      title: 'Approvals Pending',
      value: summary.overview.pending_approvals,
      meta: summary.overview.pending_approvals ? 'Human decisions waiting' : 'No blockers right now',
      icon: ShieldAlert,
      accent: 'text-accent-amber',
      glow: 'purple' as const,
    },
    {
      title: 'Trust Score',
      value: trustScore,
      suffix: '%',
      meta: summary.this_week.success_rate ? `${summary.this_week.success_rate}% success this week` : 'Building confidence',
      icon: TrendingUp,
      accent: 'text-accent-purple',
      glow: 'purple' as const,
    },
  ]

  return (
    <div className="space-y-6 p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-medium text-content-secondary">
            <Activity size={13} className="text-accent-cyan" />
            Mission OS online
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.05em] text-content-primary lg:text-5xl">
            {summary.company_profile.name || 'Your AI Company'} Brain
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-content-secondary lg:text-base">
            A living view of your AI company: who is working, what shipped, what needs you, and where trust is growing.
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-content-secondary shadow-card">
          <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-content-muted">This Week</div>
          <div className="mt-1 text-content-primary">
            {summary.this_week.workflows_run} runs · {summary.this_week.artifacts_produced} artifacts
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-4">
        {statCards.map((card, index) => {
          const Icon = card.icon
          return (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
            >
              <GlassCard padding="lg" glow={card.glow} hover className="min-h-[150px]">
                <div className="flex items-start justify-between">
                  <div className="text-sm text-content-secondary">{card.title}</div>
                  <Icon size={18} className={clsx('opacity-80', card.accent)} />
                </div>
                <div className={clsx('mt-5 text-4xl font-semibold tracking-[-0.06em]', card.accent)}>
                  <CountUp value={card.value} suffix={card.suffix} />
                </div>
                <div className="mt-3 text-sm text-content-secondary">{card.meta}</div>
                {card.title === 'Trust Score' && (
                  <div className="mt-5">
                    <TrustScoreBar score={trustScore} size="md" showNumber={false} />
                  </div>
                )}
              </GlassCard>
            </motion.div>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.35 }}>
          <GlassCard padding="lg" className="h-full">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-content-primary">Activity Feed</div>
                <div className="text-sm text-content-secondary">Real-time company events, color-coded by what happened.</div>
              </div>
              <div className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-content-secondary">
                {activityFeed.length ? `${activityFeed.length} recent events` : 'Waiting for activity'}
              </div>
            </div>

            <div className="space-y-3">
              {activityFeed.length ? (
                activityFeed.map((entry, index) => (
                  <motion.button
                    key={entry.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index * 0.03, 0.2), duration: 0.25 }}
                    onClick={() => entry.executionId && navigate(`/executions/${entry.executionId}`)}
                    className={clsx(
                      'w-full rounded-xl border border-white/[0.06] border-l-4 px-4 py-3 text-left transition-colors',
                      toneClasses(entry.tone),
                      entry.executionId ? 'cursor-pointer hover:bg-white/[0.05]' : 'cursor-default',
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-content-primary">{entry.label}</div>
                        <div className="mt-1 text-xs text-content-secondary">
                          {entry.timestamp ? formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true }) : 'just now'}
                        </div>
                      </div>
                      {entry.executionId && <ArrowRight size={15} className="mt-0.5 shrink-0 text-content-muted" />}
                    </div>
                  </motion.button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center text-sm text-content-secondary">
                  Your company is quiet right now. Run a workflow and you’ll see the activity show up here in real time.
                </div>
              )}
            </div>
          </GlassCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.35 }}>
          <GlassCard padding="lg" className="h-full">
            <div className="mb-5">
              <div className="text-lg font-semibold text-content-primary">Agent Roster</div>
              <div className="text-sm text-content-secondary">Who’s working, waiting, and earning trust.</div>
            </div>

            {summary.team_status.length ? (
              <div className="space-y-3">
                {summary.team_status.map(agent => (
                  <div key={agent.agent_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-content-primary">{agent.name}</div>
                        <div className="truncate text-xs text-content-secondary">{agent.role}</div>
                      </div>
                      <StatusDot status={rosterStatus(agent.status)} />
                    </div>
                    <div className="mb-3 text-xs leading-relaxed text-content-secondary">{rosterSubtitle(agent)}</div>
                    <TrustScoreBar score={agent.trust_score || 0} size="sm" showLabel showNumber />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyRoster onBrowse={() => navigate('/marketplace')} />
            )}
          </GlassCard>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.35 }}>
        <GlassCard padding="lg">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-content-primary">Recent Executions</div>
              <div className="text-sm text-content-secondary">The last five runs across your company.</div>
            </div>
            <button className="btn-ghost h-9 px-3 text-xs" onClick={() => navigate('/executions')}>
              View all
            </button>
          </div>

          {executionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <ExecutionRowSkeleton key={index} />
              ))}
            </div>
          ) : recentExecutions.length ? (
            <div className="overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="hidden grid-cols-[1.1fr_1.4fr_0.9fr_0.9fr_0.9fr] gap-3 bg-white/[0.03] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-content-muted md:grid">
                <div>Agent</div>
                <div>Task</div>
                <div>Status</div>
                <div>Duration</div>
                <div>Time</div>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {recentExecutions.map((execution: Execution & { duration_seconds?: number | null }) => (
                  <button
                    key={execution.id}
                    onClick={() => navigate(`/executions/${execution.id}`)}
                    className="grid w-full gap-3 bg-white/[0.02] px-4 py-4 text-left transition-colors hover:bg-white/[0.04] md:grid-cols-[1.1fr_1.4fr_0.9fr_0.9fr_0.9fr]"
                  >
                    <div>
                      <div className="text-xs text-content-muted md:hidden">Agent</div>
                      <div className="text-sm font-medium text-content-primary">{execution.agent_name || 'Workflow'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-content-muted md:hidden">Task</div>
                      <div className="truncate text-sm text-content-primary">{execution.workflow_name || execution.input_message || 'Untitled run'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-content-muted md:hidden">Status</div>
                      <span className={clsx('inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize', statusTone(execution.status))}>
                        {execution.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-content-muted md:hidden">Duration</div>
                      <div className="text-sm text-content-primary">{formatDuration(execution.duration_seconds)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-content-muted md:hidden">Time</div>
                      <div className="inline-flex items-center gap-1 text-sm text-content-secondary">
                        <Clock3 size={13} />
                        {execution.started_at ? formatDistanceToNow(new Date(execution.started_at), { addSuffix: true }) : 'just now'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
              <div className="text-base font-medium text-content-primary">No executions yet</div>
              <p className="mt-2 text-sm text-content-secondary">Run an agent and your company’s output will start appearing here.</p>
            </div>
          )}
        </GlassCard>
      </motion.div>
    </div>
  )
}

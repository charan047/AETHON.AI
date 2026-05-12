import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  ArrowRight,
  Bot,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Command,
  PlayCircle,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'
import { clsx } from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'
import { useAgencyOverview } from '../hooks/useAgencyOverview'
import { Skeleton } from '../components/ui/Skeleton'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { StatusDot } from '../components/ui/StatusDot'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { AgencyOverviewActivity, AgencyOverviewAgent, AgencyOverviewApproval, AgencyOverviewClient } from '../types'

const COMPANY_CHAT_DRAFT_KEY = 'aethon-company-chat-draft'

function relativeTime(value: string | null | undefined) {
  if (!value) return 'Waiting for first run'
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true })
  } catch {
    return 'Recently'
  }
}

function clientSubtitle(
  client: AgencyOverviewClient,
  recentActivity?: { agent_name: string; input_preview: string; started_at: string | null },
) {
  if (recentActivity) return `${recentActivity.agent_name} · ${recentActivity.input_preview}`
  if (client.company_name) return client.company_name
  return 'No recent work yet'
}

function approvalTone(riskLevel: string) {
  if (riskLevel === 'critical') return 'border-red-400/30 bg-red-500/10 text-red-200'
  if (riskLevel === 'high') return 'border-amber-400/30 bg-amber-500/10 text-amber-200'
  if (riskLevel === 'medium') return 'border-blue-400/30 bg-blue-500/10 text-blue-200'
  return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
}

function statusTone(status: string) {
  if (status === 'completed') return 'text-emerald-300'
  if (status === 'running') return 'text-blue-300'
  if (status === 'failed') return 'text-red-300'
  if (status === 'cancelled') return 'text-ink-secondary'
  return 'text-amber-300'
}

function overviewMotion(prefersReducedMotion: boolean) {
  return prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: 'easeOut' as const },
      }
}

function StatCard({
  label,
  value,
  meta,
  icon: Icon,
  progress,
}: {
  label: string
  value: number
  meta: string
  icon: typeof Briefcase
  progress: number
}) {
  return (
    <div className="glass-card col-span-12 p-5 sm:col-span-6 xl:col-span-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4B5A73]">{label}</p>
          <p className="mt-2 text-4xl font-extrabold tracking-tight text-white">{value.toLocaleString()}</p>
          <p className="mt-1 text-xs text-[#8B9DBE]">{meta}</p>
        </div>
        <div className="rounded-xl bg-blue-600/12 p-2.5">
          <Icon size={20} className="text-blue-400" />
        </div>
      </div>
      <div className="mt-4 h-0.5 rounded-full bg-white/[0.04]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-400"
          style={{ width: `${Math.max(8, Math.min(progress, 100))}%` }}
        />
      </div>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string
  subtitle: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={clsx('glass-card overflow-hidden p-5', className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">{title}</div>
          <div className="mt-2 text-sm text-[#8B9DBE]">{subtitle}</div>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function CommandBar({
  onRun,
  chips,
}: {
  onRun: (command: string) => void
  chips: string[]
}) {
  const [value, setValue] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    onRun(value.trim())
    setValue('')
  }

  return (
    <div className="glass-card col-span-12 overflow-hidden">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/15">
          <Zap size={18} className="text-blue-400" />
        </div>
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-3">
          <Command size={16} className="shrink-0 text-[#4B5A73]" />
          <input
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') submit(event)
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#4B5A73]"
            placeholder="Tell your agency what to do — @Maya run research for Acme, pause all agents, show status..."
          />
          <div className="hidden shrink-0 text-xs text-[#2D3748] md:block">↵ Enter</div>
        </form>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-4 py-3">
        {chips.map(chip => (
          <button
            key={chip}
            type="button"
            onClick={() => onRun(chip)}
            className="cursor-pointer rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-[#8B9DBE] transition-all duration-150 hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-12 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="col-span-12 h-36 rounded-2xl sm:col-span-6 xl:col-span-3" />
        ))}
        <Skeleton className="col-span-12 h-[360px] rounded-2xl xl:col-span-7" />
        <Skeleton className="col-span-12 h-[360px] rounded-2xl xl:col-span-5" />
        <Skeleton className="col-span-12 h-[280px] rounded-2xl xl:col-span-7" />
        <Skeleton className="col-span-12 h-[280px] rounded-2xl xl:col-span-5" />
        <Skeleton className="col-span-12 h-28 rounded-2xl" />
      </div>
    </div>
  )
}

export function CommandCenter() {
  const navigate = useNavigate()
  const auth = useAuth()
  const prefersReducedMotion = useReducedMotion()
  const { overview, suggestedClient, loading, isError, refetch } = useAgencyOverview()

  const firstName = auth.activeOrg?.name?.split(/\s+/)[0] || auth.email?.split('@')[0] || 'there'
  const greeting = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date()).includes('AM')
    ? 'Good morning'
    : new Date().getHours() < 18
      ? 'Good afternoon'
      : 'Good evening'
  const nowLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date())

  const recentByClient = useMemo(() => {
    const byClient = new Map<string, { agent_name: string; input_preview: string; started_at: string | null }>()
    for (const item of overview?.activity.recent || []) {
      if (item.client_id && !byClient.has(item.client_id)) {
        byClient.set(item.client_id, {
          agent_name: item.agent_name,
          input_preview: item.input_preview,
          started_at: item.started_at,
        })
      }
    }
    return byClient
  }, [overview])

  const chips = useMemo(() => {
    const nextChips: string[] = []
    if ((overview?.approvals.pending || 0) > 0) nextChips.push('Review approvals')
    if (suggestedClient) nextChips.push(`Run ${suggestedClient.name} research`)
    const hour = new Date().getHours()
    if (hour < 12) nextChips.push('Morning standup')
    if (hour >= 16) nextChips.push('Generate weekly summary')
    nextChips.push('Show pending approvals')
    return nextChips.slice(0, 4)
  }, [overview?.approvals.pending, suggestedClient])

  const executeCommand = (rawCommand: string) => {
    const command = rawCommand.trim()
    const normalized = command.toLowerCase()
    const matchedAgent = overview?.agents.list.find(agent => {
      const names = [agent.persona_name, agent.name].filter(Boolean).map(value => String(value).toLowerCase())
      return names.some(name => normalized.includes(name))
    })
    const matchedClient = overview?.clients.list.find(client => {
      const names = [client.name, client.company_name].filter(Boolean).map(value => String(value).toLowerCase())
      return names.some(name => normalized.includes(name))
    })

    if (normalized.includes('approval')) {
      navigate('/approvals')
      return
    }
    if (matchedClient && (normalized.includes('activity') || normalized.includes('show') || normalized.includes('client'))) {
      navigate(`/clients/${matchedClient.id}`)
      return
    }
    if (normalized.includes('pause all agents')) {
      toast.info('Agent controls are ready in AI Team.')
      navigate('/agents')
      return
    }
    if (matchedAgent && normalized.startsWith('@')) {
      navigate(`/messages/${matchedAgent.id}`)
      toast.info(`Opened ${matchedAgent.persona_name || matchedAgent.name}'s thread.`)
      return
    }

    window.sessionStorage.setItem(COMPANY_CHAT_DRAFT_KEY, command)
    navigate('/company-chat')
    toast.success('Command loaded into Agency Chat.')
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="glass-card rounded-2xl p-8 text-center">
          <div className="text-lg font-semibold text-white">Could not load.</div>
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-primary mt-4"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (loading || !overview) {
    return <DashboardSkeleton />
  }

  const activeAgents = overview.agents.working + overview.agents.idle
  const statCards = [
    {
      label: 'Total Clients',
      value: overview.clients.total,
      meta: `${overview.clients.active} active accounts`,
      icon: Briefcase,
      progress: overview.clients.total ? (overview.clients.active / overview.clients.total) * 100 : 0,
    },
    {
      label: 'Active Agents',
      value: activeAgents,
      meta: `${overview.agents.working} working now`,
      icon: Bot,
      progress: activeAgents ? (overview.agents.working / activeAgents) * 100 : 0,
    },
    {
      label: 'Pending Approvals',
      value: overview.approvals.pending,
      meta: overview.approvals.pending ? `${overview.approvals.critical} higher-risk items` : 'All clear right now',
      icon: ShieldAlert,
      progress: Math.min(overview.approvals.pending * 15, 100),
    },
    {
      label: 'Done Today',
      value: overview.activity.completed_today,
      meta: `${overview.activity.executions_today} started today`,
      icon: CheckCircle2,
      progress: overview.activity.executions_today ? (overview.activity.completed_today / overview.activity.executions_today) * 100 : 0,
    },
  ]

  return (
    <motion.div {...overviewMotion(Boolean(prefersReducedMotion))} className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8B9DBE]">
            <Sparkles size={12} className="text-blue-400" />
            Executive overview
          </div>
          <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-white md:text-5xl">
            {greeting}, {firstName}
          </h1>
          <p className="mt-3 text-sm text-[#8B9DBE]">Here&apos;s what&apos;s happening in your agency.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-[#8B9DBE]">
          <CalendarDays size={16} className="text-blue-400" />
          {nowLabel}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {statCards.map(card => (
          <StatCard key={card.label} {...card} />
        ))}

        <SectionCard
          title="Client Activity"
          subtitle="Top accounts with movement across your agency today."
          className="col-span-12 xl:col-span-7"
          action={
            <Link
              to="/clients"
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/[0.08] px-3 py-1.5 text-xs text-[#8B9DBE] transition duration-150 hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              View all
              <ArrowRight size={13} />
            </Link>
          }
        >
          {overview.clients.list.length ? (
            <div className="divide-y divide-white/[0.04]">
              {overview.clients.list.map(client => {
                const activity = recentByClient.get(client.id)
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => navigate(`/clients/${client.id}`)}
                    className="group flex w-full cursor-pointer items-center gap-4 py-3 text-left transition duration-150 hover:translate-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    <div className="h-8 w-1 shrink-0 rounded-full" style={{ background: client.color }} />
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                      style={{ background: `${client.color}20`, color: client.color }}
                    >
                      {client.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{client.name}</p>
                      <p className="truncate text-xs text-[#8B9DBE]">{clientSubtitle(client, activity)}</p>
                    </div>
                    <div className="hidden text-xs text-[#4B5A73] md:block">{client.executions_today} runs</div>
                    <div className="hidden text-xs text-[#4B5A73] lg:block">{relativeTime(activity?.started_at || client.last_activity)}</div>
                    <ArrowRight size={14} className="shrink-0 text-[#2D3748] transition group-hover:text-[#4B5A73]" />
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-5 py-10 text-center">
              <div className="text-base font-semibold text-white">No clients yet.</div>
              <Link to="/clients" className="mt-3 inline-flex items-center gap-2 text-sm text-blue-300 transition hover:text-white">
                Add your first client
                <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Agent Team"
          subtitle="Who is active, what they&apos;re handling, and where they&apos;re deployed."
          className="col-span-12 xl:col-span-5"
          action={
            <Link
              to="/agents"
              className="inline-flex cursor-pointer items-center gap-2 text-xs text-blue-300 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              View all agents
              <ArrowRight size={13} />
            </Link>
          }
        >
          <div className="space-y-3">
            {overview.agents.list.map((agent: AgencyOverviewAgent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => navigate(`/agents?agent=${agent.id}`)}
                className="group flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition duration-150 hover:-translate-y-[1px] hover:border-blue-500/20 hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <AgentAvatar
                  name={agent.persona_name || agent.name}
                  size="md"
                  running={agent.current_status === 'working'}
                  color={agent.client_color ? `linear-gradient(135deg, ${agent.client_color}, #2563EB)` : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-semibold text-white">{agent.persona_name || agent.name}</div>
                    <StatusDot
                      status={agent.current_status === 'working' ? 'working' : agent.current_status === 'waiting_approval' ? 'waiting_approval' : 'idle'}
                      size="sm"
                    />
                  </div>
                  <div className="mt-1 truncate text-xs text-[#4B5A73]">
                    {agent.role_slug || agent.role}
                    {agent.client_name ? ` · ${agent.client_name}` : ' · Internal'}
                  </div>
                  <div className="mt-2 truncate text-xs text-[#8B9DBE]">
                    {agent.current_status === 'working'
                      ? agent.current_task_summary || 'Working on a client deliverable'
                      : agent.current_status === 'waiting_approval'
                        ? agent.current_task_summary || 'Waiting for approval'
                        : `Completed ${agent.tasks_completed} tasks`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Recent Work"
          subtitle="A cross-client view of what your AI team finished, started, or escalated."
          className="col-span-12 xl:col-span-7"
          action={
            <Link
              to="/monitoring"
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/[0.08] px-3 py-1.5 text-xs text-[#8B9DBE] transition duration-150 hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              Open executions
              <ArrowRight size={13} />
            </Link>
          }
        >
          {overview.activity.recent.length ? (
            <div className="space-y-3">
              {overview.activity.recent.map((item: AgencyOverviewActivity) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/executions/${item.id}`)}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-left transition duration-150 hover:-translate-y-[1px] hover:border-blue-500/20 hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <div className={clsx('mt-0.5 shrink-0', statusTone(item.status))}>
                    {item.status === 'completed' ? <CheckCircle2 size={17} /> : item.status === 'running' ? <PlayCircle size={17} /> : <Activity size={17} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">{item.agent_name}</span>
                      {item.client_name && (
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#8B9DBE]">
                          {item.client_name}
                        </span>
                      )}
                      <span className={clsx('text-[11px] uppercase tracking-[0.14em]', statusTone(item.status))}>
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm text-[#8B9DBE]">{item.input_preview}</div>
                  </div>
                  <div className="shrink-0 text-xs text-[#4B5A73]">{relativeTime(item.started_at)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-5 py-10 text-center">
              <div className="text-base font-semibold text-white">No recent work yet.</div>
              <div className="mt-2 text-sm text-[#8B9DBE]">Recent executions will appear here once your team starts running client work.</div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Approvals"
          subtitle="Human decisions waiting before work can safely continue."
          className="col-span-12 xl:col-span-5"
          action={
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-[#8B9DBE]">
              {overview.approvals.pending} pending
            </span>
          }
        >
          {overview.approvals.list.length ? (
            <div className="space-y-3">
              {overview.approvals.list.map((approval: AgencyOverviewApproval) => (
                <button
                  key={`${approval.type}-${approval.id}`}
                  type="button"
                  onClick={() => navigate('/approvals')}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-left transition duration-150 hover:-translate-y-[1px] hover:border-blue-500/20 hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <div className="rounded-xl bg-blue-600/10 p-2">
                    <ShieldAlert size={15} className="text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">{approval.title}</span>
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em]', approvalTone(approval.risk_level))}>
                        {approval.risk_level}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[#8B9DBE]">
                      {approval.agent_name} · {relativeTime(approval.created_at)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-emerald-400/20 bg-emerald-500/[0.06] px-5 py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300">
                <CheckCircle2 size={22} />
              </div>
              <div className="mt-4 text-base font-semibold text-white">All clear</div>
              <div className="mt-2 text-sm text-[#8B9DBE]">No pending approvals are blocking delivery right now.</div>
            </div>
          )}
        </SectionCard>

        <CommandBar onRun={executeCommand} chips={chips} />
      </div>
    </motion.div>
  )
}

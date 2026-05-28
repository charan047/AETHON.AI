import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  CalendarDays,
  Command,
  FileText,
  PlayCircle,
  ShieldAlert,
  XCircle,
  Zap,
} from 'lucide-react'
import { clsx } from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'
import { useAgencyOverview } from '../hooks/useAgencyOverview'
import { Skeleton } from '../components/ui/Skeleton'
import { AnimatedContent } from '../components/reactbits/AnimatedContent'
import { useAuth } from '../contexts/AuthContext'
import { AnimatedList, AnimatedListItem } from '../components/ui/magicui/AnimatedList'
import { BorderBeam } from '../components/ui/magicui/BorderBeam'
import { NumberTicker } from '../components/ui/magicui/NumberTicker'
import { toast } from '../lib/toast'
import type {
  AgencyOverviewActivity,
  AgencyOverviewAgent,
  AgencyOverviewAttentionItem,
  AgencyOverviewClient,
} from '../types'

const COMPANY_CHAT_DRAFT_KEY = 'aethon-company-chat-draft'
const PRODUCT_STATEMENT = 'Your AI agency team. Handles the repeatable work. You approve before anything reaches clients.'

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
  if (riskLevel === 'critical') return 'border-signal-red bg-signal-red-bg text-signal-red'
  if (riskLevel === 'high') return 'border-signal-amber bg-signal-amber-bg text-signal-amber'
  if (riskLevel === 'medium') return 'border-signal-blue bg-signal-blue-bg text-signal-blue'
  return 'border-signal-green bg-signal-green-bg text-signal-green'
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

function statusBadge(status: string) {
  if (status === 'completed') return { className: 'badge-emerald', label: 'done' }
  if (status === 'running') return { className: 'badge-indigo', label: 'running' }
  if (status === 'failed') return { className: 'badge-red', label: 'failed' }
  if (status === 'pending_review') return { className: 'badge-amber', label: 'Needs Review' }
  if (status === 'waiting_approval') return { className: 'badge-amber', label: 'Needs Review' }
  if (status === 'cancelled') return { className: 'badge-glass', label: 'stopped' }
  return { className: 'badge-glass', label: status }
}

function statusDot(status: string, requiresCeoAction?: boolean) {
  if (requiresCeoAction || status === 'pending_review' || status === 'waiting_approval') return 'dot-amber'
  if (status === 'completed') return 'dot-green'
  if (status === 'running' || status === 'working' || status === 'pending') return 'dot-blue dot-live'
  return 'dot-muted'
}

function StatCard({
  label,
  value,
  meta,
  icon: Icon,
  progress,
  accent,
  index,
}: {
  label: string
  value: number
  meta: string
  icon: typeof Briefcase
  progress: number
  accent: 'indigo' | 'emerald' | 'amber' | 'violet'
  index: number
}) {
  const accentStyles = {
    indigo: {
      iconWrap: 'bg-indigo-500/15 text-indigo-300',
      bar: 'bg-indigo-400',
      hover: 'hover:border-indigo-500/15',
    },
    emerald: {
      iconWrap: 'bg-emerald-500/15 text-emerald-300',
      bar: 'bg-emerald-400',
      hover: 'hover:border-emerald-500/15',
    },
    amber: {
      iconWrap: 'bg-amber-500/15 text-amber-300',
      bar: 'bg-amber-400',
      hover: 'hover:border-amber-500/15',
    },
    violet: {
      iconWrap: 'bg-violet-500/15 text-violet-300',
      bar: 'bg-violet-300',
      hover: 'hover:border-violet-500/15',
    },
  } as const
  const styles = accentStyles[accent]

  return (
    <motion.div
      whileHover={{ y: -2 }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className={clsx('card relative overflow-hidden p-5', styles.hover)}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className={clsx('rounded-lg p-2', styles.iconWrap)}>
              <Icon size={14} />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4B5A73]">{label}</p>
          </div>
          <NumberTicker value={value} className="mt-2 block text-3xl font-extrabold tracking-tight text-white" />
          <p className="mt-1 text-xs text-[#8B9DBE]">{meta}</p>
        </div>
      </div>
      <div className="mt-4 h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.08, Math.min(progress, 100) / 100) }}
          transition={{ duration: 0.6, delay: 0.12 + index * 0.08, ease: [0.16, 1, 0.3, 1] }}
          className={clsx('h-full origin-left rounded-full', styles.bar)}
        />
      </div>
      <BorderBeam size={250} duration={12} delay={index * 2} />
    </motion.div>
  )
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const config = statusBadge(status)
  return (
    <span className={clsx('badge font-mono uppercase', config.className)}>{label || config.label}</span>
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
  const [focused, setFocused] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    onRun(value.trim())
    setValue('')
  }

  return (
    <div
      className="card col-span-12 overflow-hidden transition-all duration-150"
      style={{
        boxShadow: focused ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(99,102,241,0.14), 0 0 26px rgba(99,102,241,0.12)' : undefined,
      }}
    >
      <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
          <Zap size={18} />
        </div>
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-3">
          <Command size={16} className="shrink-0 text-white/25" />
          <input
            value={value}
            onChange={event => setValue(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={event => {
              if (event.key === 'Enter') submit(event)
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/20"
            placeholder="Type a command or @mention an agent..."
          />
          <kbd className="hidden shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/35 md:block">
            ↵
          </kbd>
        </form>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-4 py-3">
        {chips.map(chip => (
          <button
            key={chip}
            type="button"
            onClick={() => onRun(chip)}
            className="cursor-pointer rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 transition-all duration-150 hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/10"
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
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-10 w-72" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <Skeleton className="h-[240px] rounded-xl" />
          <Skeleton className="h-[320px] rounded-xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-[360px] rounded-xl" />
          <Skeleton className="h-[92px] rounded-xl" />
        </div>
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
  const greeting = new Date().getHours() < 12 ? 'Good morning.' : 'Good evening.'
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

  const isEmptyWorkspace = Boolean(
    overview &&
    overview.clients.total === 0 &&
    overview.agents.total === 0 &&
    overview.approvals.pending === 0 &&
    overview.activity.executions_today === 0 &&
    overview.activity.recent.length === 0 &&
    overview.needs_attention.length === 0,
  )

  if (isError) {
    return (
      <div className="p-6">
        <div className="card rounded-2xl p-8 text-center">
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

  return (
    <div className="px-7 pb-7 pt-7">
      <motion.div {...overviewMotion(Boolean(prefersReducedMotion))} className="space-y-6">
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-[clamp(28px,3vw,38px)] font-extrabold tracking-[-0.04em] text-white">{greeting}</h1>
            <div className="mt-2 font-mono text-sm uppercase tracking-[0.14em] text-[#4B5A73]">{nowLabel}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 py-5 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active Agents" value={overview.agents.total} meta={`${overview.agents.working} working now`} icon={Bot} progress={overview.agents.total ? (overview.agents.working / overview.agents.total) * 100 : 8} accent="indigo" index={0} />
          <StatCard label="Clients" value={overview.clients.total} meta={`${overview.clients.active} active accounts`} icon={Briefcase} progress={overview.clients.total ? (overview.clients.active / overview.clients.total) * 100 : 8} accent="emerald" index={1} />
          <StatCard label="Pending Reviews" value={overview.attention_count} meta={`${overview.approvals.pending} in approvals`} icon={ShieldAlert} progress={Math.min(Math.max(overview.attention_count * 14, 8), 100)} accent="amber" index={2} />
          <StatCard label="Done Today" value={overview.activity.completed_today} meta={`${overview.activity.executions_today} total runs today`} icon={CalendarDays} progress={overview.activity.executions_today ? (overview.activity.completed_today / overview.activity.executions_today) * 100 : 8} accent="violet" index={3} />
        </div>

        {isEmptyWorkspace ? (
          <section className="card flex min-h-[420px] items-center justify-center p-8">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300 shadow-[0_0_24px_rgba(99,102,241,0.18)]">
                <Zap size={28} />
              </div>
              <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-white">Welcome to Aethon</h2>
              <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-[#8B9DBE]">
                {PRODUCT_STATEMENT}
              </p>
              <p className="mt-3 text-sm text-[#8B9DBE]">
                Start by adding a team member or running the demo below
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button type="button" className="btn-primary h-11" onClick={() => navigate('/agents')}>
                  Add team member
                </button>
                <button
                  type="button"
                  className="btn-secondary h-11"
                  onClick={() => executeCommand('How is the team doing? Any blockers?')}
                >
                  Try the demo
                </button>
              </div>
            </div>
          </section>
        ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          <div className="space-y-6">
            <AnimatedContent distance={40} direction="vertical" duration={0.5}>
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3">
                <div className="section-title mb-0 border-none pb-0">NEEDS ATTENTION</div>
                {overview.attention_count > 0 ? (
                  <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-400">
                    {overview.attention_count}
                  </span>
                ) : null}
              </div>
              {overview.needs_attention.length ? (
                <AnimatedList className="gap-0">
                  {overview.needs_attention.map((item: AgencyOverviewAttentionItem) => (
                    <AnimatedListItem key={`${item.type}-${item.approval_id || item.execution_id || item.url}`}>
                      <button
                        type="button"
                        onClick={() => navigate(item.url)}
                        className={clsx(
                          'row relative w-full border-l-2 text-left transition-colors',
                          item.type === 'approval_request'
                            ? 'border-l-red-500 bg-red-500/[0.04]'
                            : item.type === 'pending_review'
                              ? 'border-l-amber-500 bg-amber-500/[0.04]'
                              : 'border-l-white/10 bg-white/[0.02]',
                          item.type === 'approval_request' && item.urgency === 'critical'
                            ? 'animate-pulse'
                            : '',
                        )}
                      >
                        <span
                          className={clsx(
                            'status-dot',
                            item.type === 'approval_request'
                              ? item.urgency === 'critical'
                                ? 'dot-red dot-live'
                                : 'dot-red'
                              : item.type === 'pending_review'
                                ? 'dot-amber'
                                : 'dot-muted',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                          <div className="truncate text-xs text-[#8B9DBE]">{item.subtitle}</div>
                        </div>
                        <div className="font-mono text-[11px] text-[#4B5A73]">
                          {item.age_minutes >= 60 ? `${Math.floor(item.age_minutes / 60)}h` : `${Math.max(item.age_minutes, 0)}m`}
                        </div>
                        <span className={clsx('badge font-mono uppercase', item.urgency === 'critical' ? 'badge-red' : item.urgency === 'high' ? 'badge-amber' : 'badge-indigo')}>
                          {item.urgency}
                        </span>
                      </button>
                    </AnimatedListItem>
                  ))}
                </AnimatedList>
              ) : (
                <div className="row cursor-default">
                  <span className="status-dot dot-green dot-live" />
                  <span className="text-sm text-[#8B9DBE]">All clear — nothing needs your attention</span>
                </div>
              )}
            </section>
            </AnimatedContent>

            <AnimatedContent distance={40} direction="vertical" duration={0.5}>
            <section className="card overflow-hidden">
              <div className="px-5 py-3">
                <div className="section-title mb-0 border-none pb-0">RECENT</div>
              </div>
              {overview.activity.recent.length ? (
                <div>
                  {overview.activity.recent.slice(0, 8).map((item: AgencyOverviewActivity) => {
                    const label = item.agent_name || (item as AgencyOverviewActivity & { workflow_name?: string }).workflow_name || 'Agent'
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(`/executions/${item.id}`)}
                        className="row w-full text-left"
                      >
                        <span className={clsx('status-dot', statusDot(item.status, item.requires_ceo_action))} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-white">{label}</div>
                          <div className="truncate text-xs text-[#8B9DBE]">
                            {item.input_preview}
                          </div>
                        </div>
                        <div className="truncate text-xs text-[#8B9DBE]">{item.client_name || 'Internal'}</div>
                        <div className="font-mono text-[11px] text-[#4B5A73]">{relativeTime(item.started_at)}</div>
                        <StatusBadge status={item.status} label={item.status_label} />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="row cursor-default">
                  <span className="status-dot dot-muted" />
                  <span className="text-sm text-[#8B9DBE]">No recent work yet.</span>
                </div>
              )}
            </section>
            </AnimatedContent>
          </div>

          <div className="flex min-h-0 flex-col gap-6">
            <AnimatedContent distance={40} direction="vertical" duration={0.5}>
            <section className="card overflow-hidden">
              <div className="px-5 py-3">
                <div className="section-title mb-0 border-none pb-0">TEAM</div>
              </div>
              <div>
                {overview.agents.list.map((agent: AgencyOverviewAgent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => navigate(`/agents?agent=${agent.id}`)}
                    className="row w-full text-left"
                  >
                    <span className={clsx('status-dot', agent.current_status === 'working' ? 'dot-green dot-live' : agent.current_status === 'waiting_approval' ? 'dot-amber' : 'dot-muted')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{agent.persona_name || agent.name}</div>
                      <div className="truncate text-xs text-[#8B9DBE]">{agent.role_slug || agent.role}</div>
                    </div>
                    <div className="text-right font-mono text-[11px] text-[#8B9DBE]">
                      trust {(agent.trust_score ?? 50).toFixed(0)}
                    </div>
                  </button>
                ))}
              </div>
            </section>
            </AnimatedContent>

            <div className="sticky bottom-4 z-10 pt-2">
              <CommandBar onRun={executeCommand} chips={chips} />
            </div>
          </div>
        </div>
        )}
      </motion.div>
    </div>
  )
}

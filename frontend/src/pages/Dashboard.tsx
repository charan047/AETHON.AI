import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Bot, CheckCircle2, GitBranch, Sparkles, Users, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { agentsApi, approvalsApi, monitoringApi } from '../api/client'
import { useWebSocket } from '../hooks/useWebSocket'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { GlowCard } from '../components/ui/GlowCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { BusinessContextWidget } from '../components/dashboard/BusinessContextWidget'
import { clsx } from 'clsx'

function Sparkline({ color = '#06b6d4' }: { color?: string }) {
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-28 overflow-visible">
      <path d="M0 24 C12 18 18 20 28 12 C38 4 48 12 58 10 C72 7 78 22 92 15 C103 10 110 6 120 8" fill="none" stroke={color} strokeWidth="2" />
      <path d="M0 24 C12 18 18 20 28 12 C38 4 48 12 58 10 C72 7 78 22 92 15 C103 10 110 6 120 8 L120 32 L0 32 Z" fill={color} opacity="0.08" />
    </svg>
  )
}

function metricCopy(type: string, ev: any) {
  if (type === 'agent_done') return `${ev.agent || 'Agent'} completed a workflow step`
  if (type === 'execution_start') return `Workflow "${ev.workflow || 'Untitled'}" started`
  if (type === 'execution_complete') return `Workflow completed successfully`
  if (type === 'execution_error') return `Execution failed: ${ev.error || 'unknown error'}`
  if (type.includes('approval') || type.includes('hitl')) return `Human approval event needs attention`
  return type.replace(/_/g, ' ')
}

function eventTone(type: string) {
  if (type.includes('error')) return 'border-red-400'
  if (type.includes('approval') || type.includes('hitl')) return 'border-amber-400'
  if (type.includes('workflow') || type.includes('execution')) return 'border-cyan-400'
  return 'border-accent-400'
}

export function Dashboard() {
  const { events, connected } = useWebSocket()
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: monitoringApi.stats, refetchInterval: 5000 })
  const { data: recent = [] } = useQuery({ queryKey: ['recent-executions'], queryFn: () => monitoringApi.recentExecutions(5), refetchInterval: 5000 })
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const { data: approvals = [] } = useQuery({ queryKey: ['approvals', 'dashboard'], queryFn: approvalsApi.pending, refetchInterval: 10_000 })
  const liveEvents = useMemo(() => events.slice(-20).reverse(), [events])

  return (
    <div className="space-y-8 p-6 animate-fade-in">
      <div className="flex items-end justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-cyan-200">
            <Sparkles size={13} /> Company OS online
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Your Company at a Glance</h1>
          <p className="mt-2 text-sm text-obsidian-400">Autonomous team, workflows, and decisions in one command surface.</p>
        </div>
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm', connected ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-obsidian-500')}>
          {connected ? 'Live signal' : 'Connecting'}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GlowCard glowColor="cyan" className="relative overflow-hidden p-5">
          <Users className="absolute right-5 top-5 text-cyan-300/20" size={42} />
          <div className="text-sm text-obsidian-400">Active Agents</div>
          <div className="mt-2 text-5xl font-semibold tracking-[-0.06em] text-white">{stats?.agents ?? agents.length}</div>
          <div className="mt-1 text-sm text-cyan-300">team members online</div>
          <div className="mt-5"><Sparkline /></div>
        </GlowCard>
        <GlowCard glowColor="indigo" className="relative overflow-hidden p-5">
          <GitBranch className="absolute right-5 top-5 text-accent-300/20" size={42} />
          <div className="text-sm text-obsidian-400">Workflows Run Today</div>
          <div className="mt-2 text-5xl font-semibold tracking-[-0.06em] text-white">{stats?.executions ?? 0}</div>
          <div className="mt-1 flex items-center gap-1 text-sm text-accent-300"><ArrowUpRight size={14} /> {stats?.success_rate ?? 0}% success rate</div>
          <div className="mt-5"><Sparkline color="#6366f1" /></div>
        </GlowCard>
        <Link to="/approvals">
          <GlowCard glowColor={approvals.length ? 'amber' : 'indigo'} active={approvals.length > 0} className="relative overflow-hidden p-5">
            <CheckCircle2 className="absolute right-5 top-5 text-amber-300/20" size={42} />
            <div className="text-sm text-obsidian-400">Pending Your Attention</div>
            <div className="mt-2 text-5xl font-semibold tracking-[-0.06em] text-white">{approvals.length}</div>
            <div className="mt-1 text-sm text-amber-300">{approvals.length ? 'approval decisions waiting' : 'nothing blocked'}</div>
            <div className="mt-5"><Sparkline color="#f59e0b" /></div>
          </GlowCard>
        </Link>
      </div>

      <GlowCard glowColor="cyan" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div>
            <h2 className="font-semibold text-white">Live Activity Feed</h2>
            <p className="text-xs text-obsidian-500">Realtime events, translated into operator language.</p>
          </div>
          <Activity size={18} className="text-cyan-300" />
        </div>
        <div className="max-h-[360px] space-y-1 overflow-y-auto p-3">
          {!liveEvents.length ? (
            <div className="py-12 text-center text-sm text-obsidian-500">No live events yet. Start a workflow and watch the company move.</div>
          ) : liveEvents.map((ev, index) => (
            <div key={`${ev.timestamp}-${index}`} className={clsx('animate-slide-in rounded-lg border-l-2 bg-white/[0.025] px-4 py-3', eventTone(ev.type))}>
              <div className="flex items-start gap-3">
                <AgentAvatar name={String(ev.agent || ev.workflow || 'System')} size="sm" running={ev.type === 'stream_chunk'} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-obsidian-100">{metricCopy(ev.type, ev)}</div>
                  <div className="mt-1 font-mono text-[11px] text-obsidian-500">{formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlowCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlowCard glowColor="indigo" className="overflow-hidden">
          <div className="border-b border-white/[0.08] px-5 py-4">
            <h2 className="font-semibold text-white">Your Team</h2>
            <p className="text-xs text-obsidian-500">AI employees available right now.</p>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {agents.slice(0, 6).map(agent => (
              <Link key={agent.id} to="/agents" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
                <AgentAvatar name={agent.name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{agent.name}</div>
                  <div className="truncate text-xs text-obsidian-500">{agent.role}</div>
                </div>
                <StatusBadge status={agent.is_active ? 'active' : 'idle'} />
              </Link>
            ))}
            {!agents.length && <div className="px-5 py-8 text-sm text-obsidian-500">No team members yet.</div>}
          </div>
        </GlowCard>

        <div className="space-y-4">
          <BusinessContextWidget />

          <GlowCard glowColor="cyan" className="overflow-hidden">
            <div className="border-b border-white/[0.08] px-5 py-4">
              <h2 className="font-semibold text-white">Recent Workflows</h2>
              <p className="text-xs text-obsidian-500">Last five workflow runs.</p>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {recent.map((ex: any) => (
                <div key={ex.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
                    <Zap size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{ex.workflow_name}</div>
                    <div className="font-mono text-[11px] text-obsidian-500">{formatDistanceToNow(new Date(ex.started_at), { addSuffix: true })}</div>
                  </div>
                  <StatusBadge status={ex.status} />
                </div>
              ))}
              {!recent.length && <div className="px-5 py-8 text-sm text-obsidian-500">No workflow runs yet.</div>}
            </div>
          </GlowCard>
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Coins,
  Edit3,
  GitBranch,
  RefreshCcw,
  ShieldAlert,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { format, subDays } from 'date-fns'
import { clsx } from 'clsx'
import { companyApi, extractApiError } from '../api/client'
import { AgentPerformanceCard } from '../components/analytics/AgentPerformanceCard'
import { GlowCard } from '../components/ui/GlowCard'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { useAnalytics } from '../hooks/useAnalytics'
import { toast } from '../lib/toast'

const PERIODS = [7, 30, 90]
const AGENT_COLORS = ['#2563EB', '#10B981', '#60A5FA', '#34D399', '#F59E0B', '#0EA5E9']

function money(value = 0, digits = 2) {
  return `$${value.toFixed(digits)}`
}

function successTone(rate: number) {
  if (rate >= 90) return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'
  if (rate >= 70) return 'text-amber-300 bg-amber-400/10 border-amber-400/20'
  return 'text-red-300 bg-red-400/10 border-red-400/20'
}

function toolTone(rate: number) {
  if (rate >= 90) return '#10B981'
  if (rate >= 70) return '#F59E0B'
  return '#EF4444'
}

function normalizeExecutionData(data: { date: string; count: number }[] = [], period: number) {
  const byDate = new Map(data.map(row => [row.date, row.count]))
  return Array.from({ length: period }).map((_, index) => {
    const date = format(subDays(new Date(), period - index - 1), 'yyyy-MM-dd')
    return { date, count: byDate.get(date) || 0 }
  })
}

function AnalyticsEmptyState({
  onOpenAgents,
  message = 'No data yet',
  detail = 'Run an agent to start seeing analytics here.',
}: {
  onOpenAgents: () => void
  message?: string
  detail?: string
}) {
  return (
    <div className="glass-card flex flex-col items-center justify-center rounded-2xl p-12 text-center">
      <BarChart3 size={32} className="mb-4 text-[#2D3748]" />
      <p className="text-sm font-semibold text-[#8B9DBE]">{message}</p>
      <p className="mt-1 text-xs text-[#4B5A73]">{detail}</p>
      <button className="btn-secondary mt-4 text-xs" onClick={onOpenAgents}>
        Go to Agents →
      </button>
    </div>
  )
}

function Gauge({
  label,
  value,
  max,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  max: number
  icon: LucideIcon
  tone: string
}) {
  const pct = Math.min(100, (value / Math.max(max, 1)) * 100)
  return (
    <GlowCard glowColor="blue" className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-[#8B9DBE]">{label}</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-white">{value}</div>
        </div>
        <Icon size={24} className={tone} />
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={clsx('h-full rounded-full transition-all', tone.replace('text-', 'bg-'))} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs text-[#4B5A73]">Scale 0-{max}</div>
    </GlowCard>
  )
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: LucideIcon
  tone: string
}) {
  return (
    <GlowCard glowColor="blue" className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-[#8B9DBE]">{label}</div>
          <div className={`mt-3 font-mono text-3xl font-semibold ${tone}`}>{value}</div>
        </div>
        <div className="rounded-xl bg-blue-600/12 p-2.5">
          <Icon size={18} className="text-blue-400" />
        </div>
      </div>
    </GlowCard>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-blue-400">
        <Icon size={18} />
      </div>
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-white">{title}</h2>
        <p className="text-sm text-[#8B9DBE]">{subtitle}</p>
      </div>
    </div>
  )
}

export function Analytics() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState(30)
  const [editingBudget, setEditingBudget] = useState(false)
  const analytics = useAnalytics(period)
  const [budgetDraft, setBudgetDraft] = useState('')

  const budget = Number(analytics.company?.company_profile?.monthly_budget_usd || 50)
  const totalCost = analytics.costs?.total_cost || 0
  const projected = analytics.costs?.projected_monthly || 0
  const workflowRuns = analytics.overview?.workflow_runs || analytics.performance?.workflows.reduce((sum, wf) => sum + wf.runs, 0) || 0
  const costPerRun = totalCost / Math.max(workflowRuns, 1)
  const budgetPct = (totalCost / Math.max(budget, 1)) * 100
  const budgetTone = budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

  const dailyExecutions = useMemo(
    () => normalizeExecutionData(analytics.overview?.daily_executions || [], period),
    [analytics.overview, period],
  )
  const costByAgent = Object.entries(analytics.costs?.by_agent || {}).map(([name, cost], index) => ({
    name,
    cost,
    fill: AGENT_COLORS[index % AGENT_COLORS.length],
  }))
  const maxToolCalls = Math.max(1, ...(analytics.tools?.tools || []).map(tool => tool.calls))
  const hasExecutionData = dailyExecutions.some(point => point.count > 0)
  const hasCostByAgentData = costByAgent.some(row => row.cost > 0)

  const saveBudget = async () => {
    const next = Number(budgetDraft)
    if (!Number.isFinite(next) || next < 0) {
      toast.error('Enter a valid budget')
      return
    }
    try {
      await companyApi.updateProfile({ monthly_budget_usd: next })
      toast.success('Monthly budget updated')
      setEditingBudget(false)
    } catch (error) {
      toast.error(extractApiError(error))
    }
  }

  if (analytics.loading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} className="h-40" />)}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-blue-300">
            Observability
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white">Analytics</h1>
          <p className="mt-2 text-sm text-[#8B9DBE]">Cost, performance, reliability, and operating signals for your agency.</p>
        </div>
        <div className="glass-card flex rounded-2xl p-1">
          {PERIODS.map(days => (
            <button
              key={days}
              onClick={() => setPeriod(days)}
              className={clsx(
                'rounded-xl px-4 py-2 text-sm transition',
                period === days ? 'bg-blue-600 text-white shadow-glow-sm' : 'text-[#8B9DBE] hover:bg-white/[0.04] hover:text-white',
              )}
            >
              Last {days}d
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="This Month" value={money(totalCost, 4)} icon={Coins} tone="text-emerald-300" />
          <MetricCard
            label="Projected Month-End"
            value={money(projected, 2)}
            icon={TrendingUp}
            tone={projected > budget * 0.8 ? 'text-amber-300' : 'text-blue-300'}
          />
          <GlowCard glowColor="blue" className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-[#8B9DBE]">Monthly Budget</div>
                {editingBudget ? (
                  <div className="mt-3 flex gap-2">
                    <input
                      className="input h-10 w-28"
                      type="number"
                      min={0}
                      value={budgetDraft}
                      onChange={event => setBudgetDraft(event.target.value)}
                    />
                    <button className="btn-primary h-10 text-xs" onClick={saveBudget}>Save</button>
                  </div>
                ) : (
                  <div className="mt-3 font-mono text-3xl font-semibold text-white">{money(budget, 2)}</div>
                )}
              </div>
              <button
                className="btn-ghost h-9 px-2"
                onClick={() => {
                  setBudgetDraft(String(budget))
                  setEditingBudget(value => !value)
                }}
              >
                <Edit3 size={15} />
              </button>
            </div>
          </GlowCard>
          <MetricCard label="Cost per Workflow Run" value={money(costPerRun, 4)} icon={GitBranch} tone="text-blue-300" />
        </div>

        <GlowCard glowColor={budgetPct >= 100 ? 'red' : budgetPct >= 80 ? 'amber' : 'emerald'} className="p-5">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium text-white">Budget usage</span>
            <span className="font-mono text-[#8B9DBE]">
              {money(totalCost, 2)} of {money(budget, 2)} used ({budgetPct.toFixed(1)}%)
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={clsx('h-full rounded-full transition-all', budgetTone)} style={{ width: `${Math.min(100, budgetPct)}%` }} />
          </div>
        </GlowCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <GlowCard glowColor="blue" className="p-5">
          <SectionTitle icon={BarChart3} title="Daily Activity" subtitle={`Execution volume over the last ${period} days`} />
          <div className="mt-5">
            {!hasExecutionData ? (
              <AnalyticsEmptyState onOpenAgents={() => navigate('/agents')} />
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyExecutions} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#8B9DBE', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={{ fill: '#8B9DBE', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(8,13,26,0.95)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 12,
                        color: '#fff',
                        backdropFilter: 'blur(16px)',
                      }}
                      formatter={value => [`${Number(value)} run${Number(value) === 1 ? '' : 's'}`, 'Executions']}
                    />
                    <Bar dataKey="count" fill="#2563EB" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-3 text-xs text-[#4B5A73]">
              {money(totalCost, 2)} spent in the same period.
            </p>
          </div>
        </GlowCard>
        <GlowCard glowColor="emerald" className="p-5">
          <SectionTitle icon={Coins} title="Cost by Agent" subtitle="Attribution by AI teammate" />
          <div className="mt-5 h-[300px]">
            {!hasCostByAgentData ? (
              <AnalyticsEmptyState
                onOpenAgents={() => navigate('/agents')}
                message="No cost data yet"
                detail="Runs are being tracked even if your current models cost $0.00."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByAgent} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#8B9DBE', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#8B9DBE', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(8,13,26,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12,
                      color: '#fff',
                      backdropFilter: 'blur(16px)',
                    }}
                    formatter={value => [money(Number(value), 6), 'Total cost']}
                  />
                  <Bar dataKey="cost" radius={[8, 8, 0, 0]}>
                    {costByAgent.map(row => <Cell key={row.name} fill={row.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GlowCard>
      </section>

      <GlowCard glowColor="blue" className="overflow-hidden">
        <div className="border-b border-white/[0.08] p-5">
          <SectionTitle icon={GitBranch} title="Workflow Success Rates" subtitle="Reliability and average execution economics" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[rgba(8,13,26,0.9)] text-xs uppercase tracking-wide text-[#4B5A73] backdrop-blur">
              <tr>
                <th className="px-5 py-3 text-left">Workflow Name</th>
                <th className="px-5 py-3 text-right">Total Runs</th>
                <th className="px-5 py-3 text-right">Success</th>
                <th className="px-5 py-3 text-right">Failed</th>
                <th className="px-5 py-3 text-right">Avg Duration</th>
                <th className="px-5 py-3 text-right">Avg Cost</th>
              </tr>
            </thead>
            <tbody>
              {(analytics.performance?.workflows || []).map(workflow => (
                <tr key={workflow.workflow_id} className="border-t border-white/[0.04] hover:bg-white/[0.025]">
                  <td className="px-5 py-4 font-medium text-white">{workflow.workflow_name}</td>
                  <td className="px-5 py-4 text-right font-mono text-[#8B9DBE]">{workflow.runs}</td>
                  <td className="px-5 py-4 text-right">
                    <span className={clsx('rounded-full border px-2 py-1 font-mono text-xs', successTone(workflow.success_rate))}>
                      {(workflow.success_rate ?? 0).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-red-300">{workflow.failed}</td>
                  <td className="px-5 py-4 text-right font-mono text-[#8B9DBE]">{(workflow.avg_duration_seconds ?? 0).toFixed(1)}s</td>
                  <td className="px-5 py-4 text-right font-mono text-emerald-300">{money(workflow.avg_cost, 5)}</td>
                </tr>
              ))}
              {!analytics.performance?.workflows.length && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[#4B5A73]">No workflow runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlowCard>

      <section>
        <SectionTitle icon={Activity} title="Agent Performance" subtitle="Reputation, task volume, response time, and spend" />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {analytics.agents.map(agent => (
            <AgentPerformanceCard
              key={agent.id}
              agent={agent}
              reputation={analytics.reputations[agent.id]}
              cost={analytics.costs?.by_agent[agent.name] || 0}
              avgResponseTime={analytics.performance?.agent_utilization.find(row => row.agent_id === agent.id)?.utilization_percent || 0}
            />
          ))}
        </div>
      </section>

      <GlowCard glowColor="emerald" className="p-5">
        <SectionTitle icon={Wrench} title="Tool Usage" subtitle="Frequency, latency, and reliability by tool" />
        <div className="mt-5 space-y-3">
          {(analytics.tools?.tools || []).map(tool => (
            <div key={tool.tool_name} className="grid gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 md:grid-cols-[180px_1fr_170px] md:items-center">
              <div>
                <div className="font-medium text-white">{tool.tool_name}</div>
                <div className="text-xs text-[#4B5A73]">{tool.calls} calls</div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(tool.calls / maxToolCalls) * 100}%`, background: toolTone(tool.success_rate) }}
                />
              </div>
              <div className="text-right font-mono text-xs text-[#8B9DBE]">
                {(tool.avg_duration_ms ?? 0).toFixed(0)}ms avg · {(tool.error_rate ?? 0).toFixed(1)}% errors
              </div>
            </div>
          ))}
          {!analytics.tools?.tools.length && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-center text-sm text-[#4B5A73]">
              No tool calls tracked yet.
            </div>
          )}
        </div>
      </GlowCard>

      <section>
        <SectionTitle icon={RefreshCcw} title="Real-time Metrics" subtitle="Refreshes every 10 seconds" />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Gauge label="Active Executions" value={analytics.monitoring?.active_executions || 0} max={10} icon={Activity} tone="text-blue-300" />
          <Gauge label="Pending Approvals" value={analytics.pendingApprovals.length} max={20} icon={ShieldAlert} tone="text-amber-300" />
          <Gauge label="API Calls Last Minute" value={analytics.overview?.api_calls_last_minute || 0} max={100} icon={AlertTriangle} tone="text-emerald-300" />
        </div>
      </section>
    </div>
  )
}

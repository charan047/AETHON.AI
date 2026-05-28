import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import type { Agent, AgentReputation } from '../../types'
import { AgentAvatar } from '../ui/AgentAvatar'
import { StatusBadge } from '../ui/StatusBadge'

interface AgentPerformanceCardProps {
  agent: Agent
  reputation?: AgentReputation | null
  cost?: number
  avgResponseTime?: number
  tokenSparkline?: { day: string; tokens: number }[]
}

function rateTone(rate: number) {
  if (rate > 0.8) return 'text-emerald-300'
  if (rate >= 0.5) return 'text-amber-300'
  return 'text-red-300'
}

export function AgentPerformanceCard({
  agent,
  reputation,
  cost = 0,
  avgResponseTime = 0,
  tokenSparkline = [],
}: AgentPerformanceCardProps) {
  const approvalRate = reputation?.approval_rate || 0
  const percent = Math.round(approvalRate * 100)
  const circumference = 2 * Math.PI * 32
  const offset = circumference - approvalRate * circumference

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} size="lg" running={false} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{agent.name}</div>
          <div className="mt-0.5 truncate text-xs text-ink-secondary">{agent.role}</div>
          <div className="mt-2"><StatusBadge status={agent.is_active ? 'active' : 'idle'} /></div>
        </div>
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 80 80" className="-rotate-90">
            <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
            <circle
              cx="40"
              cy="40"
              r="32"
              fill="none"
              stroke={approvalRate > 0.8 ? '#22c55e' : approvalRate >= 0.5 ? '#f59e0b' : '#ef4444'}
              strokeLinecap="round"
              strokeWidth="7"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className={`absolute inset-0 grid place-items-center text-sm font-semibold ${rateTone(approvalRate)}`}>
            {percent}%
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="Tasks" value={reputation?.total_tasks || 0} />
        <Stat label="Avg time" value={`${avgResponseTime.toFixed(1)}s`} />
        <Stat label="Cost" value={`$${cost.toFixed(4)}`} tone="text-emerald-300" />
      </div>

      <div className="mt-4 h-16">
        {tokenSparkline.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tokenSparkline}>
              <XAxis dataKey="day" hide />
              <Tooltip
                cursor={{ fill: 'rgba(99,102,241,0.10)' }}
                contentStyle={{
                  background: 'rgba(8,13,26,0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  color: '#fff',
                  backdropFilter: 'blur(16px)',
                }}
              />
              <Bar dataKey="tokens" fill="#10B981" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs text-[#4B5A73]">
            Token sparkline appears after tracked runs
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-center">
      <div className={`font-mono text-xs font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  )
}

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Skeleton } from '../ui/Skeleton'

interface CostChartProps {
  data?: { date: string; cost: number }[]
  period: number
  height?: number
  loading?: boolean
}

export function CostChart({ data = [], period, height = 280, loading = false }: CostChartProps) {
  if (loading) return <div style={{ height }}><Skeleton className="h-full w-full" /></div>

  if (!data.length) {
    return (
      <div className="grid rounded-2xl border border-white/[0.08] bg-white/[0.03] text-center text-sm text-obsidian-500" style={{ height }}>
        <div className="m-auto">
          <div className="font-medium text-obsidian-300">No cost data yet</div>
          <div className="mt-1">Run workflows to see daily spend over the last {period} days.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="costGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#71717f', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: '#71717f', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={value => `$${Number(value).toFixed(2)}`}
          />
          <Tooltip
            cursor={{ stroke: '#6366f1', strokeWidth: 1 }}
            contentStyle={{
              background: '#111118',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#fff',
            }}
            formatter={value => [`$${Number(value).toFixed(6)}`, 'Cost']}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#costGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

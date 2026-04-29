import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Lightbulb } from 'lucide-react'
import { feedbackApi } from '../../api/client'
import type { Agent } from '../../types'

function tone(rate: number) {
  if (rate > 0.8) return { stroke: '#22c55e', text: 'text-emerald-300' }
  if (rate >= 0.5) return { stroke: '#f59e0b', text: 'text-amber-300' }
  return { stroke: '#ef4444', text: 'text-red-300' }
}

export function ReputationCard({ agent }: { agent: Agent }) {
  const { data: reputation } = useQuery({
    queryKey: ['agent-reputation', agent.id],
    queryFn: () => feedbackApi.reputation(agent.id),
  })
  const notes = reputation?.learning_notes || []
  const approvalRate = reputation?.approval_rate || 0
  const percent = Math.round(approvalRate * 100)
  const circle = tone(approvalRate)
  const circumference = 2 * Math.PI * 42
  const offset = circumference - approvalRate * circumference
  const outputAccuracy = Math.max(0, Math.round((1 - (reputation?.avg_edit_distance || 0)) * 100))

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="relative mx-auto h-28 w-28 shrink-0">
          <svg viewBox="0 0 100 100" className="-rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={circle.stroke}
              strokeLinecap="round"
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className={`text-2xl font-semibold ${circle.text}`}>{percent}%</div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-white">Reputation</h3>
          <p className="mt-1 text-sm text-obsidian-400">
            {reputation?.approved_count || 0} of {reputation?.total_tasks || 0} tasks approved
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Total" value={reputation?.total_tasks || 0} />
            <Stat label="Approved" value={reputation?.approved_count || 0} tone="text-emerald-300" />
            <Stat label="Rejected" value={reputation?.rejected_count || 0} tone="text-red-300" />
            <Stat label="Edited" value={reputation?.edited_count || 0} tone="text-amber-300" />
            <Stat label="Accuracy" value={`${outputAccuracy}%`} tone="text-cyan-300" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-white">What {agent.name} has learned</h4>
        <div className="mt-3 space-y-2">
          {notes.length ? notes.map((note, index) => {
            const createdAt = typeof note === 'string' ? '' : note.created_at
            const text = typeof note === 'string' ? note : note.note
            return (
              <div key={`${createdAt}-${index}`} className="rounded-xl border border-white/[0.08] bg-obsidian-950/60 p-3">
                <div className="flex gap-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div>
                    <p className="text-sm leading-6 text-slate-300">{text}</p>
                    {createdAt && (
                      <p className="mt-1 font-mono text-[11px] text-obsidian-500">
                        from {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          }) : (
            <div className="rounded-xl border border-white/[0.08] bg-obsidian-950/60 p-4 text-sm text-obsidian-500">
              No learnings yet. Give feedback to help this agent improve.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center">
      <div className={`font-mono text-sm font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-obsidian-500">{label}</div>
    </div>
  )
}

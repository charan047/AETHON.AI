import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, DollarSign, Plus, Target, Trash2 } from 'lucide-react'
import { businessApi } from '../../api/client'
import { GlowCard } from '../ui/GlowCard'
import { toast } from '../../lib/toast'

function runwayTone(months: number | null | undefined) {
  if (months == null) return 'border-white/[0.08] bg-white/[0.03] text-slate-400'
  if (months > 18) return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
  if (months >= 6) return 'border-amber-400/20 bg-amber-400/10 text-amber-200'
  return 'border-red-400/20 bg-red-400/10 text-red-200'
}

export function BusinessContextWidget() {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [mrr, setMrr] = useState('')
  const [runway, setRunway] = useState('')
  const [newGoal, setNewGoal] = useState('')
  const [editingGoal, setEditingGoal] = useState<Record<number, string>>({})

  const { data: summary } = useQuery({
    queryKey: ['business-summary'],
    queryFn: businessApi.summary,
    refetchInterval: 30_000,
  })
  const { data: contextData } = useQuery({
    queryKey: ['business-context'],
    queryFn: businessApi.context,
    enabled: expanded,
  })

  const profile = summary?.company_profile
  const goals = profile?.goals || []

  useEffect(() => {
    if (!profile) return
    setMrr(String(profile.monthly_revenue ?? 0))
    setRunway(profile.runway_months == null ? '' : String(profile.runway_months))
  }, [profile?.monthly_revenue, profile?.runway_months])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['business-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['business-context'] }),
    ])
  }

  const revenueMutation = useMutation({
    mutationFn: () => businessApi.updateRevenue({
      monthly_revenue: Number(mrr || 0),
      runway_months: runway === '' ? null : Number(runway),
    }),
    onSuccess: () => refresh(),
    onError: () => toast.error('Failed to update business metrics'),
  })

  const addGoalMutation = useMutation({
    mutationFn: businessApi.addGoal,
    onSuccess: () => {
      setNewGoal('')
      refresh()
    },
    onError: () => toast.error('Failed to add goal'),
  })

  const updateGoalMutation = useMutation({
    mutationFn: ({ index, goal }: { index: number; goal: string }) => businessApi.updateGoal(index, goal),
    onSuccess: () => refresh(),
    onError: () => toast.error('Failed to update goal'),
  })

  const deleteGoalMutation = useMutation({
    mutationFn: businessApi.deleteGoal,
    onSuccess: () => refresh(),
    onError: () => toast.error('Failed to remove goal'),
  })

  if (!profile) {
    return (
      <GlowCard glowColor="amber" active className="p-5">
        <h2 className="font-semibold text-white">Business Context</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          No company profile exists yet. Complete onboarding or apply a Company OS YAML file to make agents business-aware.
        </p>
      </GlowCard>
    )
  }

  const saveRevenue = () => {
    const nextMrr = Number(mrr || 0)
    const nextRunway = runway === '' ? null : Number(runway)
    if (nextMrr !== profile.monthly_revenue || nextRunway !== profile.runway_months) {
      revenueMutation.mutate()
    }
  }

  return (
    <GlowCard glowColor="cyan" className="overflow-hidden">
      <div className="border-b border-white/[0.08] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white">Business Context</h2>
            <p className="text-xs text-ink-faint">The business state injected into every agent run.</p>
          </div>
          <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-indigo-200">
            {profile.stage || 'stage unset'}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Company</p>
          <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">{profile.company_name}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-400">{profile.mission || 'No mission set yet.'}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <span className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
              <DollarSign className="h-3.5 w-3.5 text-emerald-300" />
              MRR
            </span>
            <input
              type="number"
              min={0}
              value={mrr}
              onChange={event => setMrr(event.target.value)}
              onBlur={saveRevenue}
              className="mt-2 w-full border-none bg-transparent text-2xl font-semibold text-white outline-none"
            />
          </label>

          <label className={`rounded-xl border p-4 ${runwayTone(profile.runway_months)}`}>
            <span className="text-xs uppercase tracking-[0.2em] opacity-80">Runway</span>
            <div className="mt-2 flex items-end gap-2">
              <input
                type="number"
                min={0}
                value={runway}
                onChange={event => setRunway(event.target.value)}
                onBlur={saveRevenue}
                className="w-20 border-none bg-transparent text-2xl font-semibold text-white outline-none"
                placeholder="--"
              />
              <span className="pb-1 text-sm opacity-80">months</span>
            </div>
          </label>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
              <Target className="h-3.5 w-3.5 text-indigo-300" />
              Goals / OKRs
            </p>
          </div>

          <div className="space-y-2">
            {goals.map((goal, index) => (
              <div key={`${goal}-${index}`} className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                <input
                  value={editingGoal[index] ?? goal}
                  onChange={event => setEditingGoal(current => ({ ...current, [index]: event.target.value }))}
                  onBlur={() => {
                    const nextGoal = editingGoal[index]
                    if (nextGoal && nextGoal !== goal) updateGoalMutation.mutate({ index, goal: nextGoal })
                  }}
                  className="min-w-0 flex-1 border-none bg-transparent text-sm text-slate-200 outline-none"
                />
                <button
                  className="text-slate-600 transition hover:text-red-300"
                  onClick={() => deleteGoalMutation.mutate(index)}
                  title="Remove goal"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!goals.length && <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-sm text-slate-600">No goals set yet.</div>}
          </div>

          <form
            className="mt-3 flex gap-2"
            onSubmit={event => {
              event.preventDefault()
              if (newGoal.trim()) addGoalMutation.mutate(newGoal.trim())
            }}
          >
            <input
              value={newGoal}
              onChange={event => setNewGoal(event.target.value)}
              placeholder="Add a business goal..."
              className="input min-w-0 flex-1"
            />
            <button className="btn-secondary px-3" type="submit">
              <Plus size={15} />
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-base-bg">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-200"
            onClick={() => setExpanded(value => !value)}
          >
            What agents see
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {expanded && (
            <pre className="max-h-72 overflow-auto border-t border-white/[0.08] p-4 font-mono text-xs leading-6 text-slate-400">
              {contextData?.context || 'Loading business context...'}
            </pre>
          )}
        </div>
      </div>
    </GlowCard>
  )
}

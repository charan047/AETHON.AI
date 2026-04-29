import { useEffect, useMemo, useState } from 'react'
import { Play, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { evalsApi } from '../../api/client'
import { useWebSocket } from '../../contexts/WebSocketContext'
import type { EvalSuite } from '../../types'
import { ScoreBadge } from './ScoreBadge'

export function RunSuiteModal({
  suite,
  open,
  onClose,
  onFinished,
}: {
  suite: EvalSuite | null
  open: boolean
  onClose: () => void
  onFinished: () => void
}) {
  const { events } = useWebSocket()
  const [notes, setNotes] = useState('')
  const [forceBackground, setForceBackground] = useState(false)
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [caseResults, setCaseResults] = useState<{ case_name: string; score: number; passed: boolean; error?: string }[]>([])
  const caseCount = suite?.case_count || suite?.cases?.length || 0
  const autoBackground = caseCount >= 20

  const estimate = useMemo(() => {
    const minutes = Math.max(1, Math.ceil(caseCount * 0.35))
    const cost = caseCount * 0.004
    return { minutes, cost }
  }, [caseCount])

  useEffect(() => {
    if (!runId) return
    const relevant = events.filter(event => event.run_id === runId)
    const completed = relevant.filter(event => event.type === 'eval_case_completed')
    setCaseResults(completed.map(event => ({
      case_name: String(event.case_name || 'Case'),
      score: Number(event.score || 0),
      passed: Boolean(event.passed),
      error: event.error ? String(event.error) : undefined,
    })))
    if (relevant.some(event => event.type === 'eval_run_completed')) {
      setRunning(false)
      onFinished()
    }
  }, [events, runId, onFinished])

  useEffect(() => {
    if (!open) {
      setRunning(false)
      setRunId(null)
      setCaseResults([])
      setNotes('')
      setForceBackground(false)
    }
  }, [open])

  if (!open || !suite) return null

  const startRun = async () => {
    setRunning(true)
    setCaseResults([])
    try {
      const result = await evalsApi.runSuite(suite.id, { triggered_by: 'manual', notes })
      if ('task_id' in result) {
        setRunId(result.run_id)
        toast.success('Eval suite started in background')
      } else {
        setRunId(result.id)
        toast.success(result.passed ? 'Eval suite passed' : 'Eval suite failed')
        setRunning(false)
        onFinished()
      }
    } catch (error: any) {
      setRunning(false)
      toast.error(error.response?.data?.detail || 'Failed to start eval run')
    }
  }

  const progress = caseCount ? Math.min(100, (caseResults.length / caseCount) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.1] bg-obsidian-900 shadow-glow-md">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <div>
            <div className="font-semibold text-white">Run eval suite</div>
            <div className="mt-1 text-sm text-obsidian-400">{suite.name} · {caseCount} cases</div>
          </div>
          <button className="btn-ghost h-9 px-2" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid gap-3 md:grid-cols-3">
            <InfoPill label="Estimated time" value={`~${estimate.minutes} min`} />
            <InfoPill label="Estimated cost" value={`$${estimate.cost.toFixed(3)}`} />
            <InfoPill label="Threshold" value={`${Math.round((suite.pass_threshold || 0.8) * 100)}%`} />
          </div>

          <label>
            <span className="label">Notes</span>
            <textarea
              className="input min-h-24 resize-none"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Optional context for this run..."
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-sm font-medium text-white">Run in background</div>
              <div className="text-xs text-obsidian-500">Auto-enabled for suites with 20+ cases.</div>
            </div>
            <input
              type="checkbox"
              checked={autoBackground || forceBackground}
              disabled={autoBackground}
              onChange={event => setForceBackground(event.target.checked)}
            />
          </label>

          {running && (
            <div className="rounded-xl border border-accent-400/20 bg-accent-400/10 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-accent-100">Running cases</span>
                <span className="font-mono text-accent-200">{caseResults.length}/{caseCount}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-4 max-h-44 space-y-2 overflow-y-auto">
                {caseResults.map((result, index) => (
                  <div key={`${result.case_name}-${index}`} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm">
                    <span className={clsx(result.passed ? 'text-obsidian-200' : 'text-red-200')}>{result.case_name}</span>
                    <ScoreBadge score={result.score} size="sm" threshold={suite.pass_threshold} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-white/[0.08] px-6 py-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={startRun} disabled={running || !caseCount}>
            <Play size={16} /> Start Eval Run
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-obsidian-500">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

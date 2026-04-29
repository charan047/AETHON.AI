import { clsx } from 'clsx'

export function ScoreBadge({
  score,
  showPercent = true,
  size = 'md',
  threshold = 0.8,
}: {
  score?: number | null
  showPercent?: boolean
  size?: 'sm' | 'md' | 'lg'
  threshold?: number
}) {
  const empty = score === null || score === undefined || Number.isNaN(score)
  const good = !empty && score >= threshold
  const classes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-lg',
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full border font-mono font-semibold tabular-nums',
        classes[size],
        empty
          ? 'border-white/10 bg-white/[0.04] text-obsidian-500'
          : good
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
          : 'border-red-400/20 bg-red-400/10 text-red-300',
      )}
    >
      {empty ? '—' : showPercent ? `${Math.round(score * 100)}%` : score.toFixed(2)}
    </span>
  )
}

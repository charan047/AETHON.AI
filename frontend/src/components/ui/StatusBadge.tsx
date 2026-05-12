import { clsx } from 'clsx'

export type StatusKind = 'running' | 'idle' | 'completed' | 'failed' | 'waiting_approval' | 'pending' | 'active'

const styles: Record<StatusKind, { label: string; className: string; dot: string; pulse?: boolean }> = {
  running: { label: 'Running', className: 'border-blue-400/25 bg-blue-500/10 text-blue-300', dot: 'bg-blue-400', pulse: true },
  idle: { label: 'Idle', className: 'border-white/10 bg-white/[0.04] text-ink-secondary', dot: 'bg-ink-muted' },
  completed: { label: 'Completed', className: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400' },
  failed: { label: 'Failed', className: 'border-red-400/25 bg-red-400/10 text-red-300', dot: 'bg-red-400' },
  waiting_approval: { label: 'Awaiting Approval', className: 'border-amber-400/25 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400' },
  pending: { label: 'Pending', className: 'border-amber-400/25 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400' },
  active: { label: 'Active', className: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400' },
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusKind | string
  label?: string
  className?: string
}) {
  const style = styles[status as StatusKind] ?? styles.idle
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', style.className, className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot, style.pulse && 'animate-pulse')} />
      {label ?? style.label}
    </span>
  )
}

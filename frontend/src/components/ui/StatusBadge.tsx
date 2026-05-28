import { clsx } from 'clsx'

const STATUS_MAP: Record<string, { label: string; cls: string; live?: boolean }> = {
  completed: { label: 'done', cls: 'badge-emerald' },
  failed: { label: 'failed', cls: 'badge-red' },
  running: { label: 'running', cls: 'badge-indigo', live: true },
  pending_review: { label: 'Needs Review', cls: 'badge-amber', live: true },
  waiting_approval: { label: 'Needs Review', cls: 'badge-amber', live: true },
  pending: { label: 'pending', cls: 'badge-amber' },
  cancelled: { label: 'stopped', cls: 'badge-glass' },
  timed_out: { label: 'timeout', cls: 'badge-red' },
  approved: { label: 'approved', cls: 'badge-emerald' },
  rejected: { label: 'rejected', cls: 'badge-red' },
  active: { label: 'active', cls: 'badge-emerald' },
  idle: { label: 'idle', cls: 'badge-glass' },
  working: { label: 'working', cls: 'badge-indigo', live: true },
  blocked: { label: 'blocked', cls: 'badge-red' },
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string
  label?: string
  className?: string
}) {
  const config = STATUS_MAP[status] || { label: String(status || 'unknown').toLowerCase(), cls: 'badge-glass' }

  return (
    <span className={clsx('badge', config.cls, className)}>
      {config.live ? (
        <span className="relative flex h-1.5 w-1.5">
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping"
            style={{ background: 'currentColor' }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: 'currentColor' }}
          />
        </span>
      ) : null}
      {(label || config.label).toLowerCase()}
    </span>
  )
}

export default StatusBadge

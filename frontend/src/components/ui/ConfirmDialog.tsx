import { AlertTriangle, X } from 'lucide-react'
import { clsx } from 'clsx'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'warning' | 'default'
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  if (!open) return null

  const toneClass = tone === 'danger'
    ? 'border-red-400/20 bg-red-400/10 text-red-200'
    : tone === 'warning'
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
      : 'border-accent-400/20 bg-accent-400/10 text-accent-200'

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-xl" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-obsidian-900 shadow-glow-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b border-white/10 p-5">
          <div className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl border', toneClass)}>
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
            {description && <p className="mt-2 text-sm leading-6 text-obsidian-400">{description}</p>}
          </div>
          <button className="btn-ghost h-8 px-2" onClick={onClose} disabled={loading}>
            <X size={16} />
          </button>
        </div>
        <div className="flex justify-end gap-2 p-5">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>{cancelLabel}</button>
          <button
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

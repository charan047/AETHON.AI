import { AlertTriangle, Loader2, X } from 'lucide-react'
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
      : 'border-blue-400/20 bg-blue-500/10 text-blue-200'

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-elevated w-full max-w-md overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b border-white/[0.08] p-5">
          <div className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl border', toneClass)}>
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
            {description && <p className="mt-2 text-sm leading-6 text-ink-secondary">{description}</p>}
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
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Working...
              </>
            ) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

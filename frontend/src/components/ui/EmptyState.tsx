import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="relative mb-6">
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.08] bg-blue-600/10 text-blue-400 shadow-glow-sm">
          {icon}
        </div>
      </div>

      <h3 className="mb-2 text-lg font-semibold text-white">{title}</h3>

      <p className="mb-6 max-w-xs text-sm leading-relaxed text-ink-secondary">
        {description}
      </p>

      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary"
        >
          {action.label}
        </button>
      )}

      {secondaryAction && (
        <button
          onClick={secondaryAction.onClick}
          className="mt-3 text-xs text-ink-muted transition-colors hover:text-ink-secondary"
        >
          {secondaryAction.label}
        </button>
      )}
    </div>
  )
}

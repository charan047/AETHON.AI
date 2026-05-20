import type { ComponentType, ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }> | ReactNode
  title: string
  description?: string
  action?: (() => void) | { label: string; onClick: () => void }
  actionLabel?: string
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  dashed?: boolean
}

export function EmptyState({
  title,
  description,
  action,
  actionLabel,
  secondaryAction,
  icon: Icon,
  dashed = false,
}: EmptyStateProps) {
  const primaryAction = typeof action === 'function' ? { onClick: action, label: actionLabel || 'Get started' } : action
  const isIconComponent = typeof Icon === 'function'

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl px-6 py-12 text-center ${dashed ? 'border border-dashed border-white/[0.12]' : ''}`}
    >
      {Icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/15 bg-indigo-500/10">
          {isIconComponent ? <Icon size={22} className="text-indigo-400" /> : Icon}
        </div>
      ) : null}
      <p className="font-semibold text-ink-secondary">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-xs text-sm text-ink-muted">{description}</p>
      ) : null}
      {primaryAction ? (
        <button className="btn btn-secondary btn-sm mt-5" onClick={primaryAction.onClick}>
          {primaryAction.label}
        </button>
      ) : null}
      {secondaryAction ? (
        <button
          onClick={secondaryAction.onClick}
          className="mt-3 text-xs text-ink-muted transition-colors hover:text-ink-secondary"
        >
          {secondaryAction.label}
        </button>
      ) : null}
    </div>
  )
}

export default EmptyState

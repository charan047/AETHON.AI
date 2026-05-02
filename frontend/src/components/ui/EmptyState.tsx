interface EmptyStateProps {
  icon: string
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
        <div className="text-5xl">{icon}</div>
        <div className="absolute inset-0 scale-150 rounded-full bg-accent-purple blur-2xl opacity-30" />
      </div>

      <h3 className="mb-2 text-lg font-semibold text-white/80">{title}</h3>

      <p className="mb-6 max-w-xs text-sm leading-relaxed text-white/40">
        {description}
      </p>

      {action && (
        <button
          onClick={action.onClick}
          className="rounded-lg border border-accent-purple/30 bg-accent-purple/20 px-4 py-2 text-sm font-medium text-accent-purple transition-all hover:bg-accent-purple/30"
        >
          {action.label}
        </button>
      )}

      {secondaryAction && (
        <button
          onClick={secondaryAction.onClick}
          className="mt-3 text-xs text-white/25 transition-colors hover:text-white/40"
        >
          {secondaryAction.label}
        </button>
      )}
    </div>
  )
}

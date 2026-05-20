import type { ReactNode } from 'react'

export function PageShell({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={className ? `animate-in-up ${className}` : 'animate-in-up'}>
      <header className="page-header" style={{ viewTransitionName: 'page-header' }}>
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className={contentClassName ? contentClassName : 'p-6'}>
        {children}
      </div>
    </div>
  )
}

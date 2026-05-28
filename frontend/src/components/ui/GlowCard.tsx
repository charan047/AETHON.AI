import type { CSSProperties, ReactNode } from 'react'
import { clsx } from 'clsx'

type GlowColor = 'blue' | 'emerald' | 'amber' | 'red' | 'indigo' | 'cyan'

const glow: Record<GlowColor, string> = {
  blue: 'hover:shadow-card-hover',
  emerald: 'hover:shadow-glow-emerald',
  amber: 'hover:shadow-card-hover',
  red: 'hover:shadow-card-hover',
  indigo: 'hover:shadow-card-hover',
  cyan: 'hover:shadow-glow-emerald',
}

const activeGlow: Record<GlowColor, string> = {
  blue: 'shadow-card-hover border-blue-500/30',
  emerald: 'shadow-glow-emerald border-emerald-500/30',
  amber: 'shadow-card-hover border-amber-400/30',
  red: 'shadow-card-hover border-red-400/30',
  indigo: 'shadow-card-hover border-blue-500/30',
  cyan: 'shadow-glow-emerald border-emerald-500/30',
}

export function GlowCard({
  children,
  glowColor = 'indigo',
  hoverable = true,
  active = false,
  className,
  style,
}: {
  children: ReactNode
  glowColor?: GlowColor
  hoverable?: boolean
  active?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      style={style}
      className={clsx(
        'card rounded-2xl transition-all duration-150 ease-out',
        hoverable && ['hover:-translate-y-1', glow[glowColor], 'hover:border-white/[0.12]'],
        active && activeGlow[glowColor],
        className,
      )}
    >
      {children}
    </div>
  )
}

import type { CSSProperties, ReactNode } from 'react'
import { clsx } from 'clsx'

type GlowColor = 'indigo' | 'cyan' | 'amber' | 'red'

const glow: Record<GlowColor, string> = {
  indigo: 'hover:shadow-glow-md',
  cyan: 'hover:shadow-glow-cyan',
  amber: 'hover:shadow-glow-amber',
  red: 'hover:shadow-glow-red',
}

const activeGlow: Record<GlowColor, string> = {
  indigo: 'shadow-glow-md border-accent-400/30',
  cyan: 'shadow-glow-cyan border-cyan-400/30',
  amber: 'shadow-glow-amber border-amber-400/30',
  red: 'shadow-glow-red border-red-400/30',
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
        'rounded-xl border border-white/[0.08] bg-obsidian-900 transition-all duration-150 ease-out',
        hoverable && ['hover:-translate-y-1', glow[glowColor], 'hover:border-white/[0.12]'],
        active && activeGlow[glowColor],
        className,
      )}
    >
      {children}
    </div>
  )
}

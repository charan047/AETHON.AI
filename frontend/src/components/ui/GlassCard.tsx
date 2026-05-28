import type { ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { clsx } from 'clsx'

interface GlassCardProps extends HTMLMotionProps<'div'> {
  children?: ReactNode
  hover?: boolean
  glow?: 'purple' | 'cyan' | 'green' | 'none'
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const GLOW_CLASSES = {
  purple: 'hover:shadow-glow-blue hover:border-blue-500/20',
  cyan: 'hover:shadow-glow-emerald hover:border-emerald-400/20',
  green: 'hover:shadow-glow-emerald hover:border-emerald-500/20',
  none: '',
}

const PADDING_CLASSES = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export function GlassCard({
  hover = false,
  glow = 'none',
  padding = 'md',
  className,
  children,
  ...props
}: GlassCardProps) {
  return (
    <motion.div
      whileHover={hover ? { y: -1, scale: 1.002 } : undefined}
      className={clsx(
        'card relative rounded-2xl border border-white/[0.08] bg-base-surface bg-card shadow-card transition-shadow duration-200',
        hover && 'cursor-pointer hover:shadow-card-hover hover:border-white/[0.08]',
        glow !== 'none' && GLOW_CLASSES[glow],
        PADDING_CLASSES[padding],
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-white/8 to-transparent" />
      {children}
    </motion.div>
  )
}

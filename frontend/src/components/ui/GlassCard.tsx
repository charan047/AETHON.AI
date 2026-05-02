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
  purple: 'hover:shadow-glow-purple hover:border-accent-purple/20',
  cyan: 'hover:shadow-glow-cyan hover:border-accent-cyan/20',
  green: 'hover:shadow-glow-green hover:border-accent-green/20',
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
        'relative rounded-xl border border-white/[0.06] bg-base-200 bg-glass-card shadow-card transition-shadow duration-200',
        hover && 'cursor-pointer hover:shadow-card-hover hover:border-white/10',
        glow !== 'none' && GLOW_CLASSES[glow],
        PADDING_CLASSES[padding],
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-xl bg-gradient-to-r from-transparent via-white/8 to-transparent" />
      {children}
    </motion.div>
  )
}

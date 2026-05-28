import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../../lib/utils'
import type { ReactNode } from 'react'

export function AnimatedListItem({ children }: { children: ReactNode }) {
  const animations = {
    initial: { scale: 0.98, opacity: 0, y: 10 },
    animate: { scale: 1, opacity: 1, originY: 0, y: 0 },
    exit: { scale: 0.98, opacity: 0, y: -10 },
    transition: { type: 'spring', stiffness: 350, damping: 40 },
  } as const

  return (
    <motion.div {...animations} layout>
      {children}
    </motion.div>
  )
}

export function AnimatedList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AnimatePresence>{children}</AnimatePresence>
    </div>
  )
}

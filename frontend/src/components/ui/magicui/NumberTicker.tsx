import { useEffect, useRef } from 'react'
import { useInView, useMotionValue, useSpring } from 'framer-motion'
import { cn } from '../../../lib/utils'

export function NumberTicker({
  value,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
}: {
  value: number
  direction?: 'up' | 'down'
  delay?: number
  className?: string
  decimalPlaces?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionVal = useMotionValue(direction === 'down' ? value : 0)
  const springVal = useSpring(motionVal, { damping: 60, stiffness: 100 })
  const isInView = useInView(ref, { once: true, margin: '0px' })

  useEffect(() => {
    if (!isInView) return
    const timeout = window.setTimeout(() => {
      motionVal.set(direction === 'down' ? 0 : value)
    }, delay * 1000)
    return () => window.clearTimeout(timeout)
  }, [motionVal, isInView, delay, value, direction])

  useEffect(() => {
    return springVal.on('change', latest => {
      if (ref.current) {
        ref.current.textContent = Intl.NumberFormat('en-US', {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(Number(latest.toFixed(decimalPlaces)))
      }
    })
  }, [springVal, decimalPlaces])

  return (
    <span className={cn('font-mono tabular-nums tracking-tight', className)} ref={ref} />
  )
}

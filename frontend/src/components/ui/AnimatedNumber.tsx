import { useEffect, useState } from 'react'
import { useMotionValueEvent, useSpring } from 'framer-motion'

export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const spring = useSpring(0, {
    stiffness: 140,
    damping: 24,
    mass: 0.6,
  })

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  useMotionValueEvent(spring, 'change', latest => {
    setDisplay(latest)
  })

  return (
    <span className={className}>
      {prefix}
      {display.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  )
}

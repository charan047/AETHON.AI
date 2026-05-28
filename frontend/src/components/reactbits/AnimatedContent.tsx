import type { ReactNode } from 'react'
import UpstreamAnimatedContent from './upstream/AnimatedContent'

type Direction = 'vertical' | 'horizontal'

export function AnimatedContent({
  children,
  className,
  distance = 40,
  direction = 'vertical',
  reverse = false,
  duration = 0.5,
}: {
  children: ReactNode
  className?: string
  distance?: number
  direction?: Direction
  reverse?: boolean
  duration?: number
}) {
  return (
    <UpstreamAnimatedContent
      className={className}
      distance={distance}
      direction={direction}
      reverse={reverse}
      duration={duration}
      threshold={0}
      initialOpacity={0}
      animateOpacity
    >
      {children}
    </UpstreamAnimatedContent>
  )
}

import { cn } from '../../lib/utils'
import UpstreamDotGrid from './upstream/DotGrid'

export function DotGrid({
  className,
  dotColor = 'rgba(255,255,255,0.07)',
  gap = 20,
}: {
  className?: string
  dotColor?: string
  gap?: number
}) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <UpstreamDotGrid
        className="!p-0"
        gap={gap}
        dotSize={2}
        baseColor={dotColor}
        activeColor={dotColor}
        proximity={0}
        speedTrigger={Number.MAX_SAFE_INTEGER}
        shockRadius={0}
        shockStrength={0}
        resistance={1000}
        returnDuration={0}
      />
    </div>
  )
}

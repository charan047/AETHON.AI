import TrustRing, { TrustRing as NamedTrustRing } from './TrustRing'

export interface TrustScoreBarProps {
  score: number
  size?: number | 'xs' | 'sm' | 'md'
  radius?: number
  strokeWidth?: number
  className?: string
  totalTasks?: number
  showLabel?: boolean
  showNumber?: boolean
}

const SIZE_MAP = {
  xs: 32,
  sm: 36,
  md: 44,
} as const

export function TrustScoreBar({
  score,
  size = 'md',
  radius,
  strokeWidth,
  className,
  totalTasks,
}: TrustScoreBarProps) {
  const resolvedSize = typeof size === 'number' ? size : SIZE_MAP[size]
  return (
    <NamedTrustRing
      score={score}
      size={resolvedSize}
      radius={radius}
      strokeWidth={strokeWidth}
      className={className}
      totalTasks={totalTasks}
    />
  )
}

export default TrustRing

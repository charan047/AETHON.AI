function ringColor(score: number) {
  if (score >= 70) return '#10b981'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

type TrustRingProps = {
  score: number
  size?: number
  radius?: number
  strokeWidth?: number
  className?: string
  totalTasks?: number
}

function TrustRing({
  score,
  size = 44,
  radius,
  strokeWidth = 3,
  className,
  totalTasks,
}: TrustRingProps) {
  const safeScore = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0))
  const resolvedSize = radius ? radius * 2 : size
  const resolvedRadius = radius ?? resolvedSize / 2 - 4
  const circumference = 2 * Math.PI * resolvedRadius
  const dashOffset = circumference * (1 - safeScore / 100)
  const color = ringColor(safeScore)
  const showDash = safeScore === 50 && totalTasks === 0

  return (
    <span
      className={className ? `trust-ring-wrap ${className}` : 'trust-ring-wrap'}
      aria-label={showDash ? 'No trust score yet' : `Trust score ${Math.round(safeScore)}`}
      title={showDash ? 'No tasks yet' : `Trust score ${Math.round(safeScore)}`}
    >
      <svg width={resolvedSize} height={resolvedSize} viewBox={`0 0 ${resolvedSize} ${resolvedSize}`} aria-hidden="true">
        <circle
          cx={resolvedSize / 2}
          cy={resolvedSize / 2}
          r={resolvedRadius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={resolvedSize / 2}
          cy={resolvedSize / 2}
          r={resolvedRadius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          transform={`rotate(-90 ${resolvedSize / 2} ${resolvedSize / 2})`}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: dashOffset,
            transition: 'stroke-dashoffset 700ms cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      </svg>
      <span className="trust-ring-value" style={{ color }}>
        {showDash ? '–' : Math.round(safeScore)}
      </span>
    </span>
  )
}

export { TrustRing }
export const TrustScoreBar = TrustRing
export default TrustRing

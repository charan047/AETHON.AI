import { motion } from 'framer-motion'

interface TrustScoreBarProps {
  score: number
  showLabel?: boolean
  showNumber?: boolean
  size?: 'xs' | 'sm' | 'md'
}

function trustColor(score: number): string {
  if (score >= 85) return '#00FF9D'
  if (score >= 65) return '#6C63FF'
  if (score >= 40) return '#FFB800'
  return '#FF4D6D'
}

function trustLabel(score: number): string {
  if (score >= 85) return 'Autonomous'
  if (score >= 65) return 'Semi-Auto'
  if (score >= 40) return 'Supervised'
  return 'Restricted'
}

const HEIGHTS = { xs: 'h-px', sm: 'h-0.5', md: 'h-1' }

export function TrustScoreBar({
  score,
  showLabel = false,
  showNumber = true,
  size = 'sm',
}: TrustScoreBarProps) {
  const safeScore = Math.max(0, Math.min(100, score || 0))
  const color = trustColor(safeScore)
  const label = trustLabel(safeScore)

  return (
    <div className="w-full">
      {(showLabel || showNumber) && (
        <div className="mb-1 flex items-center justify-between">
          {showLabel && (
            <span className="text-xs" style={{ color }}>
              {label}
            </span>
          )}
          {showNumber && (
            <span className="font-mono text-xs font-semibold" style={{ color }}>
              {Math.round(safeScore)}%
            </span>
          )}
        </div>
      )}
      <div className={`w-full rounded-full bg-white/5 ${HEIGHTS[size]}`}>
        <motion.div
          className={`${HEIGHTS[size]} rounded-full`}
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${safeScore}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
        />
      </div>
    </div>
  )
}

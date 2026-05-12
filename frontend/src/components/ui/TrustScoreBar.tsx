import { motion, useReducedMotion } from 'framer-motion'
import { TRUST_SCORE_COLOR, TRUST_SCORE_LABEL } from '../../lib/design-tokens'

interface TrustScoreBarProps {
  score: number
  showLabel?: boolean
  showNumber?: boolean
  size?: 'xs' | 'sm' | 'md'
}

const HEIGHTS = { xs: 'h-px', sm: 'h-0.5', md: 'h-1' }

export function TrustScoreBar({
  score,
  showLabel = false,
  showNumber = true,
  size = 'sm',
}: TrustScoreBarProps) {
  const prefersReducedMotion = useReducedMotion()
  const safeScore = Math.max(0, Math.min(100, score || 0))
  const color = TRUST_SCORE_COLOR(safeScore)
  const label = TRUST_SCORE_LABEL(safeScore)

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
          initial={prefersReducedMotion ? false : { width: 0 }}
          animate={{ width: `${safeScore}%` }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.8, ease: 'easeOut', delay: 0.1 }}
        />
      </div>
    </div>
  )
}

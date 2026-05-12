import { motion, useReducedMotion } from 'framer-motion'

const STATUS_CONFIG = {
  working: { color: '#00FF9D', pulse: true, label: 'Working' },
  idle: { color: '#4A5568', pulse: false, label: 'Idle' },
  blocked: { color: '#FF4D6D', pulse: true, label: 'Blocked' },
  in_meeting: { color: '#FFB800', pulse: false, label: 'In Meeting' },
  reviewing: { color: '#818CF8', pulse: false, label: 'Reviewing' },
  waiting_approval: { color: '#F59E0B', pulse: true, label: 'Waiting' },
  queued: { color: '#9CA3AF', pulse: false, label: 'Queued' },
} as const

interface StatusDotProps {
  status: keyof typeof STATUS_CONFIG
  showLabel?: boolean
  size?: 'xs' | 'sm' | 'md'
}

const SIZES = { xs: 'w-1.5 h-1.5', sm: 'w-2 h-2', md: 'w-2.5 h-2.5' }

export function StatusDot({
  status,
  showLabel = false,
  size = 'sm',
}: StatusDotProps) {
  const prefersReducedMotion = useReducedMotion()
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex-shrink-0">
        <div className={`${SIZES[size]} rounded-full`} style={{ backgroundColor: config.color }} />
        {config.pulse && !prefersReducedMotion && (
          <motion.div
            className={`absolute inset-0 ${SIZES[size]} rounded-full`}
            style={{ backgroundColor: config.color }}
            animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
      </div>
      {showLabel && (
        <span className="text-xs" style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </div>
  )
}

export const STEP_CONFIG = {
  thought: {
    label: 'Thinking',
    icon: '🧠',
    borderColor: 'rgba(129,140,248,0.3)',
    bgColor: 'rgba(129,140,248,0.05)',
    textColor: '#818CF8',
  },
  action: {
    label: 'Action',
    icon: '⚡',
    borderColor: 'rgba(0,212,255,0.3)',
    bgColor: 'rgba(0,212,255,0.05)',
    textColor: '#00D4FF',
  },
  observation: {
    label: 'Observed',
    icon: '👁',
    borderColor: 'rgba(52,211,153,0.3)',
    bgColor: 'rgba(52,211,153,0.05)',
    textColor: '#34D399',
  },
  final_answer: {
    label: 'Completed',
    icon: '✅',
    borderColor: 'rgba(0,255,157,0.3)',
    bgColor: 'rgba(0,255,157,0.07)',
    textColor: '#00FF9D',
  },
  error: {
    label: 'Error',
    icon: '❌',
    borderColor: 'rgba(255,77,109,0.3)',
    bgColor: 'rgba(255,77,109,0.05)',
    textColor: '#FF4D6D',
  },
  human_input_required: {
    label: 'Waiting for approval',
    icon: '⏳',
    borderColor: 'rgba(255,184,0,0.3)',
    bgColor: 'rgba(255,184,0,0.05)',
    textColor: '#FFB800',
  },
  retry: {
    label: 'Retrying',
    icon: '🔄',
    borderColor: 'rgba(156,163,175,0.3)',
    bgColor: 'rgba(156,163,175,0.05)',
    textColor: '#9CA3AF',
  },
} as const

export type StepType = keyof typeof STEP_CONFIG

export const EXECUTION_STATUS_CONFIG = {
  queued: { label: 'Queued', color: '#9CA3AF', pulse: false },
  running: { label: 'Running', color: '#00FF9D', pulse: true },
  completed: { label: 'Completed', color: '#00D4FF', pulse: false },
  failed: { label: 'Failed', color: '#FF4D6D', pulse: false },
} as const

export const SENIORITY_COLORS: Record<number, { color: string; label: string }> = {
  1: { color: '#4ADE80', label: 'SDE 1' },
  2: { color: '#22D3EE', label: 'SDE 2' },
  3: { color: '#818CF8', label: 'Senior' },
  4: { color: '#C084FC', label: 'Tech Lead' },
  5: { color: '#FCD34D', label: 'Director' },
}

export const AUTONOMY_COLORS: Record<string, { color: string; label: string }> = {
  restricted: { color: '#FF4D6D', label: 'Restricted' },
  supervised: { color: '#FFB800', label: 'Supervised' },
  semi_autonomous: { color: '#6C63FF', label: 'Semi-Auto' },
  autonomous: { color: '#00FF9D', label: 'Autonomous' },
}

export const TRUST_SCORE_COLOR = (score: number): string => {
  if (score >= 85) return '#00FF9D'
  if (score >= 65) return '#6C63FF'
  if (score >= 40) return '#FFB800'
  return '#FF4D6D'
}

export const TRUST_SCORE_LABEL = (score: number): string => {
  if (score >= 85) return 'Autonomous'
  if (score >= 65) return 'Semi-Auto'
  if (score >= 40) return 'Supervised'
  return 'Restricted'
}

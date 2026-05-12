export const STEP_CONFIG = {
  thought: {
    label: 'Thinking',
    icon: '•',
    borderColor: 'rgba(96,165,250,0.3)',
    bgColor: 'rgba(96,165,250,0.05)',
    textColor: '#60A5FA',
  },
  action: {
    label: 'Action',
    icon: '→',
    borderColor: 'rgba(52,211,153,0.3)',
    bgColor: 'rgba(52,211,153,0.05)',
    textColor: '#34D399',
  },
  observation: {
    label: 'Observed',
    icon: '○',
    borderColor: 'rgba(52,211,153,0.3)',
    bgColor: 'rgba(52,211,153,0.05)',
    textColor: '#34D399',
  },
  final_answer: {
    label: 'Completed',
    icon: '✓',
    borderColor: 'rgba(16,185,129,0.3)',
    bgColor: 'rgba(16,185,129,0.07)',
    textColor: '#10B981',
  },
  speaking: {
    label: 'Speaking',
    icon: '≋',
    borderColor: 'rgba(59,130,246,0.4)',
    bgColor: 'rgba(59,130,246,0.06)',
    textColor: '#3B82F6',
  },
  update: {
    label: 'Update',
    icon: '•',
    borderColor: 'rgba(37,99,235,0.4)',
    bgColor: 'rgba(37,99,235,0.06)',
    textColor: '#2563EB',
  },
  error: {
    label: 'Error',
    icon: '!',
    borderColor: 'rgba(248,113,113,0.3)',
    bgColor: 'rgba(248,113,113,0.05)',
    textColor: '#F87171',
  },
  human_input_required: {
    label: 'Waiting for approval',
    icon: '…',
    borderColor: 'rgba(251,191,36,0.3)',
    bgColor: 'rgba(251,191,36,0.05)',
    textColor: '#FBBF24',
  },
  retry: {
    label: 'Retrying',
    icon: '↻',
    borderColor: 'rgba(156,163,175,0.3)',
    bgColor: 'rgba(156,163,175,0.05)',
    textColor: '#9CA3AF',
  },
} as const

export type StepType = keyof typeof STEP_CONFIG

export const EXECUTION_STATUS_CONFIG = {
  queued: { label: 'Queued', color: '#9CA3AF', pulse: false },
  running: { label: 'Running', color: '#10B981', pulse: true },
  completed: { label: 'Completed', color: '#3B82F6', pulse: false },
  cancelled: { label: 'Cancelled', color: '#8B9DBE', pulse: false },
  timed_out: { label: 'Timed Out', color: '#64748B', pulse: false },
  rejected: { label: 'Rejected', color: '#F59E0B', pulse: false },
  failed: { label: 'Failed', color: '#F87171', pulse: false },
} as const

export const SENIORITY_COLORS: Record<number, { color: string; label: string }> = {
  1: { color: '#4ADE80', label: 'Junior' },
  2: { color: '#34D399', label: 'Mid-level' },
  3: { color: '#60A5FA', label: 'Senior' },
  4: { color: '#3B82F6', label: 'Lead' },
  5: { color: '#F59E0B', label: 'Director' },
}

export const AUTONOMY_COLORS: Record<string, { color: string; label: string }> = {
  restricted: { color: '#F87171', label: 'Restricted' },
  supervised: { color: '#FBBF24', label: 'Supervised' },
  semi_autonomous: { color: '#60A5FA', label: 'Semi-Auto' },
  autonomous: { color: '#34D399', label: 'Autonomous' },
}

export const TRUST_SCORE_COLOR = (score: number): string => {
  if (score >= 85) return '#2563EB'
  if (score >= 65) return '#10B981'
  if (score >= 40) return '#FBBF24'
  return '#F87171'
}

export const TRUST_SCORE_LABEL = (score: number): string => {
  if (score >= 85) return 'Autonomous'
  if (score >= 65) return 'Semi-Auto'
  if (score >= 40) return 'Supervised'
  return 'Restricted'
}

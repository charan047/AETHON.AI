export const STEP_CONFIG = {
  thought: {
    label: 'Thinking',
    icon: '•',
    borderColor: '#818cf8',
    bgColor: 'rgba(129,140,248,0.10)',
    textColor: '#818cf8',
  },
  action: {
    label: 'Action',
    icon: '→',
    borderColor: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.10)',
    textColor: '#f59e0b',
  },
  observation: {
    label: 'Observed',
    icon: '○',
    borderColor: 'rgba(139,157,190,0.28)',
    bgColor: 'rgba(255,255,255,0.03)',
    textColor: '#8B9DBE',
  },
  tool_call: {
    label: 'Tool',
    icon: '⋯',
    borderColor: '#6366f1',
    bgColor: 'rgba(99,102,241,0.10)',
    textColor: '#6366f1',
  },
  final_answer: {
    label: 'Completed',
    icon: '✓',
    borderColor: '#10b981',
    bgColor: 'rgba(16,185,129,0.10)',
    textColor: '#10b981',
  },
  speaking: {
    label: 'Speaking',
    icon: '≋',
    borderColor: '#6366f1',
    bgColor: 'rgba(99,102,241,0.10)',
    textColor: '#6366f1',
  },
  update: {
    label: 'Update',
    icon: '•',
    borderColor: '#6366f1',
    bgColor: 'rgba(99,102,241,0.10)',
    textColor: '#6366f1',
  },
  error: {
    label: 'Error',
    icon: '!',
    borderColor: '#ef4444',
    bgColor: 'rgba(239,68,68,0.10)',
    textColor: '#ef4444',
  },
  human_input_required: {
    label: 'Needs approval',
    icon: '…',
    borderColor: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.10)',
    textColor: '#f59e0b',
  },
  retry: {
    label: 'Retrying',
    icon: '↻',
    borderColor: 'rgba(255,255,255,0.12)',
    bgColor: 'rgba(255,255,255,0.04)',
    textColor: 'rgba(255,255,255,0.50)',
  },
} as const

export type StepType = keyof typeof STEP_CONFIG

export const EXECUTION_STATUS_CONFIG = {
  queued: { label: 'Queued', color: 'rgba(255,255,255,0.35)', pulse: false },
  running: { label: 'Running', color: '#6366f1', pulse: true },
  pending_review: { label: 'Needs Review', color: '#f59e0b', pulse: true },
  completed: { label: 'Completed', color: '#10b981', pulse: false },
  cancelled: { label: 'Cancelled', color: 'rgba(255,255,255,0.35)', pulse: false },
  timed_out: { label: 'Timed Out', color: '#ef4444', pulse: false },
  rejected: { label: 'Rejected', color: '#ef4444', pulse: false },
  failed: { label: 'Failed', color: '#ef4444', pulse: false },
} as const

export const ROLE_COLOR: Record<string, string> = {
  researcher: '#818cf8',
  market_researcher: '#818cf8',
  analyst: '#10b981',
  strategist: '#a78bfa',
  operator: '#f59e0b',
  outreach: '#f59e0b',
  support: '#a78bfa',
  writer: '#10b981',
  content: '#10b981',
  sales: '#f59e0b',
  finance: '#ef4444',
  legal: '#ef4444',
  default: '#6366f1',
}

export const SENIORITY_COLORS: Record<number, { color: string; label: string }> = {
  1: { color: 'rgba(255,255,255,0.25)', label: 'Junior' },
  2: { color: 'rgba(255,255,255,0.35)', label: 'Mid-level' },
  3: { color: '#6366f1', label: 'Senior' },
  4: { color: '#f59e0b', label: 'Lead' },
  5: { color: '#10b981', label: 'Director' },
}

export const AUTONOMY_COLORS: Record<string, { color: string; label: string }> = {
  restricted: { color: '#ef4444', label: 'Restricted' },
  supervised: { color: '#f59e0b', label: 'Supervised' },
  semi_autonomous: { color: '#6366f1', label: 'Semi-Auto' },
  autonomous: { color: '#10b981', label: 'Autonomous' },
}

export const TRUST_SCORE_COLOR = (score: number): string => {
  if (score >= 70) return '#10b981'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export const TRUST_SCORE_LABEL = (score: number): string => {
  if (score >= 70) return 'Autonomous'
  if (score >= 40) return 'Supervised'
  return 'Restricted'
}

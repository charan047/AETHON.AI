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

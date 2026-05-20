import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { executionsApi, workflowsApi } from '../../api/client'
import { useWebSocket } from '../../contexts/WebSocketContext'
import { EXECUTION_STATUS_CONFIG, STEP_CONFIG, type StepType } from '../../lib/design-tokens'
import { MarkdownContent } from '../ui/MarkdownContent'

type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'pending_review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'rejected'

const TERMINAL_EXECUTION_STATUSES: ExecutionStatus[] = [
  'pending_review',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'rejected',
]

export interface LiveExecutionStep {
  id?: string
  step_type: StepType
  content: string
  tool_name?: string | null
  tool_input?: unknown
  tool_output?: unknown
  tool_success?: boolean | null
  step_index: number
  duration_ms?: number | null
  timestamp?: string
  created_at?: string
  agent_id?: string | null
  agent_name?: string | null
}

interface ExecutionLiveViewProps {
  executionId: string
  agentName?: string
  modelName?: string
  initialInput?: string
  onComplete?: (result: string) => void
  onError?: (error: string) => void
  existingSteps?: LiveExecutionStep[]
  initialStatus?: ExecutionStatus | 'pending' | 'waiting_approval' | 'rejected' | 'timed_out'
  maxHeight?: string
}

type StandupParticipant = {
  agentId: string
  agentName: string
}

type StandupEntry = {
  agentId: string
  agentName: string
  content: string
  status: 'waiting' | 'thinking' | 'done'
  thoughts: string[]
  timestamp: string
}

type CeoThreadMessage = {
  id: string
  content: string
  createdAt: string
}

const EMPTY_STEPS: LiveExecutionStep[] = []

function normalizeStatus(status: ExecutionLiveViewProps['initialStatus']): ExecutionStatus {
  if (
    status === 'pending_review' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timed_out' ||
    status === 'rejected' ||
    status === 'running' ||
    status === 'queued'
  ) {
    return status
  }
  return 'queued'
}

function normalizeStep(step: LiveExecutionStep): LiveExecutionStep {
  return {
    ...step,
    timestamp: step.timestamp || step.created_at,
  }
}

function stepKey(step: LiveExecutionStep, index: number) {
  return step.id || `${step.step_type}-${step.agent_name || 'agent'}-${step.step_index}-${index}`
}

function StepCard({ step }: { step: LiveExecutionStep }) {
  const [expanded, setExpanded] = useState(step.step_type === 'final_answer' || step.step_type === 'error')
  const config = STEP_CONFIG[step.step_type] ?? STEP_CONFIG.observation
  const renderAsMarkdown = step.step_type === 'final_answer' || (step.step_type === 'observation' && step.content.length > 200)
  const toolInput =
    step.tool_input && typeof step.tool_input === 'object'
      ? (step.tool_input as Record<string, unknown>)
      : null
  const hasToolDetail = Boolean(toolInput && Object.keys(toolInput).length > 0)

  const leftBorderColor =
    step.step_type === 'final_answer'
      ? 'rgba(16,185,129,0.70)'
      : step.step_type === 'error'
        ? 'rgba(239,68,68,0.70)'
        : step.step_type === 'action'
          ? 'rgba(245,158,11,0.60)'
          : step.step_type === 'thought'
            ? 'rgba(255,255,255,0.15)'
            : step.step_type === 'observation'
              ? 'rgba(255,255,255,0.10)'
              : step.step_type === 'tool_call'
                ? 'rgba(99,102,241,0.60)'
                : 'rgba(255,255,255,0.12)'

  const cardBackground =
    step.step_type === 'final_answer'
      ? 'linear-gradient(180deg, rgba(16,185,129,0.08) 0%, rgba(12,17,33,0.96) 100%)'
      : 'rgba(8,13,26,0.88)'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="overflow-hidden rounded-lg border-l-2"
      data-testid="execution-step"
      style={{
        background: cardBackground,
        borderTop: `1px solid ${config.borderColor}`,
        borderRight: `1px solid ${config.borderColor}`,
        borderBottom: `1px solid ${config.borderColor}`,
        borderLeftColor: leftBorderColor,
        boxShadow: step.step_type === 'final_answer' ? '0 10px 24px rgba(0,0,0,0.20)' : 'none',
      }}
    >
      <div
        className="flex cursor-pointer select-none items-center justify-between px-3 py-2.5"
        onClick={() => hasToolDetail && setExpanded(value => !value)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex-shrink-0 text-sm">{config.icon}</span>
          <span
            className="flex-shrink-0 text-xs font-semibold uppercase tracking-wider"
            style={{ color: config.textColor }}
          >
            {config.label}
          </span>
          {step.agent_name && (
            <>
              <span className="text-xs text-white/20">•</span>
              <span className="truncate text-xs text-white/55">{step.agent_name}</span>
            </>
          )}
          {step.tool_name && (
            <>
              <span className="text-xs text-white/20">—</span>
              <code className="truncate font-mono text-xs" style={{ color: config.textColor }}>
                {step.tool_name}
              </code>
            </>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {step.duration_ms != null && (
            <span className="font-mono text-xs text-white/25">{step.duration_ms}ms</span>
          )}
          {step.tool_success === false && <span className="text-xs text-red-400">failed</span>}
          {hasToolDetail && (
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} className="text-xs text-white/20">
              ▾
            </motion.span>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && hasToolDetail && toolInput && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 font-mono text-xs text-white/40">
                {JSON.stringify(toolInput, null, 2)
                  .split('\n')
                  .slice(0, 6)
                  .join('\n')}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-3 pb-3">
        {renderAsMarkdown ? (
          <MarkdownContent
            content={step.content}
            className={step.step_type === 'final_answer' ? 'text-[15px] text-white/90' : 'text-white/75'}
          />
        ) : (
          <p
            className={[
              'whitespace-pre-wrap break-words text-sm leading-relaxed',
              step.step_type === 'final_answer' ? 'text-[15px] text-white/90' : 'text-white/65',
            ].join(' ')}
          >
            {step.content}
          </p>
        )}
      </div>
    </motion.div>
  )
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <div className="flex gap-1">
        {[0, 150, 300].map(delay => (
          <motion.div
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-white/20"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: delay / 1000 }}
          />
        ))}
      </div>
      <span className="text-xs text-white/30">{label}</span>
    </div>
  )
}

function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'A'
}

function StandupThread({
  executionId,
  steps,
  isLive,
}: {
  executionId: string
  steps: LiveExecutionStep[]
  isLive: boolean
}) {
  const [ceoMessage, setCeoMessage] = useState('')
  const [ceoMessages, setCeoMessages] = useState<CeoThreadMessage[]>([])
  const executionQuery = useQuery({
    queryKey: ['execution-live-meta', executionId],
    queryFn: () => executionsApi.get(executionId),
    staleTime: 15_000,
  })
  const workflowQuery = useQuery({
    queryKey: ['execution-live-workflow', executionQuery.data?.workflow_id],
    queryFn: () => workflowsApi.get(executionQuery.data!.workflow_id),
    enabled: Boolean(executionQuery.data?.workflow_id),
    staleTime: 15_000,
  })

  const participants = useMemo<StandupParticipant[]>(() => {
    const ordered = new Map<string, StandupParticipant>()
    const nodes = workflowQuery.data?.nodes || []
    for (const node of nodes) {
      const data = node.data || {}
      const agentId = typeof data.agent_id === 'string' ? data.agent_id : ''
      if (!agentId || ordered.has(agentId)) continue
      const name = typeof data.label === 'string' && data.label.trim()
        ? data.label.trim()
        : `Agent ${ordered.size + 1}`
      ordered.set(agentId, { agentId, agentName: name })
    }

    for (const step of steps) {
      const agentId = step.agent_id || step.agent_name || ''
      const agentName = step.agent_name || 'Agent'
      if (agentId && !ordered.has(agentId)) {
        ordered.set(agentId, { agentId, agentName })
      }
    }

    return Array.from(ordered.values())
  }, [steps, workflowQuery.data])

  const agentMessages = useMemo<StandupEntry[]>(() => {
    const byAgent = new Map<string, StandupEntry>()

    for (const participant of participants) {
      byAgent.set(participant.agentId || participant.agentName, {
        agentId: participant.agentId,
        agentName: participant.agentName,
        content: '',
        status: 'waiting',
        thoughts: [],
        timestamp: '',
      })
    }

    const sortedSteps = [...steps].sort((a, b) => a.step_index - b.step_index)
    for (const step of sortedSteps) {
      const key = step.agent_id || step.agent_name
      if (!key) continue
      if (!byAgent.has(key)) {
        byAgent.set(key, {
          agentId: step.agent_id || '',
          agentName: step.agent_name || 'Agent',
          content: '',
          status: 'waiting',
          thoughts: [],
          timestamp: '',
        })
      }

      const entry = byAgent.get(key)!
      if (step.step_type === 'thought') {
        entry.status = 'thinking'
        entry.thoughts = [...entry.thoughts, step.content].slice(-4)
        entry.timestamp = step.timestamp || entry.timestamp
      }
      if (step.step_type === 'final_answer') {
        entry.content = step.content
        entry.status = 'done'
        entry.timestamp = step.timestamp || entry.timestamp
      }
      if (step.step_type === 'error' && entry.status !== 'done') {
        entry.content = step.content
        entry.status = 'done'
        entry.timestamp = step.timestamp || entry.timestamp
      }
    }

    return Array.from(byAgent.values())
  }, [participants, steps])

  const standupSummary = useMemo(() => {
    const summaries = steps
      .filter(step => step.step_type === 'update')
      .sort((a, b) => a.step_index - b.step_index)
    return summaries.length ? summaries[summaries.length - 1] : null
  }, [steps])

  const completedCount = agentMessages.filter(agent => agent.status === 'done').length

  const sendCeoMessage = () => {
    if (!ceoMessage.trim()) return
    setCeoMessages(prev => [
      ...prev,
      {
        id: `ceo-${Date.now()}`,
        content: ceoMessage.trim(),
        createdAt: new Date().toISOString(),
      },
    ])
    setCeoMessage('')
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="mb-4 flex items-center gap-3 border-b border-white/[0.06] pb-4">
        <div className="text-sm font-medium text-white/70">
          Standup Call · {agentMessages.length} agents
        </div>
        <div className="text-xs text-white/30">{completedCount} completed</div>
        {isLive && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {agentMessages.map((agent, index) => (
          <div key={`${agent.agentId}-${agent.agentName}`} className="flex gap-3">
            <div
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] text-sm font-semibold text-white"
              style={{
                background: `linear-gradient(135deg, rgba(${80 + index * 24}, ${105 + index * 12}, 255, 0.20), rgba(14, 165, 233, 0.12))`,
              }}
            >
              {initials(agent.agentName)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-sm font-medium text-white">
                  {agent.agentName}
                </span>
                {agent.status === 'done' && agent.timestamp && (
                  <span className="text-xs text-white/30">
                    {new Date(agent.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
                {agent.status === 'thinking' && (
                  <span className="flex items-center gap-1 text-xs text-emerald-200/70">
                    <span className="h-1 w-1 rounded-full bg-emerald-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1 w-1 rounded-full bg-emerald-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-1 w-1 rounded-full bg-emerald-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                    Speaking...
                  </span>
                )}
                {agent.status === 'waiting' && (
                  <span className="text-xs text-white/20">Waiting...</span>
                )}
              </div>

              {agent.status === 'done' ? (
                <div className="rounded-2xl rounded-tl-sm border border-white/[0.08] bg-base-surface px-4 py-3 text-sm leading-relaxed text-white/85 whitespace-pre-wrap">
                  {agent.content}
                </div>
              ) : agent.status === 'thinking' ? (
                <div className="rounded-2xl rounded-tl-sm border border-emerald-300/10 bg-emerald-300/[0.04] px-4 py-3 text-sm text-white/40 italic">
                  {agent.thoughts[agent.thoughts.length - 1] || 'Thinking...'}
                </div>
              ) : (
                <div className="rounded-2xl rounded-tl-sm border border-white/[0.03] bg-obsidian-900/30 px-4 py-3 text-sm text-white/15 italic">
                  Waiting for their turn...
                </div>
              )}
            </div>
          </div>
        ))}

        {ceoMessages.map(message => (
          <div key={message.id} className="flex justify-end gap-3">
            <div className="min-w-0 max-w-[78%]">
              <div className="mb-1.5 flex items-center justify-end gap-2">
                <span className="text-xs text-white/30">
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-sm font-medium text-white">CEO</span>
              </div>
              <div className="rounded-2xl rounded-tr-sm border border-indigo-purple/20 bg-indigo-purple/12 px-4 py-3 text-sm leading-relaxed text-white/90 whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
            <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-purple/20 bg-indigo-purple/12 text-sm font-semibold text-white">
              C
            </div>
          </div>
        ))}

        {standupSummary && (
          <div className="mt-2 rounded-2xl border border-indigo-400/20 bg-indigo-500/8 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-indigo-200/80">
              <span>Standup Summary</span>
              <span className="text-white/20">•</span>
              <span className="text-white/35 normal-case tracking-normal">
                {new Date(standupSummary.timestamp || standupSummary.created_at || new Date().toISOString()).toLocaleString()}
              </span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/82">
              {standupSummary.content}
            </div>
          </div>
        )}
      </div>

      {isLive && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs text-white/30">
            <span>You can send a message to redirect the standup</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={ceoMessage}
              onChange={event => setCeoMessage(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  sendCeoMessage()
                }
              }}
              placeholder="Ask a question or redirect..."
              className="flex-1 rounded-xl border border-white/[0.08] bg-base-surface px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-indigo-400/40"
            />
            <button
              type="button"
              onClick={sendCeoMessage}
              disabled={!ceoMessage.trim()}
              className="rounded-xl border border-indigo-purple/20 bg-indigo-purple/12 px-4 py-2.5 text-sm text-indigo-100 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ExecutionLiveView({
  executionId,
  agentName = 'Agent',
  modelName,
  initialInput,
  onComplete,
  onError,
  existingSteps,
  initialStatus = 'queued',
  maxHeight = '600px',
}: ExecutionLiveViewProps) {
  const initialSteps = useMemo(
    () => (existingSteps ?? EMPTY_STEPS).map(normalizeStep),
    [existingSteps],
  )
  const [steps, setSteps] = useState<LiveExecutionStep[]>(() => initialSteps)
  const [status, setStatus] = useState<ExecutionStatus>(normalizeStatus(initialStatus))
  const [finalResult, setFinalResult] = useState<string | null>(null)
  const [currentToolName, setCurrentToolName] = useState<string | null>(null)
  const [channelError, setChannelError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const completionNotifiedRef = useRef(false)
  const errorNotifiedRef = useRef(false)
  const subscriptionActiveRef = useRef(false)
  const { subscribe, unsubscribe, connected } = useWebSocket()
  const executionQuery = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.get(executionId),
    staleTime: 0,
    refetchInterval: query => {
      const nextStatus = normalizeStatus(query.state.data?.status)
      if (query.state.data && TERMINAL_EXECUTION_STATUSES.includes(nextStatus)) {
        return false
      }
      return 3000
    },
    refetchIntervalInBackground: false,
  })
  const workflowQuery = useQuery({
    queryKey: ['execution-live-view-workflow', executionQuery.data?.workflow_id],
    queryFn: () => workflowsApi.get(executionQuery.data!.workflow_id),
    enabled: Boolean(executionQuery.data?.workflow_id),
    staleTime: 15_000,
  })

  useEffect(() => {
    setSteps(initialSteps)
    setStatus(normalizeStatus(initialStatus))
    setFinalResult(null)
    setCurrentToolName(null)
    setChannelError(null)
    completionNotifiedRef.current = false
    errorNotifiedRef.current = false
  }, [executionId, initialSteps, initialStatus])

  const mergeIncomingSteps = (incoming: LiveExecutionStep[]) => {
    setSteps(prev => {
      const merged = new Map<number, LiveExecutionStep>()
      for (const step of prev) {
        merged.set(step.step_index, step)
      }
      for (const rawStep of incoming) {
        const step = normalizeStep(rawStep)
        const existing = merged.get(step.step_index)
        merged.set(step.step_index, {
          ...existing,
          ...step,
          agent_id: step.agent_id ?? existing?.agent_id ?? null,
          agent_name: step.agent_name ?? existing?.agent_name ?? null,
        })
      }
      return Array.from(merged.values()).sort((a, b) => a.step_index - b.step_index)
    })
  }

  const stopExecutionChannel = () => {
    const channel = `execution:${executionId}`
    if (!subscriptionActiveRef.current) {
      return
    }
    unsubscribe(channel)
    subscriptionActiveRef.current = false
  }

  useEffect(() => {
    const channel = `execution:${executionId}`
    subscriptionActiveRef.current = true

    subscribe(channel, (message: any) => {
      if (message.event === 'execution_step') {
        const step = normalizeStep(message.step as LiveExecutionStep)
        setChannelError(null)
        setStatus(prev => (prev === 'queued' ? 'running' : prev))
        mergeIncomingSteps([step])

        if (step.step_type === 'action' && step.tool_name) {
          setCurrentToolName(step.tool_name)
        }
        if (step.step_type === 'observation') {
          setCurrentToolName(null)
        }
        if (step.step_type === 'final_answer') {
          setCurrentToolName(null)
          setFinalResult(step.content)
        }
        if (step.step_type === 'error') {
          setStatus('failed')
          setCurrentToolName(null)
          setChannelError(step.content)
          stopExecutionChannel()
          if (!errorNotifiedRef.current) {
            errorNotifiedRef.current = true
            onError?.(step.content)
          }
        }
      }

      if (message.event === 'agent_spoke') {
        const syntheticStep: LiveExecutionStep = {
          id: `spoke-${message.agent_id}-${Date.now()}`,
          step_type: 'final_answer',
          content: String(message.message || ''),
          agent_name: message.agent_name ? String(message.agent_name) : null,
          agent_id: message.agent_id ? String(message.agent_id) : null,
          step_index: typeof message.step_index === 'number'
            ? message.step_index
            : Date.now(),
          timestamp: typeof message.timestamp === 'string' ? message.timestamp : new Date().toISOString(),
        }
        setSteps(prev => {
          const exists = prev.some(step =>
            step.agent_name === syntheticStep.agent_name && step.step_type === 'final_answer',
          )
          const next = exists
            ? prev.map(step =>
                step.agent_name === syntheticStep.agent_name && step.step_type === 'final_answer'
                  ? { ...step, ...syntheticStep }
                  : step,
              )
            : [...prev, syntheticStep]
          return next.sort((a, b) => a.step_index - b.step_index)
        })
      }

      if (message.event === 'execution_complete') {
        const nextStatus = normalizeStatus(message.status)
        setStatus(nextStatus)
        setCurrentToolName(null)
        if (TERMINAL_EXECUTION_STATUSES.includes(nextStatus)) {
          stopExecutionChannel()
        }
      }

      if (message.event === 'execution_pending_review') {
        setStatus('pending_review')
        setCurrentToolName(null)
        stopExecutionChannel()
      }

      if (message.event === 'execution_failed') {
        const nextStatus = normalizeStatus(message.status ?? 'failed')
        setStatus(nextStatus)
        setCurrentToolName(null)
        stopExecutionChannel()
        const error = message.error ?? (
          nextStatus === 'cancelled'
            ? 'Execution cancelled'
            : nextStatus === 'timed_out'
              ? 'Execution timed out'
              : nextStatus === 'rejected'
                ? 'Execution rejected'
                : 'Execution failed'
        )
        setChannelError(error)
        if (!errorNotifiedRef.current) {
          errorNotifiedRef.current = true
          onError?.(error)
        }
      }
    })

    return () => {
      unsubscribe(channel)
      subscriptionActiveRef.current = false
    }
  }, [executionId, subscribe, unsubscribe, onComplete, onError])

  useEffect(() => {
    const execution = executionQuery.data
    if (!execution) {
      return
    }

    mergeIncomingSteps(execution.steps || [])

    const nextStatus = normalizeStatus(execution.status)
    setStatus(nextStatus)

    if (execution.output_message) {
      setFinalResult(execution.output_message)
    }

    if (execution.output_message) {
      setSteps(prev => {
        const hasFinalAnswer = prev.some(step => step.step_type === 'final_answer')
        if (hasFinalAnswer) {
          return prev
        }
        return [
          ...prev,
          {
            id: `synthetic-final-${execution.id}`,
            step_type: 'final_answer',
            content: execution.output_message,
            step_index: prev.length ? Math.max(...prev.map(step => step.step_index)) + 1 : 0,
            timestamp: execution.completed_at || execution.started_at,
            created_at: execution.completed_at || execution.started_at,
          },
        ]
      })
    }

    if (TERMINAL_EXECUTION_STATUSES.includes(nextStatus)) {
      stopExecutionChannel()
    }

    if (nextStatus === 'pending_review') {
      setCurrentToolName(null)
      return
    }

    if (nextStatus === 'completed') {
      setCurrentToolName(null)
      const finalText =
        execution.output_message ||
        execution.steps?.find(step => step.step_type === 'final_answer')?.content ||
        ''
      if (finalText && !completionNotifiedRef.current) {
        completionNotifiedRef.current = true
        setStatus('completed')
        onComplete?.(finalText)
      }
      return
    }

    if (nextStatus === 'failed' || nextStatus === 'cancelled' || nextStatus === 'timed_out' || nextStatus === 'rejected') {
      setCurrentToolName(null)
      const error =
        execution.error ||
        execution.steps?.find(step => step.step_type === 'error')?.content ||
        (nextStatus === 'cancelled'
          ? 'Execution cancelled'
          : nextStatus === 'timed_out'
            ? 'Execution timed out'
            : nextStatus === 'rejected'
              ? 'Execution rejected'
              : 'Execution failed')
      setChannelError(error)
      if (!errorNotifiedRef.current) {
        errorNotifiedRef.current = true
        onError?.(error)
      }
    }
  }, [executionQuery.data, onComplete, onError])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length, currentToolName, status])

  const statusConfig = EXECUTION_STATUS_CONFIG[status] ?? EXECUTION_STATUS_CONFIG.failed
  const stepCount = steps.length
  const isLive = status === 'running' || status === 'queued'
  const latestStep = useMemo(() => (steps.length ? steps[steps.length - 1] : null), [steps])
  const loadingState = executionQuery.isLoading && !steps.length
  const errorState = executionQuery.isError && !steps.length
  const workflowParticipants = useMemo<StandupParticipant[]>(() => {
    const ordered = new Map<string, StandupParticipant>()
    for (const node of workflowQuery.data?.nodes || []) {
      const data = node.data || {}
      const agentId = typeof data.agent_id === 'string' ? data.agent_id : ''
      if (!agentId || ordered.has(agentId)) continue
      const agentLabel = typeof data.label === 'string' && data.label.trim()
        ? data.label.trim()
        : `Agent ${ordered.size + 1}`
      ordered.set(agentId, { agentId, agentName: agentLabel })
    }
    return Array.from(ordered.values())
  }, [workflowQuery.data])
  const isStandupMode = useMemo(() => {
    const speakingAgents = new Set(
      steps
        .filter(step => step.agent_name)
        .map(step => step.agent_name as string),
    )
    return workflowParticipants.length >= 2 && speakingAgents.size >= 1
  }, [steps, workflowParticipants])

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-s)]"
      data-status={status}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-shrink-0">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: statusConfig.color }} />
            {statusConfig.pulse && (
              <div
                className="absolute inset-0 rounded-full animate-ping"
                style={{ backgroundColor: statusConfig.color, opacity: 0.6 }}
              />
            )}
          </div>

          <span className="text-sm font-medium text-white/80">
            {isStandupMode ? 'Standup Room' : agentName}
          </span>
          {modelName && !isStandupMode && (
            <span className="font-mono text-xs text-white/25">· {modelName}</span>
          )}
          <span className="text-xs text-white/30">{statusConfig.label}</span>
        </div>

        <div className="flex items-center gap-3">
          {currentToolName && isLive && !isStandupMode && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 text-xs text-emerald-400">
              <div className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
              {currentToolName}
            </motion.div>
          )}
          <span className="font-mono text-xs text-white/25">{stepCount} steps</span>
        </div>
      </div>

      {initialInput && (
        <div className="border-b border-[var(--border)] bg-white/[0.02] px-4 py-2.5">
          <p className="truncate text-xs text-white/35">
            <span className="mr-1 text-white/20">Task:</span>
            {initialInput}
          </p>
        </div>
      )}

      {!connected && isLive && (
        <div className="border-b border-amber-400/10 bg-amber-400/5 px-4 py-2 text-xs text-amber-300">
          Live connection lost. Waiting to reconnect…
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 font-mono" style={{ maxHeight }}>
        {loadingState ? (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-4 text-sm text-white/35">
            Loading execution details…
          </div>
        ) : errorState ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-4 text-sm text-red-300/80">
            Could not load execution details.
          </div>
        ) : isStandupMode ? (
          <StandupThread executionId={executionId} steps={steps} isLive={isLive} />
        ) : (
          <>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {steps.map((step, index) => (
                  <StepCard key={stepKey(step, index)} step={step} />
                ))}
              </AnimatePresence>
            </div>

            {isLive && (
              <TypingIndicator label={currentToolName ? `Running ${currentToolName}…` : 'Agent is thinking…'} />
            )}

            {!isLive && !steps.length && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-4 text-sm text-white/35">
                No execution steps were recorded for this run yet.
              </div>
            )}
          </>
        )}

        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {status === 'completed' && !isStandupMode && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="border-t border-white/5 bg-emerald-500/5 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <span>✅</span>
                <span className="font-medium">Completed in {stepCount} steps</span>
              </div>
              {finalResult && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(finalResult)}
                  className="text-xs text-white/30 transition-colors hover:text-white/60"
                >
                  Copy result
                </button>
              )}
            </div>
          </motion.div>
        )}

        {status === 'failed' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="border-t border-white/5 bg-red-500/5 px-4 py-3"
          >
            <div className="flex items-center gap-2 text-sm text-red-400">
              <span>❌</span>
              <span>{channelError || latestStep?.content || 'Execution failed. Check the steps above for details.'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

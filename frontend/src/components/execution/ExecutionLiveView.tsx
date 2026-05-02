import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { executionsApi } from '../../api/client'
import { useWebSocket } from '../../contexts/WebSocketContext'
import { EXECUTION_STATUS_CONFIG, STEP_CONFIG, type StepType } from '../../lib/design-tokens'

type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface LiveExecutionStep {
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

function normalizeStatus(status: ExecutionLiveViewProps['initialStatus']): ExecutionStatus {
  if (status === 'completed' || status === 'failed' || status === 'running' || status === 'queued') {
    return status
  }
  if (status === 'rejected' || status === 'timed_out') {
    return 'failed'
  }
  return 'queued'
}

function normalizeStep(step: LiveExecutionStep): LiveExecutionStep {
  return {
    ...step,
    timestamp: step.timestamp || step.created_at,
  }
}

function StepCard({ step }: { step: LiveExecutionStep }) {
  const [expanded, setExpanded] = useState(step.step_type === 'final_answer' || step.step_type === 'error')
  const config = STEP_CONFIG[step.step_type] ?? STEP_CONFIG.observation
  const toolInput =
    step.tool_input && typeof step.tool_input === 'object'
      ? (step.tool_input as Record<string, unknown>)
      : null
  const hasToolDetail = Boolean(toolInput && Object.keys(toolInput).length > 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="overflow-hidden rounded-lg"
      style={{
        border: `1px solid ${config.borderColor}`,
        background: config.bgColor,
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
        <p
          className={[
            'whitespace-pre-wrap break-words text-sm leading-relaxed',
            step.step_type === 'final_answer' ? 'text-white/90' : 'text-white/65',
          ].join(' ')}
        >
          {step.step_type === 'observation' && step.content.length > 600
            ? `${step.content.slice(0, 600)}\n…[truncated]`
            : step.content}
        </p>
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

export function ExecutionLiveView({
  executionId,
  agentName = 'Agent',
  modelName,
  initialInput,
  onComplete,
  onError,
  existingSteps = [],
  initialStatus = 'queued',
  maxHeight = '600px',
}: ExecutionLiveViewProps) {
  const [steps, setSteps] = useState<LiveExecutionStep[]>(() => existingSteps.map(normalizeStep))
  const [status, setStatus] = useState<ExecutionStatus>(normalizeStatus(initialStatus))
  const [finalResult, setFinalResult] = useState<string | null>(null)
  const [currentToolName, setCurrentToolName] = useState<string | null>(null)
  const [channelError, setChannelError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const completionNotifiedRef = useRef(false)
  const errorNotifiedRef = useRef(false)
  const { subscribe, unsubscribe, connected } = useWebSocket()

  useEffect(() => {
    setSteps(existingSteps.map(normalizeStep))
    setStatus(normalizeStatus(initialStatus))
    setFinalResult(null)
    setCurrentToolName(null)
    setChannelError(null)
    completionNotifiedRef.current = false
    errorNotifiedRef.current = false
  }, [existingSteps, initialStatus])

  useEffect(() => {
    const channel = `execution:${executionId}`

    subscribe(channel, (message: any) => {
      if (message.event === 'execution_step') {
        const step = normalizeStep(message.step as LiveExecutionStep)
        setChannelError(null)
        setStatus(prev => (prev === 'queued' ? 'running' : prev))
        setSteps(prev => {
          const next = prev.some(s => s.step_index === step.step_index) ? prev : [...prev, step]
          return next.sort((a, b) => a.step_index - b.step_index)
        })

        if (step.step_type === 'action' && step.tool_name) {
          setCurrentToolName(step.tool_name)
        }
        if (step.step_type === 'observation') {
          setCurrentToolName(null)
        }
        if (step.step_type === 'final_answer') {
          setStatus('completed')
          setCurrentToolName(null)
          setFinalResult(step.content)
          if (!completionNotifiedRef.current) {
            completionNotifiedRef.current = true
            onComplete?.(step.content)
          }
        }
        if (step.step_type === 'error') {
          setStatus('failed')
          setCurrentToolName(null)
          setChannelError(step.content)
          if (!errorNotifiedRef.current) {
            errorNotifiedRef.current = true
            onError?.(step.content)
          }
        }
      }

      if (message.event === 'execution_complete') {
        const nextStatus = normalizeStatus(message.status)
        setStatus(nextStatus)
        setCurrentToolName(null)
      }

      if (message.event === 'execution_failed') {
        setStatus('failed')
        setCurrentToolName(null)
        const error = message.error ?? 'Execution failed'
        setChannelError(error)
        if (!errorNotifiedRef.current) {
          errorNotifiedRef.current = true
          onError?.(error)
        }
      }
    })

    return () => unsubscribe(channel)
  }, [executionId, subscribe, unsubscribe, onComplete, onError])

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const mergeSteps = (incoming: LiveExecutionStep[]) => {
      setSteps(prev => {
        const merged = new Map<number, LiveExecutionStep>()
        for (const step of prev) merged.set(step.step_index, step)
        for (const step of incoming.map(normalizeStep)) merged.set(step.step_index, step)
        return Array.from(merged.values()).sort((a, b) => a.step_index - b.step_index)
      })
    }

    const syncExecution = async () => {
      try {
        const execution = await executionsApi.get(executionId)
        if (cancelled) return

        mergeSteps(execution.steps || [])

        const nextStatus = normalizeStatus(execution.status)
        setStatus(nextStatus)

        if (execution.output_message) {
          setFinalResult(execution.output_message)
        }

        if (nextStatus === 'completed') {
          setCurrentToolName(null)
          const finalText =
            execution.output_message ||
            execution.steps?.find(step => step.step_type === 'final_answer')?.content ||
            ''
          if (finalText && !completionNotifiedRef.current) {
            completionNotifiedRef.current = true
            onComplete?.(finalText)
          }
          return
        }

        if (nextStatus === 'failed') {
          setCurrentToolName(null)
          const error =
            execution.error ||
            execution.steps?.find(step => step.step_type === 'error')?.content ||
            'Execution failed'
          setChannelError(error)
          if (!errorNotifiedRef.current) {
            errorNotifiedRef.current = true
            onError?.(error)
          }
          return
        }
      } catch {
        if (cancelled) return
      }

      if (!cancelled) {
        timeoutId = setTimeout(syncExecution, 2000)
      }
    }

    void syncExecution()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [executionId, onComplete, onError])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length, currentToolName, status])

  const statusConfig = EXECUTION_STATUS_CONFIG[status]
  const stepCount = steps.length
  const isLive = status === 'running' || status === 'queued'
  const latestStep = useMemo(() => (steps.length ? steps[steps.length - 1] : null), [steps])

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/5 bg-[#080C14]">
      <div className="flex items-center justify-between border-b border-white/5 bg-[#0C1018] px-4 py-3">
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

          <span className="text-sm font-medium text-white/80">{agentName}</span>
          {modelName && (
            <span className="font-mono text-xs text-white/25">· {modelName}</span>
          )}
          <span className="text-xs text-white/30">{statusConfig.label}</span>
        </div>

        <div className="flex items-center gap-3">
          {currentToolName && isLive && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 text-xs text-cyan-400">
              <div className="h-1 w-1 rounded-full bg-cyan-400 animate-pulse" />
              {currentToolName}
            </motion.div>
          )}
          <span className="font-mono text-xs text-white/25">{stepCount} steps</span>
        </div>
      </div>

      {initialInput && (
        <div className="border-b border-white/5 bg-white/[0.02] px-4 py-2.5">
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

      <div className="flex-1 space-y-2 overflow-y-auto p-3 font-mono" style={{ maxHeight }}>
        <AnimatePresence initial={false}>
          {steps.map(step => (
            <StepCard key={step.step_index} step={step} />
          ))}
        </AnimatePresence>

        {isLive && (
          <TypingIndicator label={currentToolName ? `Running ${currentToolName}…` : 'Agent is thinking…'} />
        )}

        {!isLive && !steps.length && (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-4 text-sm text-white/35">
            No execution steps were recorded for this run yet.
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {status === 'completed' && (
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

import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workflowsApi, executionsApi, extractApiError } from '../api/client'
import { FeedbackBar } from '../components/executions/FeedbackBar'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { Send, Copy, Check, ArrowLeft, Bot, User, Loader2, Zap, MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from '../lib/toast'

export function WorkflowChat() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [currentExecution, setCurrentExecution] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: workflow } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => workflowsApi.get(workflowId!),
    enabled: Boolean(workflowId),
  })

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ['chat-history', workflowId],
    queryFn: () => executionsApi.list(workflowId),
    enabled: Boolean(workflowId),
    select: data =>
      [...data]
        .filter(ex => ex.status === 'completed' && ex.output_message)
        .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, pendingMessage, currentExecution, running])

  const send = async () => {
    const msg = input.trim()
    if (!msg || !workflowId || running) return
    setInput('')
    setPendingMessage(msg)
    setRunning(true)
    try {
      const exec = await executionsApi.run(workflowId, msg)
      toast.info('Run started')
      setRunningId(exec.execution_id)
      setCurrentExecution(exec.execution_id)
    } catch (e) {
      setRunning(false)
      setPendingMessage(null)
      toast.error(extractApiError(e))
    }
  }

  const copyId = () => {
    navigator.clipboard.writeText(workflowId || '')
    setCopied(true)
    toast.success('Workflow ID copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const feedbackAgentId = workflow?.nodes
    ?.filter(node => node.type === 'agentNode' && node.data?.agent_id)
    .slice(-1)[0]
    ?.data.agent_id as string | undefined

  return (
    <div className="flex h-full flex-col bg-transparent px-4 py-4 lg:px-6">
      <div className="glass-card flex flex-1 min-h-0 flex-col overflow-hidden rounded-[24px]">
      <div className="flex-shrink-0 border-b border-white/[0.08] bg-white/[0.02] px-5 py-4 flex items-center gap-3">
        <Link to="/workflows" className="rounded-lg p-1.5 text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white/80">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/12">
          <MessageSquare size={15} className="text-indigo-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="leading-none font-semibold text-white">{workflow?.name ?? 'Loading...'}</div>
          {workflow?.description && (
            <div className="mt-0.5 truncate text-xs text-[var(--t2)]">{workflow.description}</div>
          )}
        </div>
        <div className="hidden flex-shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 sm:flex">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-white/35">ID</span>
          <span className="max-w-[180px] truncate font-mono text-xs text-white/50">{workflowId}</span>
          <button onClick={copyId} className="text-white/40 transition-colors hover:text-white/80" title="Copy workflow ID">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
        {history.length === 0 && !running && !currentExecution && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/10">
              <Zap size={24} className="text-indigo-300" />
            </div>
            <div className="text-sm font-medium text-[var(--t2)]">{workflow?.name ?? 'Workflow'}</div>
            <div className="max-w-xs text-center text-xs text-[var(--t3)]">
              Type a message below to run this workflow. Each message starts a fresh execution.
            </div>
          </div>
        )}

        {history.map((ex: any) => (
          <div key={ex.id} className="space-y-3">
            <div className="flex items-end justify-end gap-2">
              <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-white/[0.08] bg-white px-4 py-3 text-sm leading-relaxed text-[#050914]">
                {ex.input_message}
              </div>
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/12">
                <User size={12} className="text-indigo-300" />
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                <Bot size={12} className="text-emerald-300" />
              </div>
              <div className="glass-card max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed text-[#F0F6FF] whitespace-pre-wrap">
                {ex.output_message}
                <div className="mt-2 flex gap-2 border-t border-white/[0.08] pt-1.5 text-[10px] text-white/35">
                  <span>{ex.token_count} tokens</span>
                  <span>·</span>
                  <span>${(ex.cost ?? 0).toFixed(5)}</span>
                </div>
                <FeedbackBar executionId={ex.id} agentId={feedbackAgentId || null} output={ex.output_message} />
              </div>
            </div>
          </div>
        ))}

        {pendingMessage && (
          <div className="flex items-end justify-end gap-2">
            <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-white/[0.08] bg-white px-4 py-3 text-sm leading-relaxed text-[#050914]">
              {pendingMessage}
            </div>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/12">
              <User size={12} className="text-indigo-300" />
            </div>
          </div>
        )}

        {currentExecution && (
          <div className="glass-card rounded-3xl p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Live standup room</div>
                <div className="mt-1 text-xs text-[var(--t2)]">
                  Watch agents speak in sequence without leaving this page.
                </div>
              </div>
              <Link to={`/executions/${currentExecution}`} className="text-xs text-white/35 transition hover:text-white/70">
                View full execution →
              </Link>
            </div>

            <ExecutionLiveView
              executionId={currentExecution}
              onComplete={() => {
                setRunning(false)
                setRunningId(null)
                setPendingMessage(null)
                void refetchHistory()
                void qc.invalidateQueries({ queryKey: ['recent-executions'] })
              }}
              onError={() => {
                setRunning(false)
                setRunningId(null)
                setPendingMessage(null)
              }}
            />
          </div>
        )}

        <div ref={bottomRef} />
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-white/[0.08] bg-white/[0.02] p-4">
        <div className="mx-auto max-w-4xl">
          <div className="glass-card flex items-end gap-3 p-3 focus-within:border-indigo-500/30 focus-within:shadow-[0_0_24px_rgba(99,102,241,0.12)]">
            <textarea
              ref={textareaRef}
              rows={1}
              className="min-h-[44px] w-full resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-white/25"
              placeholder="Ask the workflow anything… (Enter to send)"
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              disabled={running}
            />
          </div>
          <button
            onClick={() => void send()}
            disabled={!input.trim() || running}
            className={clsx(
              'ml-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-colors',
              input.trim() && !running
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'cursor-not-allowed bg-white/[0.04] text-white/25',
            )}
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10px] text-[var(--t3)]">Shift+Enter for new line</div>
        {running && runningId && (
          <div className="mt-3 flex justify-center">
            <button
              onClick={async () => {
                try {
                  await executionsApi.cancel(runningId)
                  setRunning(false)
                  setRunningId(null)
                  setPendingMessage(null)
                  toast.success('Execution stopped')
                } catch (e) {
                  toast.error(extractApiError(e))
                }
              }}
              className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100 transition hover:bg-red-500/15"
            >
              Stop execution
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

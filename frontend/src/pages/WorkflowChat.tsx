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
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900 px-5 py-3 flex items-center gap-3">
        <Link to="/workflows" className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-violet-600/30 bg-violet-600/20">
          <MessageSquare size={14} className="text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="leading-none font-semibold text-slate-100">{workflow?.name ?? 'Loading...'}</div>
          {workflow?.description && (
            <div className="mt-0.5 truncate text-xs text-slate-500">{workflow.description}</div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">ID</span>
          <span className="hidden max-w-[180px] truncate font-mono text-xs text-slate-400 sm:block">{workflowId}</span>
          <button onClick={copyId} className="text-slate-500 transition-colors hover:text-slate-300" title="Copy workflow ID">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {history.length === 0 && !running && !currentExecution && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-900/40 bg-violet-900/20">
              <Zap size={24} className="text-violet-500" />
            </div>
            <div className="text-sm font-medium text-slate-500">{workflow?.name ?? 'Workflow'}</div>
            <div className="max-w-xs text-center text-xs text-slate-700">
              Type a message below to run this workflow. Each message starts a fresh execution.
            </div>
          </div>
        )}

        {history.map((ex: any) => (
          <div key={ex.id} className="space-y-3">
            <div className="flex items-end justify-end gap-2">
              <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-sm leading-relaxed text-white">
                {ex.input_message}
              </div>
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-violet-800/60 bg-violet-900/60">
                <User size={12} className="text-violet-400" />
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-emerald-900/60 bg-emerald-900/40">
                <Bot size={12} className="text-emerald-400" />
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-slate-700/80 bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
                {ex.output_message}
                <div className="mt-2 flex gap-2 border-t border-slate-700/60 pt-1.5 text-[10px] text-slate-600">
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
            <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-sm leading-relaxed text-white">
              {pendingMessage}
            </div>
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-violet-800/60 bg-violet-900/60">
              <User size={12} className="text-violet-400" />
            </div>
          </div>
        )}

        {currentExecution && (
          <div className="rounded-3xl border border-slate-800/90 bg-slate-900/65 p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Live standup room</div>
                <div className="mt-1 text-xs text-slate-400">
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

      <div className="flex-shrink-0 border-t border-slate-800 bg-slate-900/50 p-4">
        <div className="mx-auto flex max-w-4xl items-end gap-3">
          <div className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 transition-colors focus-within:border-violet-600/60">
            <textarea
              ref={textareaRef}
              rows={1}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
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
              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors',
              input.trim() && !running
                ? 'bg-violet-600 text-white hover:bg-violet-500'
                : 'cursor-not-allowed bg-slate-800 text-slate-600',
            )}
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10px] text-slate-700">Shift+Enter for new line</div>
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
  )
}

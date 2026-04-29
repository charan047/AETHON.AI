import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workflowsApi, executionsApi } from '../api/client'
import { useWebSocket } from '../hooks/useWebSocket'
import { FeedbackBar } from '../components/executions/FeedbackBar'
import { Send, Copy, Check, ArrowLeft, Bot, User, Loader2, Zap, MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import type { WsEvent } from '../types'

type LiveUpdate = { text: string; type: string }

function formatLiveEvent(ev: WsEvent): string {
  switch (ev.type) {
    case 'workflow_plan': return `Plan: ${(ev.plan as string[])?.join(' → ') ?? ''}`
    case 'agent_done':    return `${ev.agent} finished`
    case 'tool_call':     return `${ev.agent} → ${ev.tool}(${String(ev.input || '').slice(0, 50)})`
    case 'tool_result':   return `${ev.tool}: ${String(ev.output || '').slice(0, 80)}`
    default:              return ev.type
  }
}

export function WorkflowChat() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const qc = useQueryClient()
  const { events } = useWebSocket()

  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [liveUpdates, setLiveUpdates] = useState<LiveUpdate[]>([])
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: workflow } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => workflowsApi.get(workflowId!),
    enabled: !!workflowId,
  })

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ['chat-history', workflowId],
    queryFn: () => executionsApi.list(workflowId),
    enabled: !!workflowId,
    select: (data) =>
      [...data]
        .filter(ex => ex.status === 'completed' && ex.output_message)
        .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
  })

  // Watch WS events for the current execution
  useEffect(() => {
    if (!runningId) return
    const last = events[events.length - 1]
    if (!last || last.execution_id !== runningId) return

    if (last.type === 'execution_complete') {
      setRunning(false)
      setRunningId(null)
      setPendingMessage(null)
      setLiveUpdates([])
      refetchHistory()
      qc.invalidateQueries({ queryKey: ['recent-executions'] })
    } else if (last.type === 'execution_error') {
      setRunning(false)
      setRunningId(null)
      setPendingMessage(null)
      setLiveUpdates([])
      toast.error(String(last.error || 'Execution failed'))
    } else if (['workflow_plan', 'agent_done', 'tool_call', 'tool_result'].includes(last.type)) {
      setLiveUpdates(prev => [...prev, { text: formatLiveEvent(last), type: last.type }])
    }
  }, [events, runningId, qc, refetchHistory])

  // Scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, liveUpdates, running, pendingMessage])

  const send = async () => {
    const msg = input.trim()
    if (!msg || !workflowId || running) return
    setInput('')
    setPendingMessage(msg)
    setRunning(true)
    setLiveUpdates([])
    try {
      const exec = await executionsApi.run(workflowId, msg)
      setRunningId(exec.id)
    } catch (e: any) {
      setRunning(false)
      setPendingMessage(null)
      toast.error(e.response?.data?.detail || 'Failed to start workflow')
    }
  }

  const copyId = () => {
    navigator.clipboard.writeText(workflowId || '')
    setCopied(true)
    toast.success('Workflow ID copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const liveUpdateColors: Record<string, string> = {
    workflow_plan: 'text-indigo-400',
    agent_done:    'text-violet-400',
    tool_call:     'text-amber-400',
    tool_result:   'text-amber-300',
  }

  const feedbackAgentId = workflow?.nodes
    ?.filter(node => node.type === 'agentNode' && node.data?.agent_id)
    .slice(-1)[0]
    ?.data.agent_id as string | undefined

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Header */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-5 py-3 flex items-center gap-3">
        <Link to="/workflows" className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-lg hover:bg-slate-800">
          <ArrowLeft size={18} />
        </Link>
        <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-600/30 flex items-center justify-center flex-shrink-0">
          <MessageSquare size={14} className="text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100 leading-none">{workflow?.name ?? 'Loading...'}</div>
          {workflow?.description && (
            <div className="text-xs text-slate-500 mt-0.5 truncate">{workflow.description}</div>
          )}
        </div>
        {/* Workflow ID badge */}
        <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 flex-shrink-0">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mr-1">ID</span>
          <span className="text-xs text-slate-400 font-mono hidden sm:block max-w-[180px] truncate">{workflowId}</span>
          <button onClick={copyId} className="text-slate-500 hover:text-slate-300 transition-colors" title="Copy workflow ID">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {history.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-700">
            <div className="w-14 h-14 rounded-2xl bg-violet-900/20 border border-violet-900/40 flex items-center justify-center">
              <Zap size={24} className="text-violet-500" />
            </div>
            <div className="text-sm text-slate-500 font-medium">{workflow?.name ?? 'Workflow'}</div>
            <div className="text-xs text-slate-700 text-center max-w-xs">
              Type a message below to run this workflow. Each message starts a fresh execution.
            </div>
          </div>
        )}

        {/* Completed execution history */}
        {history.map((ex: any) => (
          <div key={ex.id} className="space-y-3">
            {/* Human bubble */}
            <div className="flex justify-end gap-2 items-end">
              <div className="max-w-[75%] bg-violet-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">
                {ex.input_message}
              </div>
              <div className="w-7 h-7 rounded-full bg-violet-900/60 border border-violet-800/60 flex items-center justify-center flex-shrink-0">
                <User size={12} className="text-violet-400" />
              </div>
            </div>
            {/* AI bubble */}
            <div className="flex gap-2 items-end">
              <div className="w-7 h-7 rounded-full bg-emerald-900/40 border border-emerald-900/60 flex items-center justify-center flex-shrink-0">
                <Bot size={12} className="text-emerald-400" />
              </div>
              <div className="max-w-[80%] bg-slate-800 border border-slate-700/80 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {ex.output_message}
                <div className="flex gap-2 mt-2 text-[10px] text-slate-600 border-t border-slate-700/60 pt-1.5">
                  <span>{ex.token_count} tokens</span>
                  <span>·</span>
                  <span>${ex.cost.toFixed(5)}</span>
                </div>
                <FeedbackBar executionId={ex.id} agentId={feedbackAgentId || null} output={ex.output_message} />
              </div>
            </div>
          </div>
        ))}

        {/* Pending: show user's message immediately while running */}
        {pendingMessage && (
          <div className="flex justify-end gap-2 items-end">
            <div className="max-w-[75%] bg-violet-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">
              {pendingMessage}
            </div>
            <div className="w-7 h-7 rounded-full bg-violet-900/60 border border-violet-800/60 flex items-center justify-center flex-shrink-0">
              <User size={12} className="text-violet-400" />
            </div>
          </div>
        )}

        {/* Live execution bubble */}
        {running && (
          <div className="flex gap-2 items-end">
            <div className="w-7 h-7 rounded-full bg-emerald-900/40 border border-emerald-900/60 flex items-center justify-center flex-shrink-0">
              <Bot size={12} className="text-emerald-400" />
            </div>
            <div className="max-w-[80%] bg-slate-800 border border-slate-700/80 rounded-2xl rounded-bl-sm px-4 py-3 space-y-1.5">
              {liveUpdates.map((u, i) => (
                <div key={i} className={clsx('flex items-center gap-1.5 text-xs', liveUpdateColors[u.type] ?? 'text-slate-500')}>
                  <div className="w-1 h-1 rounded-full bg-current flex-shrink-0" />
                  <span>{u.text}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-0.5">
                <Loader2 size={11} className="animate-spin flex-shrink-0" />
                <span>Running agents...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-slate-800 p-4 bg-slate-900/50">
        <div className="flex gap-3 items-end max-w-4xl mx-auto">
          <div className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 focus-within:border-violet-600/60 transition-colors">
            <textarea
              ref={textareaRef}
              rows={1}
              className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none resize-none leading-relaxed"
              placeholder="Ask the workflow anything… (Enter to send)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              disabled={running}
            />
          </div>
          <button
            onClick={send}
            disabled={!input.trim() || running}
            className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
              input.trim() && !running
                ? 'bg-violet-600 hover:bg-violet-500 text-white'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            )}
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="text-center text-[10px] text-slate-700 mt-1.5">Shift+Enter for new line</div>
      </div>
    </div>
  )
}

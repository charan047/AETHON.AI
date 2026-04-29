import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { clsx } from 'clsx'
import { companyApi, dashboardApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useWebSocket } from '../contexts/WebSocketContext'
import type { CompanyChatStreamEvent, WsEvent } from '../types'

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatAction {
  type: string
  success?: boolean
  label?: string
  page?: string
  execution_id?: string
  agent_id?: string
  workflow_id?: string
  notification_id?: string
  message?: string
}

interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  actions?: ChatAction[]
  createdAt: string
  streaming?: boolean
}

const suggestionChips = [
  "What's pending?",
  'Run morning standup',
  "How's our burn rate?",
  'Hire a designer',
  'What did the team do today?',
]

const relevantEventTypes = new Set([
  'hitl_requested',
  'hitl_approved',
  'hitl_rejected',
  'hitl_timed_out',
  'workflow_completed',
  'execution_complete',
  'workflow_paused',
  'workflow_resumed',
  'workflow_rejected',
  'workflow_timed_out',
  'workflow_scheduled_trigger',
  'workflow_webhook_trigger',
  'workflow_rolled_back',
  'agent_flagged_issue',
  'agent_completed',
  'agent_done',
  'agent_retry',
  'agent_retry_exhausted',
  'parallel_group_completed',
  'parallel_group_done',
  'condition_evaluated',
  'in_app_notification',
  'budget_warning',
  'budget_exceeded',
])

const conversationStoragePrefix = 'company_chat_conversation'

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function cleanAssistantText(content: string) {
  return content.replace(/<action>[\s\S]*?<\/action>/g, '').trim()
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function toChatMessages(items: Array<{ role: ChatRole; content: string; created_at?: string }>): ChatMessage[] {
  return items
    .filter(item => item.role === 'user' || item.role === 'assistant' || item.role === 'system')
    .map(item => ({
      id: uid(item.role),
      role: item.role,
      content: item.content,
      createdAt: item.created_at || new Date().toISOString(),
      actions: item.role === 'assistant' ? [] : undefined,
    }))
}

function initialsFromEmail(email?: string | null) {
  if (!email) return 'Founder'
  const name = email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Founder'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function actionRoute(action: ChatAction) {
  if (action.page === 'approvals') return '/approvals'
  if (action.page === 'agents') return '/agents'
  if (action.page === 'workflows') return '/workflows'
  if (action.workflow_id) return '/workflows'
  if (action.execution_id) return '/monitoring'
  if (action.agent_id) return '/agents'
  return null
}

function formatSystemEvent(event: WsEvent) {
  const agentName = String(event.agent_name || event.agent || event.name || 'Your team')
  const workflowName = String(event.workflow_name || event.workflow || 'workflow')
  const title = String(event.title || event.content || event.output || '').slice(0, 140)

  switch (event.type) {
    case 'hitl_requested':
      return `System: ${agentName} needs your review${title ? `: ${title}` : ''}`
    case 'hitl_approved':
      return `System: Approval was approved`
    case 'hitl_rejected':
      return `System: Approval was rejected`
    case 'hitl_timed_out':
      return `System: Approval timed out`
    case 'workflow_completed':
    case 'execution_complete':
      return `System: Workflow "${workflowName}" finished successfully`
    case 'workflow_paused':
      return `System: Workflow "${workflowName}" paused for approval`
    case 'workflow_resumed':
      return `System: Workflow "${workflowName}" resumed`
    case 'workflow_rejected':
      return `System: Workflow "${workflowName}" was rejected`
    case 'workflow_timed_out':
      return `System: Workflow "${workflowName}" timed out`
    case 'workflow_scheduled_trigger':
      return `System: Scheduled workflow "${workflowName}" started`
    case 'workflow_webhook_trigger':
      return `System: ${event.source || 'Webhook'} triggered "${workflowName}"`
    case 'workflow_rolled_back':
      return `System: Workflow "${workflowName}" was rolled back`
    case 'agent_flagged_issue':
      return `System: ${agentName} flagged an issue${title ? ` - ${title}` : ''}`
    case 'agent_completed':
    case 'agent_done':
      return `System: ${agentName} completed work${title ? ` - ${title}` : ''}`
    case 'agent_retry':
      return `System: ${agentName} is retrying attempt ${event.attempt || 1}`
    case 'agent_retry_exhausted':
      return `System: ${agentName} exhausted retries`
    case 'parallel_group_completed':
    case 'parallel_group_done':
      return `System: Parallel agents finished their work`
    case 'condition_evaluated':
      return `System: Workflow condition routed to ${event.target_node_id || 'the next step'}`
    case 'in_app_notification':
      return `System: ${event.title || 'New notification'}`
    case 'budget_warning':
      return `System: Budget warning - current spend is $${event.monthly_spend || 0}`
    case 'budget_exceeded':
      return `System: Budget exceeded - current spend is $${event.monthly_spend || 0}`
    default:
      return `System: ${agentName} updated the company feed`
  }
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-200">{part.slice(1, -1)}</code>
    }
    return <span key={index}>{part}</span>
  })
}

function MarkdownMessage({ content }: { content: string }) {
  const cleaned = cleanAssistantText(content)
  const parts = cleaned.split(/```/g)

  if (!cleaned) return null

  return (
    <div className="space-y-3">
      {parts.map((part, index) => {
        const isCode = index % 2 === 1
        if (isCode) {
          return (
            <pre key={index} className="overflow-x-auto rounded-xl border border-white/10 bg-black/35 p-3 font-mono text-xs text-cyan-100">
              <code>{part.replace(/^\w+\n/, '')}</code>
            </pre>
          )
        }

        const lines = part.split('\n')
        return (
          <div key={index} className="space-y-1.5">
            {lines.map((line, lineIndex) => {
              if (!line.trim()) return <div key={lineIndex} className="h-2" />
              if (line.trim().startsWith('- ')) {
                return (
                  <div key={lineIndex} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent-300" />
                    <span>{renderInline(line.trim().slice(2))}</span>
                  </div>
                )
              }
              return <p key={lineIndex}>{renderInline(line)}</p>
            })}
          </div>
        )
      })}
    </div>
  )
}

function ActionCard({ action }: { action: ChatAction }) {
  const navigate = useNavigate()
  const route = actionRoute(action)
  const isError = action.success === false || action.type === 'error'
  const Icon = isError ? Clock : action.type === 'create_agent' || action.type === 'create_workflow' || action.type === 'create_notification' ? CheckCircle2 : action.type === 'navigate' ? ArrowRight : Zap

  return (
    <button
      type="button"
      onClick={() => route && navigate(route)}
      className={clsx(
        'mt-3 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm shadow-glow-sm transition duration-150',
        isError
          ? 'border-red-400/25 bg-red-500/10 text-red-100'
          : 'border-accent-400/20 bg-accent-400/10 text-accent-100',
        route && !isError ? 'hover:border-accent-300/40 hover:bg-accent-400/15' : 'cursor-default',
      )}
    >
      <span className={clsx('grid h-8 w-8 place-items-center rounded-lg', isError ? 'bg-red-500/20 text-red-100' : 'bg-accent-500/20 text-accent-200')}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{action.label || action.message || 'Action completed'}</span>
        {action.message && action.label && <span className="mt-0.5 block text-xs opacity-75">{action.message}</span>}
        {route && !isError && <span className="mt-0.5 block text-xs text-accent-200/70">Open destination</span>}
      </span>
      {route && !isError && <ArrowRight size={15} className="text-accent-200/70" />}
    </button>
  )
}

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 220 150" className="mx-auto h-36 w-56 text-accent-300" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="chatGlow" x1="42" x2="178" y1="18" y2="132" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect x="42" y="30" width="136" height="88" rx="22" fill="url(#chatGlow)" fillOpacity="0.16" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M72 63h76M72 83h50M72 103h64" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeOpacity="0.55" />
      <circle cx="172" cy="38" r="18" fill="#06b6d4" fillOpacity="0.18" stroke="#06b6d4" strokeOpacity="0.45" />
      <circle cx="46" cy="114" r="14" fill="#6366f1" fillOpacity="0.18" stroke="#6366f1" strokeOpacity="0.45" />
    </svg>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs text-cyan-100">
        <Sparkles size={13} />
        <span>{message.content}</span>
        <span className="text-cyan-100/50">{formatTime(message.createdAt)}</span>
      </div>
    )
  }

  return (
    <div className={clsx('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-accent-500/25 to-cyan-500/20 text-cyan-100 shadow-glow-sm">
          <Building2 size={18} />
        </div>
      )}
      <div className={clsx('max-w-[76%]', isUser && 'flex flex-col items-end')}>
        <div
          className={clsx(
            'rounded-2xl px-4 py-3 text-sm leading-6',
            isUser
              ? 'rounded-br-md bg-gradient-to-br from-accent-500 to-indigo-600 text-white shadow-glow-sm'
              : 'rounded-bl-md border border-white/10 bg-obsidian-900 text-obsidian-100',
          )}
        >
          {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <MarkdownMessage content={message.content} />}
          {message.streaming && (
            <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-accent-300 align-middle" />
          )}
          {!isUser && message.actions?.map(action => <ActionCard key={`${action.type}_${action.label}_${action.execution_id}`} action={action} />)}
        </div>
        <div className="mt-1 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-obsidian-500">
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  )
}

function MetricPill({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-obsidian-400">{icon}<span>{label}</span></div>
      <div className="text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

export function CompanyChat() {
  const auth = useAuth()
  const { lastEvent, connected } = useWebSocket()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const seenEventRef = useRef<string | null>(null)

  const conversationStorageKey = auth.userId ? `${conversationStoragePrefix}:${auth.userId}` : null

  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary', 'company-chat'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
  })
  const { data: companyState } = useQuery({
    queryKey: ['company-state', 'chat'],
    queryFn: companyApi.profile,
  })

  const founderName = initialsFromEmail(auth.email)
  const agentCount = companyState?.agents.length ?? summary?.team_status.length ?? 0
  const workflowCount = companyState?.workflows.length ?? summary?.this_week.workflows_run ?? 0
  const pendingCount = summary?.pending_attention.length ?? 0

  const emptyCards = useMemo(() => [
    {
      icon: <Clock size={18} />,
      title: pendingCount ? `${pendingCount} item${pendingCount === 1 ? '' : 's'} need attention` : 'Nothing urgent pending',
      prompt: pendingCount ? "What's pending and what should I handle first?" : 'Give me a status update for the company.',
    },
    {
      icon: <Workflow size={18} />,
      title: `${summary?.this_week.workflows_run ?? 0} workflows this week`,
      prompt: 'What did our workflows accomplish this week?',
    },
    {
      icon: <Users size={18} />,
      title: `${agentCount} agents on the team`,
      prompt: 'Which team member should I use next?',
    },
  ], [agentCount, pendingCount, summary?.this_week.workflows_run])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!auth.accessToken || !conversationStorageKey) return

    const savedConversationId = window.sessionStorage.getItem(conversationStorageKey)
    if (!savedConversationId) return

    setConversationId(savedConversationId)

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/company/chat/${encodeURIComponent(savedConversationId)}`, {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        })
        if (!response.ok) return

        const data = await response.json() as {
          conversation_id: string
          messages: Array<{ role: ChatRole; content: string; created_at?: string }>
        }
        setMessages(toChatMessages(data.messages))
      } catch {
        // If Redis history is unavailable, keep the page usable with a fresh chat.
      }
    }

    void loadHistory()
  }, [auth.accessToken, conversationStorageKey])

  useEffect(() => {
    if (!lastEvent || !relevantEventTypes.has(lastEvent.type)) return
    const key = `${lastEvent.type}_${lastEvent.timestamp}_${lastEvent.execution_id || lastEvent.approval_id || ''}`
    if (seenEventRef.current === key) return
    seenEventRef.current = key
    setMessages(prev => [
      ...prev,
      {
        id: uid('system'),
        role: 'system',
        content: formatSystemEvent(lastEvent),
        createdAt: new Date().toISOString(),
      },
    ])
  }, [lastEvent])

  const sendMessage = async (nextMessage?: string) => {
    const message = (nextMessage ?? input).trim()
    if (!message || sending || !auth.accessToken) return

    const assistantId = uid('assistant')
    setInput('')
    setSending(true)
    setMessages(prev => [
      ...prev,
      { id: uid('user'), role: 'user', content: message, createdAt: new Date().toISOString() },
      { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString(), streaming: true, actions: [] },
    ])

    try {
      const response = await fetch('/api/company/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          message,
          conversation_id: conversationId || undefined,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || 'Company chat failed')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as CompanyChatStreamEvent
          if (event.type === 'meta' && event.conversation_id) {
            setConversationId(event.conversation_id)
            if (conversationStorageKey) {
              window.sessionStorage.setItem(conversationStorageKey, event.conversation_id)
            }
          }
          if (event.type === 'text' && event.content) {
            setMessages(prev => prev.map(item =>
              item.id === assistantId ? { ...item, content: item.content + event.content } : item,
            ))
          }
          if (event.type === 'action' && event.action) {
            setMessages(prev => prev.map(item =>
              item.id === assistantId ? { ...item, actions: [...(item.actions || []), event.action as ChatAction] } : item,
            ))
          }
          if (event.type === 'done') {
            setMessages(prev => prev.map(item =>
              item.id === assistantId ? { ...item, streaming: false } : item,
            ))
          }
        }
      }
    } catch (error) {
      setMessages(prev => prev.map(item =>
        item.id === assistantId
          ? {
              ...item,
              streaming: false,
              content: `I could not reach the company command layer: ${error instanceof Error ? error.message : 'Unknown error'}`,
            }
          : item,
      ))
    } finally {
      setSending(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void sendMessage()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-obsidian-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] bg-obsidian-925/95 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-accent-500/25 to-cyan-500/20 text-cyan-100 shadow-glow-sm ring-1 ring-white/10">
            <Building2 size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Your Company</h1>
            <p className="text-xs text-obsidian-400">
              {agentCount} agents · {workflowCount} workflows · {connected ? 'live now' : 'reconnecting'}
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <MetricPill icon={<Users size={14} />} label="Team" value={`${agentCount} agents`} />
          <MetricPill icon={<Workflow size={14} />} label="Workflows" value={`${workflowCount}`} />
          <button
            type="button"
            onClick={() => navigate('/approvals')}
            className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-left transition hover:bg-amber-300/15"
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-amber-200/80"><Clock size={14} />Attention</div>
            <div className="text-lg font-semibold text-amber-100">{pendingCount} pending</div>
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center text-center">
            <EmptyIllustration />
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-accent-400/20 bg-accent-400/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-accent-200">
              <Sparkles size={13} /> Chief of Staff Online
            </div>
            <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white">Good morning, {founderName}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-obsidian-300">
              Ask for status, run workflows, hire agents, or route yourself to the part of the company that needs you.
            </p>

            <div className="mt-8 grid w-full gap-4 md:grid-cols-3">
              {emptyCards.map(card => (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => setInput(card.prompt)}
                  className="group rounded-2xl border border-white/10 bg-obsidian-900 p-5 text-left transition duration-150 hover:-translate-y-1 hover:border-accent-300/25 hover:shadow-glow-md"
                >
                  <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-accent-400/10 text-accent-200 group-hover:bg-accent-400/15">
                    {card.icon}
                  </div>
                  <div className="font-medium text-white">{card.title}</div>
                  <div className="mt-2 text-sm leading-5 text-obsidian-400">{card.prompt}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-4">
            {messages.map(message => <MessageBubble key={message.id} message={message} />)}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-white/[0.08] bg-obsidian-925/95 px-6 py-4 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl">
          <div className="mb-3 flex flex-wrap gap-2">
            {suggestionChips.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => setInput(chip)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-obsidian-300 transition hover:border-accent-300/25 hover:bg-accent-400/10 hover:text-accent-100"
              >
                {chip}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="flex items-end gap-3 rounded-2xl border border-white/10 bg-obsidian-900 p-2 shadow-glow-sm focus-within:border-accent-400/40 focus-within:shadow-glow-md">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.04] text-obsidian-300">
              <MessageCircle size={18} />
            </div>
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              rows={1}
              placeholder="Ask anything - run a workflow, check status, hire an agent..."
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent py-3 text-sm text-white outline-none placeholder:text-obsidian-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-indigo-600 text-white shadow-glow-sm transition duration-150 hover:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-50"
              title="Send"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </form>
          <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-obsidian-600">
            Press Cmd+Enter to send
          </div>
        </div>
      </footer>
    </div>
  )
}

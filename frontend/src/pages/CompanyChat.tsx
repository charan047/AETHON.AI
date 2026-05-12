import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  ArrowRight,
  AtSign,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Clock3,
  Copy,
  FileText,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { agentsApi, approvalsApi, companyApi, companyChatApi, dashboardApi } from '../api/client'
import { MentionTextarea } from '../components/ui/MentionTextarea'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { useAuth } from '../contexts/AuthContext'
import { useWebSocket } from '../contexts/WebSocketContext'
import { toast } from '../lib/toast'
import type {
  Agent,
  ChatActionResult,
  CompanyChatStreamEvent,
  CompanyConversationMessage,
  CompanyConversationSummary,
  DashboardSummary,
  ExecutionStep,
  WsEvent,
} from '../types'

type ChatRole = 'user' | 'assistant' | 'system'

type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  actions?: ChatActionResult[]
  attachments?: Array<Record<string, unknown>>
  createdAt: string
  streaming?: boolean
  pending?: boolean
  failed?: boolean
}

type SlashCommand = {
  key: string
  group: string
  label: string
  description: string
  template: string
  icon: ReactNode
}

type ActiveExecution = {
  status: 'running' | 'completed'
  steps: ExecutionStep[]
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: '/run', group: 'AGENTS', label: '/run', description: 'Ask an agent to do something', template: '/run @Maya ', icon: <Zap size={14} /> },
  { key: '/pause', group: 'AGENTS', label: '/pause', description: 'Pause one agent', template: '/pause @Maya', icon: <CirclePause size={14} /> },
  { key: '/status', group: 'AGENTS', label: '/status', description: 'Show all agent statuses', template: '/status', icon: <Users size={14} /> },
  { key: '/pause-all', group: 'AGENTS', label: '/pause-all', description: 'Pause all agents', template: '/pause-all', icon: <CirclePause size={14} /> },
  { key: '/summary', group: 'COMPANY', label: '/summary', description: 'Generate a weekly briefing', template: '/summary', icon: <FileText size={14} /> },
  { key: '/insights', group: 'COMPANY', label: '/insights', description: 'What should I focus on?', template: '/insights', icon: <Sparkles size={14} /> },
  { key: '/analytics', group: 'COMPANY', label: '/analytics', description: 'Show performance metrics', template: '/analytics', icon: <BarChart3 size={14} /> },
  { key: '/approve-all', group: 'COMPANY', label: '/approve-all', description: 'Approve all pending items', template: '/approve-all', icon: <CheckCircle2 size={14} /> },
  { key: '/research', group: 'QUICK RUNS', label: '/research', description: 'Run market research', template: '/research ', icon: <Search size={14} /> },
  { key: '/report', group: 'QUICK RUNS', label: '/report', description: 'Generate a report', template: '/report ', icon: <Workflow size={14} /> },
]

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRelative(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const now = Date.now()
  const delta = Math.max(0, now - date.getTime())
  const mins = Math.floor(delta / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDayGroup(value: string) {
  const date = new Date(value)
  const now = new Date()
  const dayDiff = Math.floor((now.getTime() - date.getTime()) / 86400000)
  if (dayDiff <= 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function cleanAssistantText(content: string) {
  return content.replace(/<action>[\s\S]*?<\/action>/g, '').trim()
}

function initialsFromEmail(email?: string | null) {
  if (!email) return 'Founder'
  const name = email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Founder'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function toChatMessages(items: CompanyConversationMessage[]): ChatMessage[] {
  return items.map(item => ({
    id: uid(item.role),
    role: item.role,
    content: item.content,
    createdAt: item.created_at || new Date().toISOString(),
    actions: item.actions,
    attachments: item.attachments,
  }))
}

function normalizeOutboundMessage(raw: string) {
  const trimmed = raw.trim()
  if (trimmed === '/summary') return 'Give me a weekly company briefing.'
  if (trimmed === '/status') return 'What is everyone working on right now?'
  if (trimmed === '/analytics') return 'Show me this week’s company analytics.'
  if (trimmed === '/approve-all') return 'Approve everything pending.'
  if (trimmed === '/pause-all') return 'Pause all agents for now.'
  if (trimmed.startsWith('/pause ')) return `Pause ${trimmed.replace('/pause', '').trim()}.`
  if (trimmed.startsWith('/run ')) return trimmed.replace('/run', '').trim()
  if (trimmed.startsWith('/research ')) return `Research this topic for me: ${trimmed.replace('/research', '').trim()}`
  if (trimmed.startsWith('/report ')) return `Generate a report about: ${trimmed.replace('/report', '').trim()}`
  if (trimmed === '/insights') return 'What should I focus on this week?'
  return raw
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.85em] text-blue-200">{part.slice(1, -1)}</code>
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
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-blue-400" />
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

function agentStatusTone(status: string) {
  switch (status) {
    case 'working':
      return 'text-emerald-300'
    case 'waiting_approval':
      return 'text-amber-300'
    case 'off_duty':
      return 'text-white/35'
    default:
      return 'text-white/55'
  }
}

function actionRoute(action: ChatActionResult) {
  if (action.page === 'approvals') return '/approvals'
  if (action.page === 'agents') return '/agents'
  if (action.page === 'workflows') return '/workflows'
  if (action.page === 'messages') return '/messages'
  if (action.page === 'company-chat') return '/company-chat'
  if (action.page === 'analytics') return '/analytics'
  if (action.execution_id) return `/executions/${action.execution_id}`
  if (action.workflow_id) return '/workflows'
  if (action.agent_id) return '/agents'
  return null
}

function actionProgress(activeExecutions: Record<string, ActiveExecution>, executionId?: string) {
  if (!executionId) return null
  return activeExecutions[executionId] || null
}

function isStandupAction(action: ChatActionResult) {
  const haystack = `${action.label || ''} ${action.message || ''}`.toLowerCase()
  return action.type === 'run_workflow' && action.execution_id && haystack.includes('standup')
}

function ExecutionProgressCard({
  executionId,
  state,
  onOpen,
}: {
  executionId: string
  state: ActiveExecution
  onOpen: () => void
}) {
  const recentSteps = state.steps.slice(-3)
  const progressValue = state.status === 'completed' ? 100 : Math.min(85, 20 + recentSteps.length * 18)

  return (
    <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-cyan-50">Execution live</div>
        <button
          type="button"
          onClick={onOpen}
          className="text-xs text-cyan-100/70 transition hover:text-cyan-50"
        >
          View live →
        </button>
      </div>
      <div className="mb-3 h-2 rounded-full bg-black/25">
        <div
          className={clsx(
            'h-2 rounded-full transition-all',
            state.status === 'completed' ? 'bg-emerald-400' : 'bg-cyan-300',
          )}
          style={{ width: `${progressValue}%` }}
        />
      </div>
      <div className="space-y-1.5 text-xs text-cyan-50/80">
        {recentSteps.length === 0 ? (
          <div>Preparing execution...</div>
        ) : recentSteps.map(step => (
          <div key={step.id} className="truncate">
            {step.step_type === 'final_answer' ? 'Complete' : step.step_type}: {step.content}
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionCard({
  action,
  activeExecutions,
}: {
  action: ChatActionResult
  activeExecutions: Record<string, ActiveExecution>
}) {
  const navigate = useNavigate()
  const route = actionRoute(action)
  const isError = action.success === false || action.type === 'error'
  const Icon = isError ? Clock3 : action.type === 'show_status' ? Users : action.type === 'show_analytics' ? BarChart3 : action.type === 'summarize_week' ? FileText : action.type === 'company_insight' ? Sparkles : action.type === 'bulk_approve' ? CheckCircle2 : Zap
  const progress = actionProgress(activeExecutions, action.execution_id)

  if (isStandupAction(action)) {
    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-400/15 bg-obsidian-900">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-white/70">Standup in progress</span>
          <button
            type="button"
            onClick={() => navigate(`/executions/${action.execution_id}`)}
            className="ml-auto text-xs text-accent-400/70 transition hover:text-accent-400"
          >
            Open →
          </button>
        </div>
        <div className="p-4">
          <ExecutionLiveView
            executionId={action.execution_id!}
            maxHeight="300px"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'mt-3 rounded-2xl border p-4 text-left shadow-glow-sm',
        isError ? 'border-red-400/20 bg-red-500/10 text-red-100' : 'border-accent-purple/20 bg-accent-purple/10 text-accent-100',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={clsx('grid h-9 w-9 place-items-center rounded-xl', isError ? 'bg-red-500/20' : 'bg-accent-purple/20')}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">{action.label || action.message || 'Action completed'}</div>
          {action.message && action.label && <div className="mt-1 text-xs text-white/65">{action.message}</div>}

          {action.type === 'show_status' && action.agent_statuses && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3">
              <div className="space-y-2">
                {action.agent_statuses.map(status => (
                  <div key={`${status.name}_${status.role}`} className="flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-white">{status.name}</div>
                      <div className="truncate text-white/40">{status.task || '—'}</div>
                    </div>
                    <div className={clsx('shrink-0 text-right', agentStatusTone(status.status))}>
                      <div>{status.status}</div>
                      <div className="text-white/30">Trust {Math.round(status.trust_score)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {action.type === 'summarize_week' && action.summary && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3 text-sm leading-6 text-white/85">
              <MarkdownMessage content={action.summary} />
            </div>
          )}

          {action.type === 'company_insight' && action.insight && (
            <blockquote className="mt-3 rounded-2xl border border-accent-purple/25 bg-accent-purple/10 p-3 text-sm leading-6 text-white/85">
              {action.insight}
            </blockquote>
          )}

          {action.type === 'analyze_file' && action.analysis && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3 text-sm leading-6 text-white/85">
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-white/35">{action.filename || 'Attachment'}</div>
              <MarkdownMessage content={action.analysis} />
            </div>
          )}

          {action.type === 'show_analytics' && action.data && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3 text-sm text-white/85">
              <div>{String(action.data.executions_this_week || 0)} executions this week</div>
              <div>{String(action.data.success_rate || 0)}% success rate</div>
            </div>
          )}

          {progress && action.execution_id && (
            <ExecutionProgressCard
              executionId={action.execution_id}
              state={progress}
              onOpen={() => navigate(`/executions/${action.execution_id}`)}
            />
          )}
        </div>

        {route && !isError && (
          <button
            type="button"
            onClick={() => navigate(route)}
            className="rounded-xl border border-white/10 px-2 py-1 text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            Open
          </button>
        )}
      </div>
    </div>
  )
}

function MessageActions({
  message,
  onCopy,
  onRegenerate,
  onToggleStar,
  starred,
  onShare,
}: {
  message: ChatMessage
  onCopy: () => void
  onRegenerate: () => void
  onToggleStar: () => void
  starred: boolean
  onShare: () => void
}) {
  if (message.role !== 'assistant') return null
  return (
    <div className="mt-2 flex items-center gap-1 text-[11px] text-white/35">
      <button type="button" onClick={onCopy} className="rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-white/70"><Copy size={12} className="inline mr-1" />Copy</button>
      <button type="button" onClick={onRegenerate} className="rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-white/70">Regenerate</button>
      <button type="button" onClick={onToggleStar} className="rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-white/70"><Star size={12} className={clsx('inline mr-1', starred && 'fill-current text-amber-300')} />Star</button>
      <button type="button" onClick={onShare} className="rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-white/70">Share</button>
    </div>
  )
}

function MessageBubble({
  message,
  activeExecutions,
  onCopy,
  onRegenerate,
  onToggleStar,
  starred,
  onShare,
}: {
  message: ChatMessage
  activeExecutions: Record<string, ActiveExecution>
  onCopy: () => void
  onRegenerate: () => void
  onToggleStar: () => void
  starred: boolean
  onShare: () => void
}) {
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
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-accent-purple/25 to-accent-cyan/20 text-cyan-100 shadow-glow-sm">
          <Building2 size={18} />
        </div>
      )}
      <div className={clsx('max-w-[76%]', isUser && 'flex flex-col items-end')}>
        <div
          className={clsx(
            'rounded-2xl px-4 py-3 text-sm leading-6',
            isUser
              ? 'rounded-br-md bg-gradient-to-br from-accent-purple to-indigo-600 text-white shadow-glow-sm'
              : 'rounded-bl-md border border-white/10 bg-obsidian-900 text-obsidian-100',
            message.pending && 'opacity-80',
            message.failed && 'border border-red-400/20 bg-red-500/10 text-red-100',
          )}
        >
          {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <MarkdownMessage content={message.content} />}
          {message.streaming && (
            <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-accent-cyan align-middle" />
          )}
          {!isUser && message.actions?.map((action, index) => (
            <ActionCard
              key={`${message.id}_${action.type}_${action.execution_id || action.workflow_id || action.agent_id || index}`}
              action={action}
              activeExecutions={activeExecutions}
            />
          ))}
        </div>
        <div className="mt-1 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-obsidian-500">
          {formatTime(message.createdAt)}
        </div>
        {!isUser && (
          <MessageActions
            message={message}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onToggleStar={onToggleStar}
            starred={starred}
            onShare={onShare}
          />
        )}
      </div>
    </div>
  )
}

function CommandMenu({
  query,
  activeIndex,
  onSelect,
  onHover,
}: {
  query: string
  activeIndex: number
  onSelect: (command: SlashCommand) => void
  onHover: (index: number) => void
}) {
  const filtered = SLASH_COMMANDS.filter(command =>
    `${command.key} ${command.label} ${command.description}`.toLowerCase().includes(query.toLowerCase()),
  )

  if (!filtered.length) return null

  let currentGroup = ''
  return (
    <div className="absolute bottom-full left-0 mb-3 w-[360px] rounded-2xl border border-white/10 bg-[#0f1520]/95 p-2 shadow-2xl backdrop-blur-xl">
      {filtered.map((command, index) => {
        const groupHeader = command.group !== currentGroup
        currentGroup = command.group
        return (
          <div key={command.key}>
            {groupHeader && (
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/25">
                {command.group}
              </div>
            )}
            <button
              type="button"
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(command)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition',
                activeIndex === index ? 'bg-accent-purple/15 text-white' : 'hover:bg-white/5',
              )}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/70">{command.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{command.label}</span>
                <span className="block truncate text-xs text-white/35">{command.description}</span>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function EmptyPromptCard({ icon, title, prompt, onPick }: { icon: ReactNode; title: string; prompt: string; onPick: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(prompt)}
      className="glass-card group cursor-pointer rounded-2xl p-5 text-left transition duration-150 hover:-translate-y-1 hover:border-blue-500/25 hover:shadow-glow-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 motion-reduce:hover:translate-y-0"
    >
      <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-300 group-hover:bg-blue-500/15">
        {icon}
      </div>
      <div className="font-medium text-white">{title}</div>
      <div className="mt-2 text-sm leading-5 text-[#8B9DBE]">{prompt}</div>
    </button>
  )
}

export function CompanyChat() {
  const commandDraftKey = 'aethon-company-chat-draft'
  const auth = useAuth()
  const { lastEvent, connected } = useWebSocket()
  const navigate = useNavigate()
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const seenEventRef = useRef<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(routeConversationId || null)
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [contextOpen, setContextOpen] = useState(true)
  const [showMenu, setShowMenu] = useState(false)
  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [attachments, setAttachments] = useState<Array<Record<string, unknown>>>([])
  const [activeExecutions, setActiveExecutions] = useState<Record<string, ActiveExecution>>({})
  const [authWarning, setAuthWarning] = useState<string | null>(null)
  const [starredIds, setStarredIds] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem('company-chat-stars') || '[]')
    } catch {
      return []
    }
  })

  const founderName = initialsFromEmail(auth.email)
  const conversationStorageKey = auth.userId ? `company_chat_conversation:${auth.userId}` : null

  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary', 'company-chat'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
  })
  const { data: companyState } = useQuery({
    queryKey: ['company-state', 'chat'],
    queryFn: companyApi.profile,
  })
  const { data: agents = [] } = useQuery({
    queryKey: ['agents', 'company-chat-mentions'],
    queryFn: agentsApi.list,
    staleTime: 30_000,
  })
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['approvals', 'pending-chat'],
    queryFn: approvalsApi.pending,
    refetchInterval: 30_000,
  })
  const conversationsQuery = useQuery({
    queryKey: ['company-chat-conversations'],
    queryFn: companyChatApi.conversations,
    staleTime: 15_000,
  })
  const searchQuery = useQuery({
    queryKey: ['company-chat-search', search],
    queryFn: () => companyChatApi.searchConversations(search),
    enabled: search.trim().length > 1,
    staleTime: 10_000,
  })
  const historyQuery = useQuery({
    queryKey: ['company-chat-history', conversationId],
    queryFn: () => companyChatApi.history(conversationId!),
    enabled: Boolean(conversationId),
    staleTime: 0,
  })

  useEffect(() => {
    if (routeConversationId && routeConversationId !== conversationId) {
      setConversationId(routeConversationId)
    }
  }, [routeConversationId, conversationId])

  useEffect(() => {
    if (historyQuery.data?.messages) {
      setMessages(toChatMessages(historyQuery.data.messages))
    }
  }, [historyQuery.data])

  useEffect(() => {
    if (!conversationId && conversationStorageKey) {
      const remembered = window.sessionStorage.getItem(conversationStorageKey)
      if (remembered) {
        setConversationId(remembered)
        navigate(`/company-chat/${remembered}`, { replace: true })
      }
    }
  }, [conversationId, conversationStorageKey, navigate])

  useEffect(() => {
    if (!conversationId && conversationsQuery.data?.conversations?.length) {
      const first = conversationsQuery.data.conversations[0]
      setConversationId(first.id)
      navigate(`/company-chat/${first.id}`, { replace: true })
    }
  }, [conversationId, conversationsQuery.data, navigate])

  useEffect(() => {
    const seededDraft = window.sessionStorage.getItem(commandDraftKey)
    if (!seededDraft || input.trim()) return
    setInput(seededDraft)
    window.sessionStorage.removeItem(commandDraftKey)
  }, [commandDraftKey, input])

  useEffect(() => {
    if (!lastEvent) return

    const event = lastEvent as WsEvent & { event?: string }
    const eventType = event.event || event.type
    const key = `${eventType}_${event.timestamp}_${event.execution_id || event.id || ''}`
    if (seenEventRef.current === key) return
    seenEventRef.current = key

    if (eventType === 'execution_step' && event.execution_id && event.step) {
      const nextStep = event.step as ExecutionStep
      setActiveExecutions(prev => ({
        ...prev,
        [event.execution_id as string]: {
          steps: [
            ...(prev[event.execution_id as string]?.steps || []).filter(step => step.id !== nextStep.id),
            nextStep,
          ].sort((a, b) => (a.step_index || 0) - (b.step_index || 0)),
          status: prev[event.execution_id as string]?.status || 'running',
        },
      }))
      return
    }

    if (eventType === 'workflow_completed' || eventType === 'execution_complete') {
      const executionId = String(event.execution_id || '')
      if (executionId) {
        setActiveExecutions(prev => ({
          ...prev,
          [executionId]: {
            steps: prev[executionId]?.steps || [],
            status: 'completed',
          },
        }))
      }
    }

    if (['new_approval_request', 'agent_autonomy_changed', 'workflow_completed', 'budget_warning'].includes(eventType)) {
      const systemContent =
        eventType === 'new_approval_request'
          ? `⚡ ${String(event.agent_name || 'An agent')} is requesting approval`
          : eventType === 'agent_autonomy_changed'
            ? `🎯 ${String(event.agent_name || 'An agent')} just earned ${String(event.new_level || 'a new')} status`
            : eventType === 'budget_warning'
              ? `⚠️ You've used ${String(event.percentage || 80)}% of your monthly budget`
              : `✅ ${String(event.agent_name || 'A teammate')} finished work`

      setMessages(prev => [
        ...prev,
        { id: uid('system'), role: 'system', content: systemContent, createdAt: new Date().toISOString() },
      ])
    }
  }, [lastEvent])

  useEffect(() => {
    try {
      window.localStorage.setItem('company-chat-stars', JSON.stringify(starredIds))
    } catch {
      // no-op
    }
  }, [starredIds])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const pinMutation = useMutation({
    mutationFn: (id: string) => companyChatApi.pinConversation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['company-chat-conversations'] })
      toast.success('Conversation updated')
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => companyChatApi.renameConversation(id, title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['company-chat-conversations'] })
      if (conversationId) void queryClient.invalidateQueries({ queryKey: ['company-chat-history', conversationId] })
      toast.success('Conversation renamed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => companyChatApi.deleteConversation(id),
    onSuccess: async () => {
      toast.success('Conversation deleted')
      setMessages([])
      setConversationId(null)
      await queryClient.invalidateQueries({ queryKey: ['company-chat-conversations'] })
    },
  })

  const currentConversation = conversationsQuery.data?.conversations?.find(conv => conv.id === conversationId) || null
  const activeAgentCount = summary?.team_status.filter(item => item.status === 'working').length || 0
  const firstActiveAgent = summary?.team_status.find(item => item.status === 'working')

  const dynamicChips = useMemo(() => {
    const chips = ["What should I focus on today?"]
    if (activeAgentCount > 0 && firstActiveAgent) chips.push(`What is ${firstActiveAgent.name} working on?`)
    if (pendingApprovals.length > 0) chips.push(`Approve all ${pendingApprovals.length} pending items`)
    const day = new Date().getDay()
    if (day === 1) chips.push('Run Monday morning standup')
    if (day === 5) chips.push('Generate weekly summary')
    chips.push('Show me company analytics')
    chips.push('What risks should I know about?')
    return chips.slice(0, 5)
  }, [activeAgentCount, firstActiveAgent, pendingApprovals.length])

  const slashQuery = useMemo(() => {
    const trimmed = input.trimStart()
    if (!trimmed.startsWith('/')) return ''
    return trimmed.slice(1)
  }, [input])

  const filteredCommands = useMemo(
    () => SLASH_COMMANDS.filter(command =>
      `${command.key} ${command.label} ${command.description}`.toLowerCase().includes(slashQuery.toLowerCase()),
    ),
    [slashQuery],
  )

  useEffect(() => {
    setShowCommandMenu(input.trimStart().startsWith('/'))
    setCommandIndex(0)
  }, [slashQuery, input])

  const handleNewConversation = () => {
    setConversationId(null)
    setMessages([])
    setInput('')
    setAttachments([])
    navigate('/company-chat')
  }

  const applyCommand = (command: SlashCommand) => {
    setInput(command.template)
    setShowCommandMenu(false)
  }

  const loadConversation = async (id: string) => {
    setConversationId(id)
    navigate(`/company-chat/${id}`)
    if (conversationStorageKey) {
      window.sessionStorage.setItem(conversationStorageKey, id)
    }
    await queryClient.invalidateQueries({ queryKey: ['company-chat-history', id] })
  }

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).slice(0, 3)
    const nextAttachments = await Promise.all(files.map(async file => {
      const text = await file.text().catch(() => '')
      return {
        filename: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        content_preview: text.slice(0, 3000),
      }
    }))
    setAttachments(prev => [...prev, ...nextAttachments].slice(0, 3))
    event.target.value = ''
  }

  const sendMessage = async (override?: string) => {
    const message = normalizeOutboundMessage((override ?? input).trim())
    if (!message || sending) return
    setAuthWarning(null)

    const assistantId = uid('assistant')
    const userId = uid('user')
    const optimisticUser: ChatMessage = {
      id: userId,
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
      attachments,
      pending: true,
    }
    const optimisticAssistant: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      streaming: true,
      actions: [],
    }

    setMessages(prev => [...prev, optimisticUser, optimisticAssistant])
    setInput('')
    setSending(true)

    try {
      const response = await companyChatApi.send({
        message,
        conversation_id: conversationId || undefined,
        attachments,
      })
      if (!response.ok || !response.body) {
        const rawError = await response.text()
        if (response.status === 401) {
          throw new Error('Your session expired. Please refresh or sign in again.')
        }
        throw new Error(rawError || 'Company chat failed')
      }

      setAttachments([])
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
            navigate(`/company-chat/${event.conversation_id}`, { replace: true })
          }
          if (event.type === 'text' && event.content) {
            setMessages(prev => prev.map(item =>
              item.id === assistantId ? { ...item, content: item.content + event.content } : item,
            ))
          }
          if (event.type === 'action' && event.action) {
            setMessages(prev => prev.map(item =>
              item.id === assistantId
                ? { ...item, actions: [...(item.actions || []), event.action as ChatActionResult] }
                : item,
            ))
          }
          if (event.type === 'done') {
            setMessages(prev => prev.map(item =>
              item.id === userId ? { ...item, pending: false } : item.id === assistantId ? { ...item, streaming: false } : item,
            ))
          }
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['company-chat-conversations'] })
      if (conversationId) {
        await queryClient.invalidateQueries({ queryKey: ['company-chat-history', conversationId] })
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error'
      if (messageText.toLowerCase().includes('session expired') || messageText.toLowerCase().includes('authentication')) {
        setAuthWarning('Company Chat lost authentication. Refresh the page or sign in again to restore the command layer.')
      }
      setMessages(prev => prev.map(item =>
        item.id === assistantId
          ? {
              ...item,
              streaming: false,
              failed: true,
              content: `I could not reach the company command layer: ${messageText}`,
            }
          : item,
      ))
      toast.error(messageText)
    } finally {
      setSending(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void sendMessage()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandIndex(current => (current + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex(current => (current - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        applyCommand(filteredCommands[commandIndex] || filteredCommands[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setShowCommandMenu(false)
        return
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void sendMessage()
    }
  }

  const regenerateLast = () => {
    const lastUser = [...messages].reverse().find(message => message.role === 'user')
    if (lastUser) void sendMessage(lastUser.content)
  }

  const selectedSearchResults = searchQuery.data?.results || []
  const sidebarConversations = useMemo(() => {
    const all = conversationsQuery.data?.conversations || []
    if (!search.trim()) return all
    const ids = new Set(selectedSearchResults.map(result => result.conversation_id))
    return all.filter(conversation => ids.has(conversation.id))
  }, [conversationsQuery.data, search, selectedSearchResults])

  const groupedSidebar = useMemo(() => {
    const pinned = sidebarConversations.filter(item => item.pinned)
    const recent = sidebarConversations.filter(item => !item.pinned)
    return { pinned, recent }
  }, [sidebarConversations])

  const quickCards = useMemo(() => {
    if (pendingApprovals.length > 0) {
      return [
        { icon: <CheckCircle2 size={18} />, title: `${pendingApprovals.length} items need your approval`, prompt: 'Approve them' },
        { icon: <Users size={18} />, title: `${firstActiveAgent?.name || 'Your team'} is active`, prompt: `What is ${firstActiveAgent?.name || 'the team'} working on?` },
        { icon: <BarChart3 size={18} />, title: `Your company generated ${summary?.this_week.tasks_completed || 0} completions this week`, prompt: 'Show me the summary' },
      ]
    }
    return [
      { icon: <Users size={18} />, title: `${firstActiveAgent?.name || 'Your team'} hasn't reported in yet`, prompt: `@${firstActiveAgent?.name || 'Maya'} run weekly research` },
      { icon: <BarChart3 size={18} />, title: `Your company generated ${summary?.this_week.tasks_completed || 0} completions this week`, prompt: 'Show me the summary' },
      { icon: <Sparkles size={18} />, title: 'Nothing urgent right now', prompt: 'What should I focus on next?' },
    ]
  }, [pendingApprovals.length, firstActiveAgent, summary?.this_week.tasks_completed])

  const conversationSidebar = (
    <aside className="flex h-full w-[280px] shrink-0 flex-col bg-[rgba(8,13,26,0.9)] backdrop-blur-xl">
      <div className="border-b border-white/[0.06] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Agency Chat</div>
            <div className="mt-1 text-xs text-white/35">Command your AI agency</div>
          </div>
          <button
            type="button"
            onClick={handleNewConversation}
            className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/70 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            title="New conversation"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <Search size={14} className="text-white/35" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search conversations"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {groupedSidebar.pinned.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/25">Pinned</div>
            <div className="space-y-1.5">
              {groupedSidebar.pinned.map(conversation => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void loadConversation(conversation.id)}
                  className={clsx(
                    'w-full cursor-pointer rounded-2xl border px-3 py-3 text-left transition duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
                    conversationId === conversation.id ? 'border-blue-500/25 bg-blue-500/10' : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Pin size={12} className="mt-0.5 text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{conversation.title}</div>
                      <div className="mt-1 text-xs text-white/35">{conversation.message_count} messages · {formatRelative(conversation.last_message_at)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/25">Recent</div>
          <div className="space-y-1.5">
            {groupedSidebar.recent.map(conversation => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => void loadConversation(conversation.id)}
                className={clsx(
                  'group w-full cursor-pointer rounded-2xl border px-3 py-3 text-left transition duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
                  conversationId === conversation.id ? 'border-blue-500/25 bg-blue-500/10' : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{conversation.title}</div>
                    <div className="mt-1 text-xs text-white/35">{conversation.message_count} messages · {formatRelative(conversation.last_message_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-transparent">
      {sidebarOpen && (
        <>
          <div
            className="absolute inset-0 z-20 hidden bg-black/45 backdrop-blur-[2px] lg:block xl:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 z-30 hidden shadow-[18px_0_48px_rgba(0,0,0,0.35)] lg:block xl:hidden">
            {conversationSidebar}
          </div>
          <div className="hidden shrink-0 border-r border-white/[0.06] xl:flex">
            {conversationSidebar}
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[rgba(8,13,26,0.82)] px-5 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(value => !value)}
              className="hidden cursor-pointer rounded-xl p-2 text-white/40 transition hover:bg-white/5 hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-blue-500/30 lg:inline-flex"
              aria-label={sidebarOpen ? 'Hide conversations' : 'Show conversations'}
              title={sidebarOpen ? 'Hide conversations' : 'Show conversations'}
            >
              {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-emerald-500/12 text-blue-100 shadow-glow-sm ring-1 ring-white/10">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">{currentConversation?.title || 'Agency Chat'}</h1>
              <p className="text-xs text-[#8B9DBE]">
                {companyState?.agents.length || 0} agents · {companyState?.workflows.length || 0} workflows · {connected ? 'live now' : 'reconnecting'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/60 md:inline-flex">
              <span className={clsx('h-2 w-2 rounded-full', connected ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]' : 'bg-amber-300')} />
              {connected ? 'Realtime connected' : 'Realtime reconnecting'}
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-white/60 md:inline-flex">
              <Users size={12} className="text-blue-300" />
              {activeAgentCount} active agents
            </div>
            <button
              type="button"
              onClick={() => setContextOpen(value => !value)}
              className="hidden cursor-pointer rounded-xl border border-white/10 px-3 py-2 text-xs text-white/65 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 lg:inline-flex"
            >
              Company Context {contextOpen ? <ChevronRight size={14} className="ml-1 rotate-90" /> : <ChevronRight size={14} className="ml-1" />}
            </button>
            {conversationId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu(value => !value)}
                  className="rounded-xl border border-white/10 p-2 text-white/55 transition hover:bg-white/5 hover:text-white"
                >
                  <MoreHorizontal size={16} />
                </button>
                {showMenu && currentConversation && (
                  <div className="absolute right-0 top-11 z-30 w-48 rounded-2xl border border-white/10 bg-[#0f1520]/95 p-2 shadow-2xl backdrop-blur-xl">
                    <button type="button" onClick={() => pinMutation.mutate(currentConversation.id)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white">
                      <Pin size={14} /> {currentConversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt('Rename conversation', currentConversation.title)
                        if (next?.trim()) renameMutation.mutate({ id: currentConversation.id, title: next.trim() })
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
                    >
                      <FileText size={14} /> Rename conversation
                    </button>
                    <button type="button" onClick={() => conversationId && deleteMutation.mutate(conversationId)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-200 transition hover:bg-red-500/10">
                      <Trash2 size={14} /> Delete conversation
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
              {authWarning && (
                <div className="mx-auto mb-5 max-w-5xl rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <div className="font-medium">Company Chat needs your session again</div>
                  <div className="mt-1 text-amber-100/75">{authWarning}</div>
                </div>
              )}
              {messages.length === 0 ? (
            <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center text-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-blue-300">
                    <Sparkles size={13} /> Chief of Staff Online
                  </div>
                  <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {founderName}</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#8B9DBE]">
                    Ask for status, run workflows, analyze files, and direct your agency from one command surface.
                  </p>

                  <div className="mt-8 grid w-full gap-4 md:grid-cols-3">
                    {quickCards.map(card => (
                      <EmptyPromptCard key={card.title} icon={card.icon} title={card.title} prompt={card.prompt} onPick={setInput} />
                    ))}
                  </div>

                  <div className="mt-8 grid w-full max-w-3xl gap-3 md:grid-cols-3">
                    {[
                      { icon: <Search size={16} />, label: 'Research', value: '@Maya research this week\'s competitor moves' },
                      { icon: <BarChart3 size={16} />, label: 'Analytics', value: '/analytics' },
                      { icon: <CheckCircle2 size={16} />, label: 'Approve all', value: '/approve-all' },
                      { icon: <FileText size={16} />, label: 'Summary', value: '/summary' },
                      { icon: <Zap size={16} />, label: 'Run workflow', value: 'Run the weekly research workflow' },
                      { icon: <Users size={16} />, label: 'Team status', value: '/status' },
                    ].map(item => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setInput(item.value)}
                        className="glass-card cursor-pointer rounded-2xl px-4 py-3 text-left transition duration-150 hover:border-blue-500/25 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      >
                        <div className="mb-2 text-blue-300">{item.icon}</div>
                        <div className="text-sm font-medium text-white">{item.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-4">
                  {messages.map((message, index) => {
                    const previous = messages[index - 1]
                    const showDaySeparator = !previous || previous.createdAt.slice(0, 10) !== message.createdAt.slice(0, 10)
                    return (
                      <div key={message.id}>
                        {showDaySeparator && (
                          <div className="my-4 flex items-center gap-3">
                            <div className="h-px flex-1 bg-white/[0.06]" />
                            <span className="text-[10px] font-medium uppercase tracking-widest text-white/25">
                              {formatDayGroup(message.createdAt)}
                            </span>
                            <div className="h-px flex-1 bg-white/[0.06]" />
                          </div>
                        )}
                        <MessageBubble
                          message={message}
                          activeExecutions={activeExecutions}
                          onCopy={() => {
                            void navigator.clipboard.writeText(cleanAssistantText(message.content))
                            toast.success('Copied')
                          }}
                          onRegenerate={regenerateLast}
                          onToggleStar={() => setStarredIds(prev => prev.includes(message.id) ? prev.filter(id => id !== message.id) : [...prev, message.id])}
                          starred={starredIds.includes(message.id)}
                          onShare={() => {
                            void navigator.clipboard.writeText(message.content)
                            toast.success('Conversation snippet copied')
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-white/[0.08] bg-obsidian-925/95 px-5 py-4 backdrop-blur-xl">
              <div className="mx-auto max-w-5xl">
                <div className="mb-3 flex flex-wrap gap-2">
                  {dynamicChips.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setInput(chip)}
                      className="cursor-pointer rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-[#8B9DBE] transition duration-150 hover:border-blue-500/25 hover:bg-blue-500/10 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <form onSubmit={onSubmit} className="glass-card relative rounded-2xl p-3 shadow-glow-sm focus-within:border-blue-500/40">
                  {showCommandMenu && (
                    <CommandMenu
                      query={slashQuery}
                      activeIndex={commandIndex}
                      onSelect={applyCommand}
                      onHover={setCommandIndex}
                    />
                  )}

                  {attachments.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {attachments.map((attachment, index) => (
                        <div key={`${attachment.filename}_${index}`} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70">
                          <FileText size={12} />
                          <span>{String(attachment.filename || 'attachment')}</span>
                          <button
                            type="button"
                            onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))}
                            className="text-white/30 transition hover:text-white/70"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-end gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.04] text-obsidian-300 transition hover:bg-white/[0.08] hover:text-white"
                      title="Attach file"
                    >
                      <Paperclip size={18} />
                    </button>
                    <div className="flex-1">
                      <MentionTextarea
                        value={input}
                        onChange={setInput}
                        agents={agents}
                        rows={1}
                        minHeightClassName="min-h-11 max-h-40"
                        placeholder="Type a message... or / for commands · @Maya to tag"
                        className="max-h-40 flex-1 resize-none border-0 bg-transparent py-3 placeholder:text-obsidian-500 focus:border-transparent"
                        onKeyDown={handleInputKeyDown}
                      />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-white/30">
                        <span>Use @ to mention agents · Cmd+Enter to send</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setInput('/status')} className="rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-white/65"><AtSign size={12} className="inline mr-1" />Status</button>
                          <button type="button" onClick={() => setInput('/summary')} className="rounded-lg px-2 py-1 transition hover:bg-white/5 hover:text-white/65"><Clock3 size={12} className="inline mr-1" />Summary</button>
                        </div>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={!input.trim() || sending}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-glow-sm transition duration-150 hover:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-50"
                      title="Send"
                    >
                      {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    multiple
                    accept=".txt,.csv,.json,.md,.pdf,.xlsx"
                    onChange={handleFiles}
                  />
                </form>
              </div>
            </footer>
          </main>

          {contextOpen && (
            <aside className="hidden w-[300px] shrink-0 border-l border-white/[0.06] bg-[rgba(8,13,26,0.78)] backdrop-blur-xl lg:block">
              <div className="p-4">
                <div className="mb-4 text-sm font-semibold text-white">Company Context</div>
                <div className="space-y-4 rounded-3xl border border-white/8 bg-white/[0.03] p-4">
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/25">Team status</div>
                    <div className="space-y-2">
                      {(summary?.team_status || []).slice(0, 6).map(agent => (
                        <div key={agent.agent_id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <div className="truncate text-white">{agent.name}</div>
                            <div className="truncate text-xs text-white/30">{agent.current_task || 'Idle'}</div>
                          </div>
                          <div className={clsx('text-xs', agentStatusTone(agent.status))}>{agent.status}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/25">Recent activity</div>
                    <div className="space-y-2">
                      {(summary?.recent_artifacts || []).slice(0, 4).map((artifact, index) => (
                        <div key={`${artifact.title}_${index}`} className="text-sm">
                          <div className="truncate text-white/80">{artifact.title}</div>
                          <div className="text-xs text-white/30">{artifact.agent_name} · {formatRelative(artifact.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/25">Pending approvals</div>
                    {pendingApprovals.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => navigate('/approvals')}
                        className="w-full rounded-2xl border border-amber-400/15 bg-amber-500/10 px-3 py-3 text-left transition hover:bg-amber-500/15"
                      >
                        <div className="text-sm text-amber-100">{pendingApprovals.length} items need attention</div>
                        <div className="mt-1 text-xs text-amber-100/60">View →</div>
                      </button>
                    ) : (
                      <div className="text-sm text-white/45">Nothing waiting right now.</div>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

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
import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertCircle,
  ArrowRight,
  AtSign,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Clock3,
  Copy,
  FileText,
  Loader2,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
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
import { agentsApi, approvalsApi, companyApi, companyChatApi, ctoApi, dashboardApi } from '../api/client'
import { MentionTextarea } from '../components/ui/MentionTextarea'
import { GoalCard } from '../components/mission/GoalCard'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { MarkdownContent, cleanMarkdownContent } from '../components/ui/MarkdownContent'
import { AnimatedList, AnimatedListItem } from '../components/ui/magicui/AnimatedList'
import { useAuth } from '../contexts/AuthContext'
import { useWebSocket } from '../contexts/WebSocketContext'
import { toast } from '../lib/toast'
import type {
  Agent,
  ChatActionResult,
  CompanyChatStreamEvent,
  CompanyConversationMessage,
  CompanyConversationSummary,
  CTOTaskSummary,
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
  isProactive?: boolean
  streaming?: boolean
  pending?: boolean
  syncing?: boolean
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
    isProactive: Boolean(item.is_proactive),
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

function historyMatchesLocalState(
  historyItems: CompanyConversationMessage[],
  localMessages: ChatMessage[],
) {
  const localConversation = localMessages.filter(message => message.role !== 'system')
  if (historyItems.length < localConversation.length) return false

  const lastLocal = [...localConversation].reverse()[0]
  const lastHistory = [...historyItems].reverse()[0]
  if (!lastLocal || !lastHistory) return true
  if (lastLocal.role !== lastHistory.role) return false

  const localContent = lastLocal.content.trim()
  const historyContent = (lastHistory.content || '').trim()
  const localActionCount = lastLocal.actions?.length || 0
  const historyActionCount = lastHistory.actions?.length || 0

  if (localActionCount > historyActionCount) return false

  if (lastLocal.role === 'assistant') {
    if (localContent) return localContent === historyContent
    if (localActionCount > 0) return historyActionCount >= localActionCount
    return true
  }

  return localContent === historyContent
}

function MarkdownMessage({ content }: { content: string }) {
  return <MarkdownContent content={content} />
}

function ProactiveMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex w-full justify-start">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex max-w-[85%] gap-3"
      >
        <div
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            boxShadow: '0 0 12px rgba(99,102,241,0.40)',
          }}
        >
          CTO
        </div>

        <div
          className="rounded-2xl rounded-bl-sm p-4"
          style={{
            background: 'rgba(99,102,241,0.07)',
            border: '1px solid rgba(99,102,241,0.20)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="mb-2 flex items-center gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-400">
              CTO Update
            </span>
            <span className="font-mono text-[10px] text-ink-muted">
              · proactive
            </span>
          </div>

          <MarkdownMessage content={message.content} />
        </div>
      </motion.div>
    </div>
  )
}

function roleColorTone(role?: string | null) {
  const value = (role || '').toLowerCase()
  if (value.includes('sales') || value.includes('outreach')) return 'from-amber-500/80 to-red-500/70'
  if (value.includes('research') || value.includes('analysis')) return 'from-indigo-500/80 to-violet-500/70'
  if (value.includes('ops') || value.includes('automation')) return 'from-emerald-500/80 to-emerald-500/70'
  if (value.includes('design') || value.includes('creative')) return 'from-violet-500/80 to-pink-500/70'
  return 'from-indigo-500/80 to-violet-500/70'
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
  if (action.type === 'mission_created' && action.mission_id) return `/missions/${action.mission_id}/report`
  if (action.page === 'approvals') return '/approvals'
  if (action.page === 'agents') return '/agents'
  if (action.page === 'workflows') return '/workflows'
  if (action.page === 'messages') return '/messages'
  if (action.page === 'company-chat') return '/company-chat'
  if (action.page === 'analytics') return '/analytics'
  if (action.mission_id) return '/missions'
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
    <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-emerald-50">Execution live</div>
        <button
          type="button"
          onClick={onOpen}
          className="text-xs text-emerald-100/70 transition hover:text-emerald-50"
        >
          View live →
        </button>
      </div>
      <div className="mb-3 h-2 rounded-full bg-black/25">
        <div
          className={clsx(
            'h-2 rounded-full transition-all',
            state.status === 'completed' ? 'bg-emerald-400' : 'bg-emerald-300',
          )}
          style={{ width: `${progressValue}%` }}
        />
      </div>
      <div className="space-y-1.5 text-xs text-emerald-50/80">
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

  if (action.type === 'mission_created' && action.mission_id) {
    return (
      <GoalCard
        missionId={action.mission_id}
        missionTitle={action.mission_title || action.label || action.message || 'Mission'}
        initialTasks={[]}
      />
    )
  }

  if (isStandupAction(action)) {
    return (
      <div
        className="mt-3 overflow-hidden rounded-2xl border border-emerald-400/15 bg-white/[0.03]"
        style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-white/70">Standup in progress</span>
          <button
            type="button"
            onClick={() => navigate(`/executions/${action.execution_id}`)}
            className="ml-auto text-xs text-indigo-400/70 transition hover:text-indigo-400"
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
        isError ? 'border-red-400/20 bg-red-500/10 text-red-100' : 'border-blue-500/20 bg-blue-500/10 text-[#DBEAFE]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={clsx('grid h-9 w-9 place-items-center rounded-xl', isError ? 'bg-red-500/20' : 'bg-blue-500/15 text-blue-300')}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">{action.label || action.message || 'Action completed'}</div>
          {action.message && action.label ? <div className="mt-1 text-xs text-white/65">{action.message}</div> : null}

          {action.type === 'show_status' && action.agent_statuses && (
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3">
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
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3 text-sm leading-6 text-white/85">
              <MarkdownMessage content={action.summary} />
            </div>
          )}

          {action.type === 'company_insight' && action.insight && (
            <blockquote className="mt-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-3 text-sm leading-6 text-white/85">
              {action.insight}
            </blockquote>
          )}

          {action.type === 'analyze_file' && action.analysis && (
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3 text-sm leading-6 text-white/85">
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-white/35">{action.filename || 'Attachment'}</div>
              <MarkdownMessage content={action.analysis} />
            </div>
          )}

          {action.type === 'show_analytics' && action.data && (
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3 text-sm text-white/85">
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
            className="rounded-xl border border-white/[0.08] px-2 py-1 text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
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
  const visibleAssistantContent = !isUser && !isSystem ? cleanMarkdownContent(message.content) : message.content.trim()
  const actionOnlyAssistant =
    !isUser &&
    !isSystem &&
    !message.failed &&
    !message.streaming &&
    !visibleAssistantContent &&
    Boolean(message.actions?.length)
  const emptyAssistantFallback =
    !isUser &&
    !isSystem &&
    !message.failed &&
    !message.streaming &&
    !visibleAssistantContent &&
    !message.actions?.length

  if (message.isProactive) {
    return <ProactiveMessage message={message} />
  }

  if (isSystem) {
    return (
      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/10 px-4 py-2 text-xs text-emerald-100">
        <Sparkles size={13} />
        <span>{message.content}</span>
        <span className="text-emerald-100/50">{formatTime(message.createdAt)}</span>
      </div>
    )
  }

  return (
    <div className={clsx('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      <div className={clsx(isUser ? 'max-w-[72%] flex flex-col items-end' : 'max-w-[80%]')}>
        <motion.div
          initial={isUser ? { opacity: 0, y: 8, scale: 0.95 } : { opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className={clsx(
            'relative px-4 py-3 text-[13px] leading-6',
            isUser ? 'rounded-[18px] rounded-br-[4px] text-white' : 'rounded-[18px] rounded-bl-[4px] text-[#F0F6FF]',
            message.pending && 'opacity-80',
            !isUser && !message.failed && 'card',
            message.failed && 'card card-red',
          )}
          style={
            isUser
              ? {
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }
              : undefined
          }
        >
          <div>
            {message.failed ? (
              <div className="flex items-start gap-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
                <div className="text-red-200">
                  <MarkdownMessage content={message.content} />
                </div>
              </div>
            ) : !isUser && message.streaming && !message.content.trim() ? (
              <div className="flex items-center gap-2 text-sm text-[#8B9DBE]">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300 [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300 [animation-delay:240ms]" />
                </div>
                <span>Thinking...</span>
              </div>
            ) : actionOnlyAssistant ? (
              <div className="flex items-center gap-2 text-sm text-[#8B9DBE]">
                <Sparkles size={14} className="text-indigo-300" />
                <span>Handled below</span>
              </div>
            ) : emptyAssistantFallback ? (
              <div className="flex items-center gap-2 text-sm text-[#D7E3F4]">
                <Sparkles size={14} className="text-indigo-300" />
                <span>Got it.</span>
              </div>
            ) : isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MarkdownMessage content={message.content} />
            )}
          </div>

          {message.streaming && <span className="ml-2 inline-block h-2 w-2 animate-blink rounded-full bg-indigo-300 align-middle" />}
          {!isUser && message.actions?.map((action, index) => (
            <ActionCard
              key={`${message.id}_${action.type}_${action.execution_id || action.workflow_id || action.agent_id || index}`}
              action={action}
              activeExecutions={activeExecutions}
            />
          ))}
        </motion.div>
        <div className="mt-1 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
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
    <div className="absolute bottom-full left-0 mb-3 w-[360px] rounded-2xl border border-white/[0.08] bg-[#0f1520]/95 p-2 shadow-2xl backdrop-blur-xl">
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
                activeIndex === index ? 'bg-blue-600/12 text-white' : 'hover:bg-white/5',
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
      className="card group cursor-pointer rounded-2xl p-4 text-left transition duration-150 hover:-translate-y-0.5 hover:border-indigo-500/25 hover:shadow-glow-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 motion-reduce:hover:translate-y-0"
    >
      <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-indigo-300 group-hover:bg-indigo-500/12">
        {icon}
      </div>
      <div className="font-medium text-white">{title}</div>
      <div className="mt-2 text-xs leading-5 text-[#8B9DBE]">{prompt}</div>
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
  const menuRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const seenEventRef = useRef<string | null>(null)
  const streamingConversationRef = useRef<string | null>(null)
  const pendingHistorySyncConversationRef = useRef<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(routeConversationId || null)
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [isDesktopSidebar, setIsDesktopSidebar] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  )
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false,
  )
  const [contextOpen, setContextOpen] = useState(false)
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

  messagesRef.current = messages

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
  const { data: ctoTasks = [] } = useQuery({
    queryKey: ['cto-tasks'],
    queryFn: ctoApi.getTasks,
    refetchInterval: 15_000,
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
      const historyConversationId = historyQuery.data.conversation?.id || conversationId
      const localMessages = messagesRef.current
      const isPendingHistorySync =
        pendingHistorySyncConversationRef.current &&
        historyConversationId === pendingHistorySyncConversationRef.current

      if (isPendingHistorySync) {
        if (!historyMatchesLocalState(historyQuery.data.messages, localMessages)) {
          return
        }
        pendingHistorySyncConversationRef.current = null
      }

      setMessages(toChatMessages(historyQuery.data.messages))
    }
  }, [conversationId, historyQuery.data])

  useEffect(() => {
    const handleResize = () => {
      const nextIsDesktop = window.innerWidth >= 1024
      setIsDesktopSidebar(nextIsDesktop)
      if (nextIsDesktop) {
        setSidebarOpen(true)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!showMenu) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMenu(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [showMenu])

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        setSidebarOpen(v => !v)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

    if (eventType === 'cto_proactive_message') {
      if (event.conversation_id && event.conversation_id === conversationId) {
        void queryClient.invalidateQueries({ queryKey: ['company-chat-history', conversationId] })
      } else if (typeof event.message === 'string' && event.message.trim()) {
        toast.custom(
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-500 text-[9px] font-bold text-white">CTO</div>
            <span className="text-sm">{event.message.slice(0, 60)}...</span>
          </div>,
          { duration: 6000, icon: null },
        )
      }
      void queryClient.invalidateQueries({ queryKey: ['cto-tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['company-chat-conversations'] })
      return
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
    if (!isDesktopSidebar) {
      setSidebarOpen(false)
    }
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
    streamingConversationRef.current = conversationId
    pendingHistorySyncConversationRef.current = conversationId
    let resolvedConversationId = conversationId

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
            resolvedConversationId = event.conversation_id
            streamingConversationRef.current = event.conversation_id
            pendingHistorySyncConversationRef.current = event.conversation_id
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
              item.id === userId
                ? { ...item, pending: false }
                : item.id === assistantId
                  ? { ...item, streaming: false, syncing: true }
                  : item,
            ))
          }
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['company-chat-conversations'] })
      if (resolvedConversationId) {
        await queryClient.invalidateQueries({ queryKey: ['company-chat-history', resolvedConversationId] })
      }
      await queryClient.invalidateQueries({ queryKey: ['cto-tasks'] })
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
              syncing: false,
              failed: true,
              content: `I could not reach the company command layer: ${messageText}`,
            }
          : item,
      ))
      toast.error(messageText)
    } finally {
      streamingConversationRef.current = null
      if (!resolvedConversationId) {
        pendingHistorySyncConversationRef.current = null
      }
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

  const quickCards = useMemo(() => [
    { icon: <Clock3 size={18} />, title: 'Handle this week', prompt: "Brief the whole agency on this week's priorities" },
    { icon: <Search size={18} />, title: 'Run client research', prompt: 'Research [client] and prepare a briefing' },
    { icon: <FileText size={18} />, title: 'Weekly deliverables', prompt: 'Handle all client weekly deliverables' },
    { icon: <Workflow size={18} />, title: 'Mission mode', prompt: 'Take on a multi-step goal as a mission' },
    { icon: <Users size={18} />, title: 'Team status', prompt: 'How is the team doing? Any blockers?' },
    { icon: <BarChart3 size={18} />, title: 'Agency health', prompt: 'Give me a full picture of the agency' },
  ], [])

  const conversationSidebar = (
    <aside
      className="flex h-full w-[260px] shrink-0 flex-col border-r border-white/[0.07] bg-transparent"
    >
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <Building2 size={15} />
          </div>
          <span className="text-sm font-bold tracking-tight text-white">Agency Chat</span>
        </div>
        <button
          type="button"
          onClick={handleNewConversation}
          className="btn-icon"
          title="New conversation"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <Search size={14} className="text-[#4B5A73]" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#4B5A73]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-3 pb-1 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'rgba(255,255,255,0.18)' }}>
          Recent
        </p>
        <div className="space-y-1">
          {sidebarConversations.map(conversation => {
            const conversationTitle = conversation.title?.trim() || 'New conversation'

            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => void loadConversation(conversation.id)}
                className={clsx(
                  'row relative min-h-[44px] w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-all',
                  conversationId === conversation.id
                    ? 'bg-indigo-500/[0.08] border-l-2 border-indigo-500'
                    : 'hover:bg-white/[0.04]',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/80 to-violet-500/70 text-[10px] font-bold text-white">
                    {conversationTitle.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{conversationTitle}</div>
                    <div className="mt-0.5 truncate text-xs text-[#8B9DBE]">
                      {conversation.message_count} messages · {formatRelative(conversation.last_message_at)}
                    </div>
                  </div>
                  {conversation.pinned ? <Pin size={12} className="shrink-0 text-amber-300" /> : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-white/[0.07] p-3">
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs text-[#8B9DBE] transition hover:bg-white/[0.04] hover:text-white"
        >
          <span className="flex items-center gap-2">
            <PanelLeftClose size={14} className="transition-colors hover:text-indigo-300" />
            Hide sidebar
          </span>
          <span className="font-mono text-[10px] text-[#4B5A73]">⌘\</span>
        </button>
      </div>
    </aside>
  )

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-row overflow-hidden bg-transparent">
      {isDesktopSidebar ? (
        sidebarOpen ? (
          <div className="hidden shrink-0 lg:flex">
            {conversationSidebar}
          </div>
        ) : null
      ) : sidebarOpen ? (
        <>
          <div
            className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px] lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 z-30 shadow-[18px_0_48px_rgba(0,0,0,0.35)] lg:hidden">
            {conversationSidebar}
          </div>
        </>
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {!sidebarOpen && (
          <div className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="card group fixed left-2 top-1/2 z-20 flex -translate-y-1/2 cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-[#2A2A2A] bg-[#111111] px-2 py-4 transition-all duration-200 hover:-translate-x-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              title="Open sidebar"
            >
              <PanelLeftOpen size={15} className="text-[#4B5A73] transition-colors duration-150 group-hover:text-indigo-300" />
              <div className="flex flex-col items-center gap-0.5">
                {'Chat'.split('').map((char, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-semibold tracking-wide text-[#4B5A73] transition-colors duration-150 group-hover:text-[#8B9DBE]"
                  >
                    {char}
                  </span>
                ))}
              </div>
            </button>
          </div>
        )}
        <header className="relative z-20 flex h-16 shrink-0 items-center justify-between overflow-visible border-b border-white/[0.08] bg-[rgba(8,13,26,0.82)] px-5 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/12 text-indigo-100 shadow-glow-sm ring-1 ring-white/10">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">{currentConversation?.title || 'Agency Chat'}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#8B9DBE]">
                <span className={clsx('badge', connected ? 'badge-emerald' : 'badge-amber')}>{connected ? 'Realtime' : 'Reconnecting'}</span>
                <span className="badge badge-glass">{activeAgentCount} active agents</span>
                <button
                  type="button"
                  onClick={() => setContextOpen(value => !value)}
                  className="inline-flex items-center gap-1 text-[#8B9DBE] transition hover:text-white"
                >
                  Company Context <ChevronRight size={13} className={contextOpen ? 'rotate-90' : ''} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {conversationId && (
              <div ref={menuRef} className="relative z-30">
                <button
                  type="button"
                  onClick={() => setShowMenu(value => !value)}
                  className="rounded-xl border border-white/[0.08] p-2 text-white/55 transition hover:bg-white/5 hover:text-white"
                  aria-label="Conversation actions"
                  aria-expanded={showMenu}
                >
                  <MoreHorizontal size={16} />
                </button>
                {showMenu && currentConversation && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-2xl border border-white/[0.08] bg-[#0f1520]/95 p-2 shadow-2xl backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false)
                        pinMutation.mutate(currentConversation.id)
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
                    >
                      <Pin size={14} /> {currentConversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false)
                        const next = window.prompt('Rename conversation', currentConversation.title)
                        if (next?.trim()) renameMutation.mutate({ id: currentConversation.id, title: next.trim() })
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
                    >
                      <FileText size={14} /> Rename conversation
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false)
                        if (conversationId) deleteMutation.mutate(conversationId)
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10"
                    >
                      <Trash2 size={14} /> Delete conversation
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">
              {authWarning && (
                <div className="mx-auto mb-5 max-w-5xl rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <div className="font-medium">Company Chat needs your session again</div>
                  <div className="mt-1 text-amber-100/75">{authWarning}</div>
                </div>
              )}
              {messages.length === 0 ? (
                <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-gradient-to-br from-indigo-500/20 to-violet-500/12 text-indigo-200 animate-float">
                    <Building2 size={34} />
                  </div>
                  <h2 className="mt-6 text-4xl font-semibold tracking-tight text-white">Agency Chat</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#8B9DBE]">
                    Command your AI agency in plain language.
                  </p>

                  <div className="mt-8 grid w-full gap-4 md:grid-cols-3">
                    {quickCards.map(card => (
                      <EmptyPromptCard key={card.title} icon={card.icon} title={card.title} prompt={card.prompt} onPick={setInput} />
                    ))}
                  </div>

                  <div className="mt-8 flex w-full max-w-4xl flex-wrap items-center justify-center gap-3">
                    {dynamicChips.map(chip => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setInput(chip)}
                        className="rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs text-[#8B9DBE] transition hover:border-indigo-500/25 hover:bg-indigo-600/[0.06] hover:text-indigo-300"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <AnimatedList className="mx-auto flex max-w-5xl flex-col gap-5 pb-4">
                  {messages.map((message, index) => {
                    const previous = messages[index - 1]
                    const showDaySeparator = !previous || previous.createdAt.slice(0, 10) !== message.createdAt.slice(0, 10)
                    return (
                      <AnimatedListItem key={message.id}>
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
                            void navigator.clipboard.writeText(cleanMarkdownContent(message.content))
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
                      </AnimatedListItem>
                    )
                  })}
                </AnimatedList>
              )}
            </div>

            <footer className="sticky bottom-0 z-10 shrink-0 border-t border-white/[0.08] bg-[rgba(8,13,26,0.95)] px-5 py-4 backdrop-blur-xl">
              <div className="mx-auto max-w-5xl">
                <div className="mb-3 flex flex-wrap gap-2">
                  {dynamicChips.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setInput(chip)}
                      className="cursor-pointer rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-medium text-[#8B9DBE] transition duration-150 hover:border-indigo-500/25 hover:bg-indigo-600/[0.06] hover:text-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 backdrop-blur-sm"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <form onSubmit={onSubmit} className="card relative rounded-2xl px-4 py-3 shadow-glow-sm focus-within:border-indigo-500/40">
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
                        <div key={`${attachment.filename}_${index}`} className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-white/70">
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
                      className="btn-icon h-9 w-9 shrink-0"
                      title="Attach file"
                    >
                      <Paperclip size={16} />
                    </button>
                    <div className="flex-1">
                      <MentionTextarea
                        value={input}
                        onChange={setInput}
                        agents={agents}
                        rows={1}
                        minHeightClassName="min-h-11 max-h-40"
                        placeholder="Type a command or @mention an agent..."
                        className="max-h-40 flex-1 resize-none border-0 bg-transparent py-2 placeholder:text-ink-faint focus:border-transparent"
                        onKeyDown={handleInputKeyDown}
                      />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-white/30">
                        <span>Use @ to mention agents · Cmd+Enter to send</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setInput('/status')} className="btn-ghost px-2 py-1 text-xs"><AtSign size={12} className="inline mr-1" />Status</button>
                          <button type="button" onClick={() => setInput('/summary')} className="btn-ghost px-2 py-1 text-xs"><Clock3 size={12} className="inline mr-1" />Summary</button>
                        </div>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={!input.trim() || sending}
                      className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-btn-primary transition duration-150 hover:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-50"
                      title="Send"
                    >
                      {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
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
            <aside className="hidden w-[320px] shrink-0 border-l border-white/[0.06] bg-[rgba(8,13,26,0.78)] p-4 backdrop-blur-xl lg:block">
              <div className="space-y-3">
                <div className="card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="section-title mb-0 border-0 pb-0">CTO Tasks</p>
                    {ctoTasks.length > 0 && (
                      <span className="badge badge-indigo">{ctoTasks.length}</span>
                    )}
                  </div>

                  {ctoTasks.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      No active tasks. Ask the CTO to handle something.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {ctoTasks.map((task: CTOTaskSummary) => (
                        <div
                          key={task.id}
                          className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                        >
                          <div className="mt-0.5 shrink-0">
                            {task.status === 'monitoring' && (
                              <div className="status-dot dot-blue dot-live" />
                            )}
                            {task.status === 'waiting_ceo' && (
                              <div className="status-dot dot-amber dot-live" />
                            )}
                            {task.status === 'complete' && (
                              <div className="status-dot dot-emerald" />
                            )}
                            {task.status === 'active' && (
                              <div className="status-dot dot-blue" />
                            )}
                            {task.status === 'failed' && (
                              <div className="status-dot dot-red" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-white">
                              {task.original_request?.slice(0, 55)}
                            </p>
                            {task.ceo_action_needed && (
                              <p className="mt-0.5 text-[11px] text-amber-400">
                                Needs you: {task.ceo_action_needed.slice(0, 40)}
                              </p>
                            )}
                            {task.status === 'complete' && (
                              <p className="mt-0.5 text-[11px] text-emerald-400">
                                Complete
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card rounded-2xl p-3">
                  <div className="section-title mb-3 border-0 pb-0">Team Status</div>
                  <div className="space-y-2.5">
                    {(summary?.team_status || []).slice(0, 6).map(agent => {
                      const agentName = agent.name?.trim() || 'Agent'
                      return (
                        <div key={agent.agent_id} className="flex items-center gap-2.5">
                          <div className={clsx('status-dot', agent.status === 'working' ? 'dot-live dot-green' : agent.requires_ceo_action ? 'dot-amber' : 'dot-muted')} />
                          <div className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[10px] font-bold text-white', roleColorTone(agent.role || agentName))}>
                            {agentName.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-white">{agentName}</p>
                            <p className="truncate text-[11px] text-[#8B9DBE]">{agent.role || agent.current_task || 'Idle'}</p>
                          </div>
                          <div className="text-right text-[11px] text-[#8B9DBE]">
                            {agent.status_label || agent.status}
                          </div>
                        </div>
                      )
                    })}
                    {(summary?.team_status || []).length === 0 && (
                      <p className="text-xs text-[#8B9DBE]">No agents active.</p>
                    )}
                  </div>
                </div>

                <div className="card rounded-2xl p-3">
                  <div className="section-title mb-3 border-0 pb-0">Recent Activity</div>
                  <div className="space-y-2">
                    {(summary?.recent_artifacts || []).slice(0, 4).map((artifact, index) => (
                      <div key={`${artifact.title}_${index}`} className="flex items-start gap-2">
                        <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400/70" />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-[#F0F6FF]">{artifact.title}</p>
                          <p className="mt-0.5 text-[11px] text-[#8B9DBE]">
                            {artifact.agent_name} · {formatRelative(artifact.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {(summary?.recent_artifacts || []).length === 0 && (
                      <p className="text-xs text-[#8B9DBE]">No activity yet.</p>
                    )}
                  </div>
                </div>

                {pendingApprovals.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => navigate('/approvals')}
                    className="card card-amber w-full rounded-2xl p-3 text-left transition duration-150 hover:border-amber-500/35"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/25">
                        <AlertCircle size={13} className="text-amber-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-amber-200">
                          {pendingApprovals.length} pending · Review →
                        </p>
                      </div>
                    </div>
                  </button>
                ) : (
                  <div className="card rounded-2xl p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                        <CheckCircle2 size={13} className="text-emerald-400" />
                      </div>
                      <p className="text-xs text-[#8B9DBE]">Nothing waiting right now.</p>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

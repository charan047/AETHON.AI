import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, isToday, isYesterday, parseISO } from 'date-fns'
import { clsx } from 'clsx'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  MoreHorizontal,
  Send,
  X,
  Zap,
} from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { agentsApi, messagesApi } from '../api/client'
import { MentionTextarea } from '../components/ui/MentionTextarea'
import { useAuth } from '../contexts/AuthContext'
import { useWebSocket } from '../contexts/WebSocketContext'
import { toast } from '../lib/toast'
import type { Agent, ConversationSummary, DirectMessage } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = parseISO(iso)
    if (isToday(d)) return formatDistanceToNow(d, { addSuffix: false }).replace('about ', '') + ' ago'
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'EEE MMM d')
  } catch {
    return ''
  }
}

function dayLabel(iso: string): string {
  try {
    const d = parseISO(iso)
    if (isToday(d)) return 'Today'
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'EEEE, MMMM d')
  } catch {
    return ''
  }
}

function dayKey(iso: string): string {
  try { return iso.slice(0, 10) } catch { return '' }
}

function avatarInitial(name: string | null | undefined): string {
  return (name || '?')[0].toUpperCase()
}

const FALLBACK_ROLE_COLORS = ['#A78BFA', '#60A5FA', '#34D399', '#F59E0B', '#F87171', '#38BDF8']

function fallbackRoleColor(seed: string) {
  const index = [...seed].reduce((acc, char) => acc + char.charCodeAt(0), 0) % FALLBACK_ROLE_COLORS.length
  return FALLBACK_ROLE_COLORS[index]
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgentAvatar({
  name,
  color,
  size = 40,
  isOnline = false,
  className,
}: {
  name: string | null | undefined
  color: string
  size?: number
  isOnline?: boolean
  className?: string
}) {
  return (
    <div className={clsx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-full font-semibold text-white"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${color}cc, ${color}66)`,
          border: `1.5px solid ${color}44`,
          fontSize: size * 0.38,
        }}
      >
        {avatarInitial(name)}
      </div>
      {isOnline && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2 border-[#0a0f1a] bg-emerald-400"
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </div>
  )
}

function ScheduledReplyBubble({
  message,
  onCancel,
}: {
  message: DirectMessage
  onCancel: () => void
}) {
  if (!message.scheduled_reply_at || !message.scheduled_reply_job_id) return null
  let fireLabel = ''
  try {
    fireLabel = format(parseISO(message.scheduled_reply_at), 'h:mm a')
  } catch {
    fireLabel = 'later'
  }
  return (
    <div className="flex justify-end px-4">
      <div className="max-w-[420px] rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm">
        <div className="flex items-center gap-2 text-amber-300">
          <Clock size={14} />
          <span>Agent will send you an update at {fireLabel}</span>
          <button
            onClick={onCancel}
            className="ml-auto rounded-full p-0.5 text-amber-400/60 transition hover:bg-amber-400/10 hover:text-amber-200"
            title="Cancel scheduled reply"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

function SchedulePopover({
  onSelect,
  onClose,
}: {
  onSelect: (minutes: number) => void
  onClose: () => void
}) {
  const options = [
    { label: '30 minutes', minutes: 30 },
    { label: '1 hour', minutes: 60 },
    { label: '2 hours', minutes: 120 },
    { label: '4 hours', minutes: 240 },
    { label: 'Tomorrow morning', minutes: 60 * 16 }, // ~16h
  ]
  return (
    <div className="absolute bottom-full mb-2 left-0 z-30 w-56 rounded-2xl border border-white/10 bg-[#0f1520]/95 p-2 shadow-2xl backdrop-blur-xl">
      <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">
        Ask for follow-up in…
      </div>
      {options.map(opt => (
        <button
          key={opt.minutes}
          onClick={() => { onSelect(opt.minutes); onClose() }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
        >
          <Clock size={13} className="text-amber-400" />
          {opt.label}
        </button>
      ))}
      <button
        onClick={onClose}
        className="mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-white/30 transition hover:text-white/60"
      >
        Cancel
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DirectMessages() {
  const { agentId: paramAgentId } = useParams<{ agentId?: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const { lastEvent } = useWebSocket()
  const queryClient = useQueryClient()

  const [activeAgentId, setActiveAgentId] = useState<string | null>(paramAgentId ?? null)
  const [compose, setCompose] = useState('')
  const [scheduleMins, setScheduleMins] = useState<number | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const [showRetention, setShowRetention] = useState(false)
  const [showTeamConvs, setShowTeamConvs] = useState(false)
  const [optimisticMessages, setOptimisticMessages] = useState<DirectMessage[]>([])
  const [liveAgentReply, setLiveAgentReply] = useState<DirectMessage | null>(null)
  const [newMsgBanner, setNewMsgBanner] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  const appendThreadMessage = useCallback((agentId: string, message: DirectMessage) => {
    queryClient.setQueryData(['dm-thread', agentId], (current: any) => {
      if (!current) return current
      const existingMessages = Array.isArray(current.messages) ? current.messages : []
      if (existingMessages.some((item: DirectMessage) => item.id === message.id)) {
        return current
      }
      return {
        ...current,
        messages: [...existingMessages, message],
      }
    })
  }, [queryClient])

  const dropMatchingOptimisticMessage = useCallback((agentId: string, content?: string) => {
    if (!content) return
    setOptimisticMessages(prev => {
      const index = prev.findIndex(message =>
        message.sender_type === 'ceo' &&
        message.to_agent_id === agentId &&
        message.content === content,
      )
      if (index === -1) return prev
      return prev.filter((_, messageIndex) => messageIndex !== index)
    })
  }, [])

  // ── Queries ──────────────────────────────────────────────────────────────

  const convsQuery = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: messagesApi.conversations,
    refetchInterval: 30_000,
  })

  const fallbackAgentsQuery = useQuery({
    queryKey: ['dm-fallback-agents'],
    queryFn: agentsApi.list,
    enabled: convsQuery.isError || (convsQuery.data?.conversations?.length ?? 0) === 0,
    staleTime: 30_000,
  })

  const threadQuery = useQuery({
    queryKey: ['dm-thread', activeAgentId],
    queryFn: () => messagesApi.thread(activeAgentId!),
    enabled: Boolean(activeAgentId),
    staleTime: 0,
  })

  const teamConvsQuery = useQuery({
    queryKey: ['team-conversations'],
    queryFn: () => messagesApi.teamConversations(20),
    enabled: showTeamConvs,
    staleTime: 60_000,
  })

  // ── Sync URL param → activeAgentId ────────────────────────────────────
  useEffect(() => {
    if (paramAgentId && paramAgentId !== activeAgentId) {
      setActiveAgentId(paramAgentId)
    }
  }, [paramAgentId]) // eslint-disable-line

  const fallbackConversations: ConversationSummary[] = (fallbackAgentsQuery.data ?? [])
    .filter(agent => agent.is_active)
    .map(agent => ({
      agent_id: agent.id,
      agent_name: agent.name,
      persona_name: agent.persona_name ?? null,
      role_slug: agent.role_slug ?? null,
      role_color: fallbackRoleColor(`${agent.role_slug ?? ''}:${agent.id}`),
      last_message: null,
      last_message_at: null,
      last_sender_type: null,
      unread_count: 0,
      is_online: false,
      current_status: 'idle',
    }))

  const conversations = (convsQuery.data?.conversations?.length ?? 0) > 0
    ? (convsQuery.data?.conversations ?? [])
    : fallbackConversations

  // Auto-select first conversation if none chosen
  useEffect(() => {
    if (!activeAgentId && conversations.length) {
      const first = conversations[0]
      setActiveAgentId(first.agent_id)
      navigate(`/messages/${first.agent_id}`, { replace: true })
    }
  }, [conversations, activeAgentId, navigate])

  // Clear optimistic messages when real thread loads
  useEffect(() => {
    if (threadQuery.data) setOptimisticMessages([])
  }, [threadQuery.data])

  useEffect(() => {
    setLiveAgentReply(null)
  }, [activeAgentId])

  // ── Scroll tracking ───────────────────────────────────────────────────
  const handleFeedScroll = useCallback(() => {
    const el = feedRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    isNearBottomRef.current = nearBottom
    if (nearBottom) setNewMsgBanner(false)
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    const el = feedRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Auto-scroll on new messages if near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom()
    } else {
      setNewMsgBanner(true)
    }
  }, [threadQuery.data?.messages?.length, optimisticMessages.length, scrollToBottom])

  // ── WebSocket handler ────────────────────────────────────────────────
  useEffect(() => {
    if (!lastEvent?.event) return
    const ev = lastEvent as {
      event: string
      thread_agent_id?: string
      sender_type?: string
      persona_name?: string
      content_preview?: string
      content?: string
      message_id?: string
      created_at?: string
    }

    if (ev.event === 'direct_message_typing' && ev.thread_agent_id === activeAgentId) {
      setLiveAgentReply({
        id: `stream-${ev.message_id || Date.now()}`,
        content: '',
        sender_type: 'agent',
        sender_name: ev.persona_name || 'Agent',
        message_type: 'general',
        priority: 'normal',
        is_resolved: false,
        read_at: null,
        created_at: new Date().toISOString(),
        scheduled_reply_at: null,
        scheduled_reply_job_id: null,
        thread_id: null,
        parent_message_id: null,
        execution_id: null,
        from_agent_id: activeAgentId,
        to_agent_id: null,
      })
      return
    }

    if (ev.event === 'direct_message_chunk' && ev.thread_agent_id === activeAgentId) {
      setLiveAgentReply(prev => ({
        id: `stream-${ev.message_id || Date.now()}`,
        content: `${prev?.content || ''}${ev.content || ''}`,
        sender_type: 'agent',
        sender_name: ev.persona_name || prev?.sender_name || 'Agent',
        message_type: 'general',
        priority: 'normal',
        is_resolved: false,
        read_at: null,
        created_at: prev?.created_at || new Date().toISOString(),
        scheduled_reply_at: null,
        scheduled_reply_job_id: null,
        thread_id: null,
        parent_message_id: null,
        execution_id: null,
        from_agent_id: activeAgentId,
        to_agent_id: null,
      }))
      return
    }

    if (ev.event !== 'new_direct_message') return

    // Invalidate conversations list always
    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] })

    if (ev.thread_agent_id === activeAgentId) {
      setLiveAgentReply(null)
      if (ev.message_id && ev.content) {
        if (ev.sender_type === 'ceo') {
          dropMatchingOptimisticMessage(activeAgentId, ev.content)
        }

        appendThreadMessage(activeAgentId, {
          id: ev.message_id,
          content: ev.content,
          sender_type: ev.sender_type === 'ceo' ? 'ceo' : 'agent',
          sender_name: ev.sender_type === 'ceo'
            ? 'You'
            : ev.persona_name || threadQuery.data?.agent?.persona_name || threadQuery.data?.agent?.name || 'Agent',
          message_type: 'general',
          priority: 'normal',
          is_resolved: false,
          read_at: null,
          created_at: ev.created_at || new Date().toISOString(),
          scheduled_reply_at: null,
          scheduled_reply_job_id: null,
          thread_id: null,
          parent_message_id: null,
          execution_id: null,
          from_agent_id: ev.sender_type === 'ceo' ? null : activeAgentId,
          to_agent_id: ev.sender_type === 'ceo' ? activeAgentId : null,
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['dm-thread', activeAgentId] })
    } else if (ev.sender_type === 'agent') {
      // Different thread — show toast with action
      const agentName = ev.persona_name || 'Your agent'
      sonnerToast(`${agentName} sent you a message`, {
        action: {
          label: 'Open',
          onClick: () => {
            if (ev.thread_agent_id) {
              setActiveAgentId(ev.thread_agent_id)
              navigate(`/messages/${ev.thread_agent_id}`)
            }
          },
        },
      })
    }
  }, [lastEvent, activeAgentId, queryClient, navigate, appendThreadMessage, dropMatchingOptimisticMessage, threadQuery.data?.agent?.name, threadQuery.data?.agent?.persona_name])

  // ── Mutations ─────────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      messagesApi.send({
        to_agent_id: activeAgentId!,
        content,
        schedule_reply_in_minutes: scheduleMins ?? undefined,
      }),
    onMutate: (content) => {
      // Optimistic message
      const optimistic: DirectMessage = {
        id: `optimistic-${Date.now()}`,
        content,
        sender_type: 'ceo',
        sender_name: 'You',
        message_type: 'general',
        priority: 'normal',
        is_resolved: false,
        read_at: null,
        created_at: new Date().toISOString(),
        scheduled_reply_at: null,
        scheduled_reply_job_id: null,
        thread_id: null,
        parent_message_id: null,
        execution_id: null,
        from_agent_id: null,
        to_agent_id: activeAgentId,
      }
      setOptimisticMessages(prev => [...prev, optimistic])
      setCompose('')
      setScheduleMins(null)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dm-thread', activeAgentId] })
      void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] })
    },
    onError: () => {
      setOptimisticMessages([])
      toast.error('Failed to send message')
    },
  })

  const cancelScheduledMutation = useMutation({
    mutationFn: (messageId: string) => messagesApi.cancelScheduledReply(messageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dm-thread', activeAgentId] })
      toast.success('Scheduled reply cancelled')
    },
  })

  const retentionMutation = useMutation({
    mutationFn: (days: number | null) => messagesApi.setRetention(days),
    onSuccess: () => toast.success('Retention policy updated'),
  })

  // ── Derived state ─────────────────────────────────────────────────────

  const activeConv = conversations.find(c => c.agent_id === activeAgentId)
  const threadAgent = threadQuery.data?.agent
  const rawMessages = threadQuery.data?.messages ?? []
  const allMessages = [...rawMessages, ...optimisticMessages, ...(liveAgentReply ? [liveAgentReply] : [])]

  // Group messages by day
  type DayGroup = { key: string; label: string; messages: DirectMessage[] }
  const dayGroups: DayGroup[] = []
  for (const msg of allMessages) {
    if (!msg.created_at) continue
    const k = dayKey(msg.created_at)
    const last = dayGroups[dayGroups.length - 1]
    if (last && last.key === k) {
      last.messages.push(msg)
    } else {
      dayGroups.push({ key: k, label: dayLabel(msg.created_at), messages: [msg] })
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!compose.trim() || !activeAgentId) return
    sendMutation.mutate(compose.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelectAgent = (agentId: string) => {
    setActiveAgentId(agentId)
    setOptimisticMessages([])
    navigate(`/messages/${agentId}`)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-[#080d16]">

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0f1a]">

        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Messages</h2>
            {(convsQuery.data?.total_unread ?? 0) > 0 && (
              <span className="rounded-full bg-accent-cyan px-1.5 py-0.5 text-[10px] font-bold text-base-100 shadow-glow-cyan">
                {convsQuery.data!.total_unread}
              </span>
            )}
          </div>
        </div>

        {/* Conversation list */}
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {convsQuery.isError && (
            <div className="mx-3 mb-2 rounded-2xl border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/80">
              Conversation summaries failed to load. Showing your active agents so you can still message them.
            </div>
          )}
          {conversations.length === 0 && !convsQuery.isLoading && (
            <div className="px-4 py-8 text-center text-sm text-white/30">
              No agents yet. Hire your first teammate to start messaging.
            </div>
          )}
          {conversations.map(conv => (
            <button
              key={conv.agent_id}
              onClick={() => handleSelectAgent(conv.agent_id)}
              className={clsx(
                'flex w-full items-start gap-3 px-3 py-3 text-left transition-all',
                activeAgentId === conv.agent_id
                  ? 'bg-accent-purple/10 border-l-2 border-l-accent-purple'
                  : 'border-l-2 border-l-transparent hover:bg-white/[0.03]',
              )}
            >
              <AgentAvatar
                name={conv.persona_name || conv.agent_name}
                color={conv.role_color}
                size={40}
                isOnline={conv.is_online}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium text-white">
                    {conv.persona_name || conv.agent_name}
                  </span>
                  <span className="shrink-0 text-[10px] text-white/30">
                    {relativeTime(conv.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <p className="truncate text-xs text-white/40 leading-snug">
                    {conv.last_message
                      ? (conv.last_sender_type === 'ceo' ? 'You: ' : '') + conv.last_message
                      : <span className="italic">No messages yet</span>}
                  </p>
                  {conv.unread_count > 0 && (
                    <span className="ml-1 shrink-0 rounded-full bg-accent-red px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Team conversations toggle */}
        <div className="border-t border-white/[0.06] px-3 py-2">
          <button
            onClick={() => setShowTeamConvs(v => !v)}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs text-white/40 transition hover:bg-white/[0.03] hover:text-white/70"
          >
            <Zap size={12} />
            Team conversations
            <ChevronDown size={12} className={clsx('ml-auto transition', showTeamConvs && 'rotate-180')} />
          </button>
          {showTeamConvs && (
            <div className="mt-1 space-y-1">
              {teamConvsQuery.data?.conversations?.length === 0 && (
                <p className="px-2 py-2 text-xs text-white/25 italic">No team messages in last 24h</p>
              )}
              {teamConvsQuery.data?.conversations?.map((tc, i) => (
                <div key={i} className="rounded-xl bg-white/[0.02] px-3 py-2 text-xs text-white/50">
                  <span className="font-medium text-white/70">
                    {tc.from_agent.persona_name || tc.from_agent.name}
                  </span>
                  {' → '}
                  <span className="font-medium text-white/70">
                    {tc.to_agent.persona_name || tc.to_agent.name}
                  </span>
                  <p className="mt-0.5 truncate text-white/35">{tc.content_preview}</p>
                  <p className="mt-0.5 text-[10px] text-white/20">{relativeTime(tc.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
      {activeAgentId && (activeConv || threadAgent) ? (
        <div className="flex min-w-0 flex-1 flex-col">

          {/* Thread header */}
          <div className="flex items-center gap-4 border-b border-white/[0.06] bg-[#0a0f1a]/80 px-6 py-4 backdrop-blur-sm">
            <AgentAvatar
              name={threadAgent?.persona_name || activeConv?.persona_name || threadAgent?.name || activeConv?.agent_name}
              color={threadAgent?.role_color || activeConv?.role_color || '#A78BFA'}
              size={48}
              isOnline={activeConv?.is_online}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">
                  {threadAgent?.persona_name || activeConv?.persona_name || threadAgent?.name || activeConv?.agent_name}
                </h2>
                {activeConv?.is_online && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    Working
                  </span>
                )}
              </div>
              {(threadAgent?.current_task_summary || activeConv?.current_status) && (
                <p className="mt-0.5 truncate text-xs text-white/40">
                  {threadAgent?.current_task_summary
                    ? `Currently: ${threadAgent.current_task_summary}`
                    : activeConv?.current_status !== 'idle'
                    ? `Status: ${activeConv?.current_status}`
                    : null}
                </p>
              )}
            </div>

            {/* Three-dot menu */}
            <div className="relative">
              <button
                onClick={() => setShowRetention(v => !v)}
                className="rounded-xl p-2 text-white/30 transition hover:bg-white/[0.06] hover:text-white/70"
              >
                <MoreHorizontal size={16} />
              </button>
              {showRetention && (
                <div className="absolute right-0 top-10 z-30 w-52 rounded-2xl border border-white/10 bg-[#0f1520]/95 p-3 shadow-2xl backdrop-blur-xl">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
                    Message history
                  </p>
                  {[
                    { label: 'Keep forever', value: null },
                    { label: 'Keep 45 days', value: 45 },
                    { label: 'Keep 30 days', value: 30 },
                    { label: 'Keep 7 days', value: 7 },
                  ].map(opt => (
                    <button
                      key={String(opt.value)}
                      onClick={() => {
                        retentionMutation.mutate(opt.value)
                        setShowRetention(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Message feed */}
          <div
            ref={feedRef}
            onScroll={handleFeedScroll}
            className="relative min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4"
          >
            {threadQuery.isLoading && (
              <div className="flex h-full items-center justify-center text-sm text-white/30">
                Loading messages…
              </div>
            )}

            {!threadQuery.isLoading && allMessages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full text-2xl"
                  style={{ background: `${activeConv?.role_color ?? '#A78BFA'}22` }}
                >
                  {avatarInitial(activeConv?.persona_name || activeConv?.agent_name)}
                </div>
                <p className="text-sm font-medium text-white/60">
                  Say hi to {activeConv?.persona_name || activeConv?.agent_name}
                </p>
                <p className="text-xs text-white/30">They'll reply within a few seconds.</p>
              </div>
            )}

            {dayGroups.map(group => (
              <div key={group.key}>
                {/* Day separator */}
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="text-[10px] font-medium uppercase tracking-widest text-white/25">
                    {group.label}
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>

                {group.messages.map((msg, idx) => {
                  const isOptimistic = msg.id.startsWith('optimistic-')
                  const isCeo = msg.sender_type === 'ceo'
                  const agentForMsg = activeConv ?? null

                  // Check if previous message in day group was same sender (stack)
                  const prevMsg = group.messages[idx - 1]
                  const stacked = prevMsg && prevMsg.sender_type === msg.sender_type

                  if (isCeo) {
                    return (
                      <div key={msg.id} className={clsx('flex flex-col items-end', stacked ? 'mt-0.5' : 'mt-3')}>
                        <div
                          className={clsx(
                            'max-w-[68%] rounded-2xl rounded-tr-md px-4 py-3 text-sm leading-relaxed text-white',
                            isOptimistic
                              ? 'bg-accent-purple/50'
                              : 'bg-accent-purple/80',
                          )}
                        >
                          {msg.content}
                        </div>
                        {!stacked && (
                          <span className="mt-1 text-[10px] text-white/25">
                            You · {msg.created_at ? format(parseISO(msg.created_at), 'h:mm a') : ''}
                          </span>
                        )}
                      </div>
                    )
                  }

                  // Agent message (left aligned)
                  return (
                    <div key={msg.id} className={clsx('flex items-end gap-2.5', stacked ? 'mt-0.5' : 'mt-3')}>
                      {!stacked ? (
                        <AgentAvatar
                          name={agentForMsg?.persona_name || agentForMsg?.agent_name}
                          color={agentForMsg?.role_color ?? '#A78BFA'}
                          size={32}
                        />
                      ) : (
                        <div className="w-8 shrink-0" />
                      )}
                      <div className="min-w-0 max-w-[68%]">
                        <div className="rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.05] px-4 py-3 text-sm leading-relaxed text-white/90">
                          {msg.content || (
                            <span className="inline-flex items-center gap-2 text-white/55">
                              <span className="h-2 w-2 rounded-full bg-accent-cyan animate-pulse" />
                              {msg.sender_name} is typing…
                            </span>
                          )}
                        </div>
                        {!stacked && (
                          <span className="mt-1 block text-[10px] text-white/25">
                            {msg.sender_name} · {msg.created_at ? format(parseISO(msg.created_at), 'h:mm a') : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Scheduled reply indicators */}
            {rawMessages.filter(m => m.scheduled_reply_at && m.scheduled_reply_job_id).map(msg => (
              <ScheduledReplyBubble
                key={`scheduled-${msg.id}`}
                message={msg}
                onCancel={() => cancelScheduledMutation.mutate(msg.id)}
              />
            ))}
          </div>

          {/* New message banner */}
          {newMsgBanner && (
            <button
              onClick={() => { scrollToBottom(); setNewMsgBanner(false) }}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/10 bg-[#0f1520]/95 px-4 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-xl transition hover:bg-white/10"
            >
              New message ↓
            </button>
          )}

          {/* Input bar */}
          <div className="border-t border-white/[0.06] bg-[#0a0f1a]/80 px-4 py-4 backdrop-blur-sm">
            <div className="relative flex gap-3">
              <AgentAvatar
                name="You"
                color="#6C63FF"
                size={32}
                className="mt-1"
              />
              <div className="relative min-w-0 flex-1">
                <MentionTextarea
                  value={compose}
                  onChange={setCompose}
                  agents={conversations.map(c => ({
                    id: c.agent_id,
                    name: c.agent_name,
                    persona_name: c.persona_name,
                    role: c.role_slug ?? '',
                    role_slug: c.role_slug,
                  } as Agent))}
                  placeholder={`Message ${activeConv?.persona_name || activeConv?.agent_name || 'agent'}… (⌘↵ to send)`}
                  rows={2}
                  minHeightClassName="min-h-[52px]"
                  onKeyDown={handleKeyDown}
                  className="rounded-2xl border-white/[0.08] bg-white/[0.04] !py-3.5 text-sm placeholder:text-white/25 focus:border-accent-purple/30"
                />

                {/* Schedule reply button */}
                <div className="relative mt-2 flex items-center justify-between">
                  <div className="relative">
                    <button
                      onClick={() => setShowSchedule(v => !v)}
                      className={clsx(
                        'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs transition',
                        scheduleMins
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'text-white/30 hover:bg-white/[0.04] hover:text-white/60',
                      )}
                    >
                      <Clock size={11} />
                      {scheduleMins
                        ? `Follow-up in ${scheduleMins < 60 ? scheduleMins + 'm' : scheduleMins / 60 + 'h'}`
                        : 'Ask for follow-up…'}
                      {scheduleMins && (
                        <button
                          onClick={e => { e.stopPropagation(); setScheduleMins(null) }}
                          className="ml-1 rounded-full text-amber-400/60 hover:text-amber-200"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </button>
                    {showSchedule && (
                      <SchedulePopover
                        onSelect={setScheduleMins}
                        onClose={() => setShowSchedule(false)}
                      />
                    )}
                  </div>
                  <p className="text-[10px] text-white/20">Use @ to mention agents</p>
                </div>
              </div>

              <button
                onClick={handleSend}
                disabled={!compose.trim() || sendMutation.isPending}
                className={clsx(
                  'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition',
                  compose.trim()
                    ? 'bg-accent-purple text-white shadow-glow-purple hover:bg-accent-purple/80'
                    : 'bg-white/[0.04] text-white/20 cursor-not-allowed',
                )}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          {convsQuery.isLoading ? (
            <p className="text-sm text-white/30">Loading…</p>
          ) : (
            <>
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8">
                <p className="text-lg font-semibold text-white/60">
                  {conversations.length > 0 ? 'Pick a teammate to start a direct conversation.' : 'Your team is quiet right now.'}
                </p>
                <p className="mt-1 text-sm text-white/30">
                  {conversations.length > 0
                    ? 'Direct Messages is separate from Company Chat. Choose any agent on the left and you’ll get a real DM thread with a reply box.'
                    : 'Send a message or run a workflow to get things going.'}
                </p>
                <div className="mt-4 flex gap-3 justify-center">
                  {conversations[0] && (
                    <button
                      onClick={() => handleSelectAgent(conversations[0].agent_id)}
                      className="rounded-xl bg-accent-purple/20 px-4 py-2 text-sm font-medium text-accent-purple transition hover:bg-accent-purple/30"
                    >
                      Message {conversations[0].persona_name || conversations[0].agent_name}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

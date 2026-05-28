import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, isToday, isYesterday, parseISO } from 'date-fns'
import { clsx } from 'clsx'
import { ChevronDown, Clock, MoreHorizontal, Send, X } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { agentsApi, messagesApi } from '../api/client'
import { MentionTextarea } from '../components/ui/MentionTextarea'
import { useWebSocket } from '../contexts/WebSocketContext'
import { toast } from '../lib/toast'
import type { Agent, ConversationSummary, DirectMessage } from '../types'

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
  try {
    return iso.slice(0, 10)
  } catch {
    return ''
  }
}

function avatarInitial(name: string | null | undefined): string {
  const safeName = (name || '').trim()
  return safeName ? safeName.charAt(0).toUpperCase() : '?'
}

const FALLBACK_ROLE_COLORS = ['#A78BFA', '#60A5FA', '#34D399', '#F59E0B', '#F87171', '#38BDF8']

function fallbackRoleColor(seed: string) {
  const index = [...seed].reduce((acc, char) => acc + char.charCodeAt(0), 0) % FALLBACK_ROLE_COLORS.length
  return FALLBACK_ROLE_COLORS[index]
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
    { label: 'Tomorrow morning', minutes: 60 * 16 },
  ]
  return (
    <div className="absolute bottom-full mb-2 left-0 z-30 w-56 rounded-2xl border border-white/[0.08] bg-[#0f1520]/95 p-2 shadow-2xl backdrop-blur-xl">
      <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">
        Ask for follow-up in…
      </div>
      {options.map(opt => (
        <button
          key={opt.minutes}
          onClick={() => {
            onSelect(opt.minutes)
            onClose()
          }}
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

export function DirectMessages() {
  const { agentId: paramAgentId } = useParams<{ agentId?: string }>()
  const navigate = useNavigate()
  const { lastEvent } = useWebSocket()
  const queryClient = useQueryClient()

  const [activeAgentId, setActiveAgentId] = useState<string | null>(paramAgentId ?? null)
  const [compose, setCompose] = useState('')
  const [scheduleMins, setScheduleMins] = useState<number | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const [showRetention, setShowRetention] = useState(false)
  const [optimisticMessages, setOptimisticMessages] = useState<DirectMessage[]>([])
  const [liveAgentReply, setLiveAgentReply] = useState<DirectMessage | null>(null)
  const [newMsgBanner, setNewMsgBanner] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const replyFallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const replyFallbackAttemptsRef = useRef(0)

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

  const stopReplyFallback = useCallback(() => {
    if (replyFallbackTimerRef.current) {
      clearInterval(replyFallbackTimerRef.current)
      replyFallbackTimerRef.current = null
    }
    replyFallbackAttemptsRef.current = 0
  }, [])

  const startReplyFallback = useCallback((agentId: string) => {
    stopReplyFallback()
    replyFallbackTimerRef.current = setInterval(() => {
      replyFallbackAttemptsRef.current += 1
      void queryClient.invalidateQueries({ queryKey: ['dm-thread', agentId] })
      void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] })
      if (replyFallbackAttemptsRef.current >= 8) {
        stopReplyFallback()
      }
    }, 1500)
  }, [queryClient, stopReplyFallback])

  const convsQuery = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: messagesApi.conversations,
    refetchInterval: 30_000,
  })

  const allAgentsQuery = useQuery({
    queryKey: ['dm-all-agents'],
    queryFn: agentsApi.list,
    staleTime: 30_000,
  })

  const threadQuery = useQuery({
    queryKey: ['dm-thread', activeAgentId],
    queryFn: () => messagesApi.thread(activeAgentId!),
    enabled: Boolean(activeAgentId),
    staleTime: 0,
  })

  useEffect(() => {
    if (paramAgentId && paramAgentId !== activeAgentId) {
      setActiveAgentId(paramAgentId)
    }
  }, [paramAgentId, activeAgentId])

  const conversations = useMemo(() => {
    const existing = convsQuery.data?.conversations ?? []
    const agents = (allAgentsQuery.data ?? []).filter(agent => agent.is_active)
    const byAgentId = new Map(existing.map(conversation => [conversation.agent_id, conversation]))

    const merged: ConversationSummary[] = existing.map(conversation => ({ ...conversation }))

    for (const agent of agents) {
      if (byAgentId.has(agent.id)) continue
      merged.push({
        agent_id: agent.id,
        agent_name: agent.name,
        persona_name: agent.persona_name ?? null,
        role_slug: agent.role_slug ?? null,
        role_color: fallbackRoleColor(`${agent.role_slug ?? ''}:${agent.id}`),
        last_message: null,
        last_message_at: null,
        last_sender_type: null,
        unread_count: 0,
        is_online: agent.current_status === 'working',
        current_status: agent.current_status ?? 'idle',
      })
    }

    const withMessages = merged
      .filter(conversation => Boolean(conversation.last_message_at))
      .sort((left, right) => (right.last_message_at || '').localeCompare(left.last_message_at || ''))
    const withoutMessages = merged
      .filter(conversation => !conversation.last_message_at)
      .sort((left, right) => (left.persona_name || left.agent_name).localeCompare(right.persona_name || right.agent_name))

    return [...withMessages, ...withoutMessages]
  }, [convsQuery.data?.conversations, allAgentsQuery.data])

  useEffect(() => {
    if (!activeAgentId && conversations.length) {
      const first = conversations[0]
      setActiveAgentId(first.agent_id)
      navigate(`/messages/${first.agent_id}`, { replace: true })
    }
  }, [conversations, activeAgentId, navigate])

  useEffect(() => {
    if (threadQuery.data) setOptimisticMessages([])
  }, [threadQuery.data])

  useEffect(() => {
    setLiveAgentReply(null)
    stopReplyFallback()
  }, [activeAgentId, stopReplyFallback])

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

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom()
    } else {
      setNewMsgBanner(true)
    }
  }, [threadQuery.data?.messages?.length, optimisticMessages.length, liveAgentReply?.content, scrollToBottom])

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

    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] })

    if (ev.thread_agent_id === activeAgentId) {
      if (ev.sender_type === 'agent') {
        stopReplyFallback()
      }
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
  }, [lastEvent, activeAgentId, queryClient, navigate, appendThreadMessage, dropMatchingOptimisticMessage, threadQuery.data?.agent?.name, threadQuery.data?.agent?.persona_name, stopReplyFallback])

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      messagesApi.send({
        to_agent_id: activeAgentId!,
        content,
        schedule_reply_in_minutes: scheduleMins ?? undefined,
      }),
    onMutate: content => {
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
      if (activeAgentId) {
        startReplyFallback(activeAgentId)
      }
    },
    onError: () => {
      setOptimisticMessages([])
      stopReplyFallback()
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

  const activeConv = conversations.find(c => c.agent_id === activeAgentId)
  const threadAgent = threadQuery.data?.agent
  const rawMessages = threadQuery.data?.messages ?? []
  const allMessages = [...rawMessages, ...optimisticMessages, ...(liveAgentReply ? [liveAgentReply] : [])]

  useEffect(() => {
    if (!activeAgentId || optimisticMessages.length === 0) return
    const newestPersistedAgentReply = [...rawMessages]
      .reverse()
      .find(message => message.sender_type === 'agent')
    const newestOptimisticCeo = [...optimisticMessages]
      .reverse()
      .find(message => message.sender_type === 'ceo')
    if (!newestPersistedAgentReply || !newestOptimisticCeo) return
    if (new Date(newestPersistedAgentReply.created_at).getTime() >= new Date(newestOptimisticCeo.created_at).getTime()) {
      stopReplyFallback()
    }
  }, [rawMessages, optimisticMessages, activeAgentId, stopReplyFallback])

  useEffect(() => () => {
    stopReplyFallback()
  }, [stopReplyFallback])

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

  const handleSend = () => {
    if (!compose.trim() || !activeAgentId) return
    sendMutation.mutate(compose.trim())
  }

  const handleSelectAgent = (agentId: string) => {
    setActiveAgentId(agentId)
    setOptimisticMessages([])
    navigate(`/messages/${agentId}`)
  }

  return (
    <div className="flex h-full overflow-hidden bg-transparent">
      <aside
        className="flex w-[240px] shrink-0 flex-col"
        style={{
          background: 'rgba(5,9,20,0.88)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="px-3 pb-1 pt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'rgba(255,255,255,0.18)' }}>
          Agents
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {convsQuery.isError ? (
            <div className="mx-3 mb-2 rounded-2xl border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/80">
              Showing active agents while thread summaries reconnect.
            </div>
          ) : null}
          {conversations.length === 0 && !convsQuery.isLoading && !allAgentsQuery.isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-white/30">
              No agents yet. Hire your first teammate to start messaging.
            </div>
          ) : null}
          {conversations.map(conv => (
            <button
              key={conv.agent_id}
              onClick={() => handleSelectAgent(conv.agent_id)}
              className={clsx(
                'row relative min-h-[44px] w-full rounded-xl px-3 py-2.5 text-left transition-all',
                activeAgentId === conv.agent_id
                  ? 'bg-indigo-500/[0.08] border-l-2 border-indigo-500'
                  : 'hover:bg-white/[0.04]',
              )}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg, ${conv.role_color}cc, ${conv.role_color}88)`,
                  }}
                >
                  {avatarInitial(conv.persona_name || conv.agent_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {conv.persona_name || conv.agent_name}
                  </div>
                  <div className="truncate text-xs text-[#8B9DBE]">
                    {conv.role_slug || conv.current_status || 'Agent'}
                  </div>
                </div>
                {conv.unread_count > 0 ? <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-400" /> : null}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {activeAgentId && (activeConv || threadAgent) ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-4 border-b border-white/[0.06] bg-[rgba(8,13,26,0.82)] px-6 py-4 backdrop-blur-sm">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
              style={{
                background: `linear-gradient(135deg, ${(threadAgent as any)?.role_color || activeConv?.role_color || '#A78BFA'}cc, ${(threadAgent as any)?.role_color || activeConv?.role_color || '#A78BFA'}88)`,
              }}
            >
              {avatarInitial(threadAgent?.persona_name || activeConv?.persona_name || threadAgent?.name || activeConv?.agent_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">
                  {threadAgent?.persona_name || activeConv?.persona_name || threadAgent?.name || activeConv?.agent_name}
                </h2>
                <span className={clsx('status-dot', activeConv?.is_online ? 'dot-live dot-green' : 'dot-muted')} />
              </div>
              <p className="mt-0.5 truncate text-xs text-[#8B9DBE]">
                {(threadAgent as any)?.role || activeConv?.role_slug || activeConv?.current_status || 'Agent'}
              </p>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowRetention(v => !v)}
                className="rounded-xl p-2 text-white/30 transition hover:bg-white/[0.06] hover:text-white/70"
              >
                <MoreHorizontal size={16} />
              </button>
              {showRetention ? (
                <div className="absolute right-0 top-10 z-30 w-52 rounded-2xl border border-white/[0.08] bg-[#0f1520]/95 p-3 shadow-2xl backdrop-blur-xl">
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
              ) : null}
            </div>
          </div>

          <div
            ref={feedRef}
            onScroll={handleFeedScroll}
            className="relative min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4"
          >
            {threadQuery.isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-white/30">
                Loading messages…
              </div>
            ) : null}

            {!threadQuery.isLoading && allMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl text-white"
                  style={{ background: `linear-gradient(135deg, ${(activeConv?.role_color ?? '#A78BFA')}55, ${(activeConv?.role_color ?? '#A78BFA')}22)` }}
                >
                  {avatarInitial(activeConv?.persona_name || activeConv?.agent_name)}
                </div>
                <p className="text-sm font-medium text-white/60">
                  Say hi to {activeConv?.persona_name || activeConv?.agent_name}
                </p>
                <p className="text-xs text-white/30">They&apos;ll reply within a few seconds.</p>
              </div>
            ) : null}

            {dayGroups.map(group => (
              <div key={group.key}>
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
                  const prevMsg = group.messages[idx - 1]
                  const stacked = Boolean(prevMsg && prevMsg.sender_type === msg.sender_type)

                  if (isCeo) {
                    return (
                      <div key={msg.id} className={clsx('flex flex-col items-end', stacked ? 'mt-0.5' : 'mt-3')}>
                        <div
                          className={clsx('max-w-[72%] rounded-[18px] rounded-br-[4px] px-4 py-3 text-sm leading-relaxed text-white', isOptimistic && 'opacity-80')}
                          style={{
                            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                            boxShadow: '0 2px 8px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                          }}
                        >
                          {msg.content}
                        </div>
                        {!stacked ? (
                          <span className="mt-1 text-[10px] text-white/25">
                            You · {msg.created_at ? format(parseISO(msg.created_at), 'h:mm a') : ''}
                          </span>
                        ) : null}
                      </div>
                    )
                  }

                  return (
                    <div key={msg.id} className={clsx('flex items-end gap-2.5', stacked ? 'mt-0.5' : 'mt-3')}>
                      {!stacked ? (
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold text-white"
                          style={{
                            background: `linear-gradient(135deg, ${(agentForMsg?.role_color ?? '#A78BFA')}cc, ${(agentForMsg?.role_color ?? '#A78BFA')}88)`,
                          }}
                        >
                          {avatarInitial(agentForMsg?.persona_name || agentForMsg?.agent_name)}
                        </div>
                      ) : (
                        <div className="w-8 shrink-0" />
                      )}
                      <div className="min-w-0 max-w-[80%]">
                        <div className="card rounded-[18px] rounded-bl-[4px] px-4 py-3 text-sm leading-relaxed text-white/90">
                          {msg.content ? (
                            msg.content
                          ) : (
                            <div className="flex items-center gap-2 text-white/55">
                              <div className="flex gap-1">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300" />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300 [animation-delay:150ms]" />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300 [animation-delay:300ms]" />
                              </div>
                              <span className="text-xs text-[#8B9DBE]">{msg.sender_name} is thinking...</span>
                            </div>
                          )}
                        </div>
                        {!stacked ? (
                          <span className="mt-1 block text-[10px] text-white/25">
                            {msg.sender_name} · {msg.created_at ? format(parseISO(msg.created_at), 'h:mm a') : ''}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {rawMessages.filter(m => m.scheduled_reply_at && m.scheduled_reply_job_id).map(msg => (
              <ScheduledReplyBubble
                key={`scheduled-${msg.id}`}
                message={msg}
                onCancel={() => cancelScheduledMutation.mutate(msg.id)}
              />
            ))}
          </div>

          {newMsgBanner ? (
            <button
              onClick={() => {
                scrollToBottom()
                setNewMsgBanner(false)
              }}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-white/[0.08] bg-[#0f1520]/95 px-4 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-xl transition hover:bg-white/10"
            >
              New message ↓
            </button>
          ) : null}

          <div className="border-t border-white/[0.06] bg-[rgba(8,13,26,0.82)] px-4 py-4 backdrop-blur-sm">
            <div className="relative">
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
                placeholder={`Message ${activeConv?.persona_name || activeConv?.agent_name || 'agent'}…`}
                rows={3}
                minHeightClassName="min-h-[80px] max-h-[160px]"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                className="min-h-[80px] max-h-[160px] rounded-2xl border-white/[0.08] bg-white/[0.04] !py-3.5 text-sm placeholder:text-white/25 focus:border-indigo-500/30"
              />

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="relative flex items-center gap-3 text-[11px] text-white/30">
                  <span>Enter to send · Shift+Enter for newline</span>
                  <div className="relative">
                    <button
                      onClick={() => setShowSchedule(v => !v)}
                      className="btn-ghost px-2 py-1 text-xs"
                    >
                      Scheduled reply
                    </button>
                    {showSchedule ? (
                      <SchedulePopover
                        onSelect={setScheduleMins}
                        onClose={() => setShowSchedule(false)}
                      />
                    ) : null}
                  </div>
                  {scheduleMins ? (
                    <button
                      onClick={() => setScheduleMins(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] text-amber-300"
                    >
                      <Clock size={10} />
                      {scheduleMins < 60 ? `${scheduleMins}m` : `${scheduleMins / 60}h`}
                      <X size={10} />
                    </button>
                  ) : null}
                </div>

                <button
                  onClick={handleSend}
                  disabled={!compose.trim() || sendMutation.isPending}
                  aria-label="Send message"
                  title="Send"
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
                    compose.trim()
                      ? 'bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-btn-primary'
                      : 'cursor-not-allowed bg-white/[0.04] text-white/20',
                  )}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          {convsQuery.isLoading ? (
            <p className="text-sm text-white/30">Loading…</p>
          ) : (
            <div className="rounded-2xl border border-white/[0.06] border-dashed bg-white/[0.02] p-8">
              <p className="text-lg font-semibold text-white/60">
                {conversations.length > 0 ? 'Pick a teammate to start a direct conversation.' : 'Your team is quiet right now.'}
              </p>
              <p className="mt-1 text-sm text-white/30">
                {conversations.length > 0
                  ? 'Choose any agent on the left and you’ll get a real DM thread with a reply box.'
                  : 'Send a message or run a workflow to get things going.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

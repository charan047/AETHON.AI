import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Mail, Send, Sparkles } from 'lucide-react'
import { agentsApi, messagesApi, organizationsApi } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState'
import { MentionTextarea } from '../components/ui/MentionTextarea'
import { useAuth } from '../contexts/AuthContext'
import { useWebSocket } from '../contexts/WebSocketContext'
import { toast } from '../lib/toast'
import type { Agent, InboxMessage } from '../types'

function priorityTone(priority: InboxMessage['priority']) {
  switch (priority) {
    case 'urgent':
      return 'border-red-400/30 bg-red-500/10'
    case 'high':
      return 'border-amber-400/30 bg-amber-500/10'
    case 'low':
      return 'border-white/5 bg-white/[0.02]'
    default:
      return 'border-white/8 bg-white/[0.03]'
  }
}

function previewMessage(message: InboxMessage) {
  return message.message.length > 140 ? `${message.message.slice(0, 140)}…` : message.message
}

export function MessagesInbox() {
  const auth = useAuth()
  const { lastEvent } = useWebSocket()
  const queryClient = useQueryClient()
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [compose, setCompose] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [resolveOnReply, setResolveOnReply] = useState(true)

  const inboxQuery = useQuery({
    queryKey: ['ceo-inbox'],
    queryFn: () => messagesApi.ceoInbox(false),
    refetchInterval: 20_000,
  })
  const agentsQuery = useQuery({
    queryKey: ['agents', 'message-targets'],
    queryFn: agentsApi.list,
    staleTime: 30_000,
  })
  // Legacy thread query — MessagesInbox uses the ceo-inbox messages as the thread
  // (DirectMessages.tsx is the new full implementation)
  const threadQuery = useQuery({
    queryKey: ['message-thread', selectedThreadId],
    queryFn: async () => {
      const result = await messagesApi.ceoInbox(false)
      return result.messages.filter(m => m.thread_id === selectedThreadId)
    },
    enabled: Boolean(selectedThreadId),
  })

  useEffect(() => {
    if (!selectedThreadId && inboxQuery.data?.messages?.length) {
      setSelectedThreadId(inboxQuery.data.messages[0].thread_id || null)
    }
  }, [inboxQuery.data, selectedThreadId])

  useEffect(() => {
    if (lastEvent?.event === 'new_agent_message') {
      void queryClient.invalidateQueries({ queryKey: ['ceo-inbox'] })
      if (selectedThreadId) {
        void queryClient.invalidateQueries({ queryKey: ['message-thread', selectedThreadId] })
      }
    }
  }, [lastEvent, queryClient, selectedThreadId])

  const markReadMutation = useMutation({
    mutationFn: (id: string) => messagesApi.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ceo-inbox'] }),
  })

  const respondMutation = useMutation({
    mutationFn: () => messagesApi.ceoRespond({
      thread_id: selectedThreadId!,
      content: reply,
      resolve: resolveOnReply,
    }),
    onSuccess: async () => {
      setReply('')
      toast.success(resolveOnReply ? 'Reply sent and thread resolved' : 'Reply sent')
      await queryClient.invalidateQueries({ queryKey: ['ceo-inbox'] })
      await queryClient.invalidateQueries({ queryKey: ['message-thread', selectedThreadId] })
    },
    onError: () => toast.error('Could not send reply'),
  })

  const sendMutation = useMutation({
    mutationFn: (agentId: string) => messagesApi.ceoSend({
      to_agent_id: agentId,
      content: compose,
      message_type: 'general',
    }),
    onSuccess: async data => {
      setCompose('')
      setSelectedAgent(null)
      setSelectedThreadId(data.thread_id)
      toast.success('Message sent')
      await queryClient.invalidateQueries({ queryKey: ['ceo-inbox'] })
      await queryClient.invalidateQueries({ queryKey: ['message-thread', data.thread_id] })
    },
    onError: () => toast.error('Could not send message'),
  })

  const retentionMutation = useMutation({
    mutationFn: async (days: number | null) => {
      const org = auth.activeOrg
      if (!org) throw new Error('No active org')
      const updated = await organizationsApi.update(org.id, { agent_message_retention_days: days })
      await auth.refreshOrganizations(updated.id)
      return updated
    },
    onSuccess: () => {
      toast.success('Retention policy updated')
      void queryClient.invalidateQueries({ queryKey: ['ceo-inbox'] })
    },
    onError: () => toast.error('Could not update retention'),
  })

  const inbox = inboxQuery.data?.messages || []
  const unreadCount = inboxQuery.data?.unread_count || 0
  const thread = threadQuery.data || []
  const agents = agentsQuery.data || []

  const selectedInboxItem = inbox.find(item => item.thread_id === selectedThreadId) || null

  const sendNewMessage = () => {
    const target = selectedAgent || agents.find(agent => {
      const mentionRegex = /@([A-Za-z][A-Za-z\s\-']{0,40})/
      const match = compose.match(mentionRegex)
      if (!match) return false
      const mention = match[1].trim().toLowerCase()
      return [agent.name, agent.persona_name || ''].some(value => value.toLowerCase() === mention)
    })
    if (!target) {
      toast.info('Mention an agent with @ or pick one from suggestions')
      return
    }
    sendMutation.mutate(target.id)
  }

  if (inboxQuery.isLoading && agentsQuery.isLoading) {
    return <div className="p-6 text-sm text-white/50">Loading executive inbox…</div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Executive inbox</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">Agent Communication</h1>
          <p className="mt-2 text-sm text-white/45">
            Durable escalations, focused CEO replies, and structured agent coordination without turning every run into chat noise.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
            Unread {unreadCount}
          </div>
          <select
            className="rounded-xl border border-white/10 bg-[#0F1520] px-3 py-2 text-sm text-white"
            value={auth.activeOrg?.agent_message_retention_days ?? 0}
            onChange={event => {
              const value = Number(event.target.value)
              retentionMutation.mutate(value === 0 ? null : value)
            }}
          >
            <option value={7}>Keep 7 days</option>
            <option value={30}>Keep 30 days</option>
            <option value={45}>Keep 45 days</option>
            <option value={0}>Keep forever</option>
          </select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-3xl border border-white/8 bg-base-200/85 p-4 shadow-card">
          <div className="mb-4 flex items-center gap-2 px-2">
            <Mail size={16} className="text-accent-cyan" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">CEO Inbox</h2>
          </div>

          {inbox.length === 0 ? (
            <EmptyState
              icon="📭"
              title="Inbox is clear"
              description="Agents will only escalate blockers, review requests, and high-signal updates here."
            />
          ) : (
            <div className="space-y-3">
              {inbox.map(message => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => {
                    setSelectedThreadId(message.thread_id || null)
                    if (!message.read_at) {
                      markReadMutation.mutate(message.id)
                    }
                  }}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:border-accent-purple/30 ${priorityTone(message.priority)} ${selectedThreadId === message.thread_id ? 'ring-1 ring-accent-purple/40' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {message.from_agent_persona || message.from_agent_name}
                      </div>
                      <div className="text-xs text-white/35">{message.message_type.replace('_', ' ')}</div>
                    </div>
                    {!message.read_at && (
                      <span className="h-2.5 w-2.5 rounded-full bg-accent-green shadow-glow-green" />
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-white/65">{previewMessage(message)}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/8 bg-base-200/85 p-5 shadow-card">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Thread</h2>
                  <p className="text-sm text-white/40">
                    {selectedInboxItem ? `Priority ${selectedInboxItem.priority}` : 'Select a thread to respond'}
                  </p>
                </div>
                {selectedInboxItem?.is_resolved && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                    <CheckCircle2 size={14} />
                    Resolved
                  </div>
                )}
              </div>

              {selectedThreadId && thread.length > 0 ? (
                <div className="space-y-3">
                  {thread.map(message => (
                    <div
                      key={message.id}
                      className={`rounded-2xl border px-4 py-3 ${message.from_agent_id ? 'border-white/10 bg-white/[0.04]' : 'border-accent-purple/20 bg-accent-purple/10'}`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-white">
                          {message.from_agent_id ? (message.from_agent_persona || message.from_agent_name) : 'CEO'}
                        </div>
                        <div className="text-xs text-white/35">{new Date(message.created_at).toLocaleString()}</div>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">{message.message}</p>
                    </div>
                  ))}

                  <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-medium text-white">Reply</div>
                      <label className="flex items-center gap-2 text-xs text-white/45">
                        <input type="checkbox" checked={resolveOnReply} onChange={e => setResolveOnReply(e.target.checked)} />
                        Resolve thread after sending
                      </label>
                    </div>
                    <MentionTextarea
                      value={reply}
                      onChange={setReply}
                      agents={agents}
                      placeholder="Reply to this thread. Use @ to mention another agent if needed."
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => respondMutation.mutate()}
                        disabled={!reply.trim() || respondMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-accent-purple px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-purple/90 disabled:opacity-50"
                      >
                        <Send size={15} />
                        {respondMutation.isPending ? 'Sending…' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon="💬"
                  title="Pick a thread"
                  description="Escalations, blockers, and review requests appear here when an agent truly needs human input."
                />
              )}
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles size={16} className="text-accent-purple" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">New CEO Message</h3>
              </div>
              {selectedAgent && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-cyan/20 bg-accent-cyan/10 px-3 py-1 text-xs text-accent-cyan">
                  To {selectedAgent.persona_name || selectedAgent.name}
                </div>
              )}
              <MentionTextarea
                value={compose}
                onChange={setCompose}
                agents={agents}
                placeholder="Type @Maya or @Alex to start a conversation with an agent."
                onMentionSelected={setSelectedAgent}
              />
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-500/10 p-3 text-xs text-amber-100/85">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                Agents should only use this channel for blockers, risk warnings, handoffs, or high-signal updates. Routine work stays in their normal execution flow.
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={sendNewMessage}
                  disabled={!compose.trim() || sendMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent-cyan px-4 py-2 text-sm font-medium text-base-100 transition hover:bg-accent-cyan/90 disabled:opacity-50"
                >
                  <Send size={15} />
                  {sendMutation.isPending ? 'Sending…' : 'Start thread'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

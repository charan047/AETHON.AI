import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import { messagesApi } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState'
import { useWebSocket } from '../contexts/WebSocketContext'
import type { InboxMessage } from '../types'

function previewMessage(message: InboxMessage) {
  return message.message.length > 140 ? `${message.message.slice(0, 140)}…` : message.message
}

function relativeTime(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.floor(diff / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function avatarTone(name: string) {
  const palette = [
    'from-indigo-500/80 to-violet-500/70',
    'from-emerald-500/80 to-emerald-500/70',
    'from-amber-500/80 to-red-500/70',
    'from-sky-500/80 to-indigo-500/70',
  ]
  const index = [...name].reduce((acc, char) => acc + char.charCodeAt(0), 0) % palette.length
  return palette[index]
}

type FilterKey = 'all' | 'unread' | 'agents'

export function MessagesInbox() {
  const navigate = useNavigate()
  const { lastEvent } = useWebSocket()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterKey>('all')

  const inboxQuery = useQuery({
    queryKey: ['ceo-inbox'],
    queryFn: () => messagesApi.ceoInbox(false),
    refetchInterval: 20_000,
  })

  useEffect(() => {
    if (lastEvent?.event === 'new_agent_message') {
      void queryClient.invalidateQueries({ queryKey: ['ceo-inbox'] })
    }
  }, [lastEvent, queryClient])

  const inbox = inboxQuery.data?.messages || []
  const unreadCount = inboxQuery.data?.unread_count || 0

  const filtered = useMemo(() => {
    if (filter === 'unread') return inbox.filter(item => !item.read_at)
    if (filter === 'agents') return inbox.filter(item => Boolean(item.from_agent_id))
    return inbox
  }, [filter, inbox])

  const filterCounts = useMemo(() => ({
    all: inbox.length,
    unread: inbox.filter(item => !item.read_at).length,
    agents: inbox.filter(item => Boolean(item.from_agent_id)).length,
  }), [inbox])

  const tabs: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'agents', label: 'Agents' },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">Agent inbox and direct threads</p>
        </div>
        <span className={clsx('badge', unreadCount > 0 ? 'badge-red' : 'badge-glass')}>
          {unreadCount} unread
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)] pb-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={clsx(
              'inline-flex items-center gap-2 border-b-2 pb-2 font-mono text-[11px] uppercase tracking-[0.10em] transition-colors',
              filter === tab.key
                ? 'border-indigo-400 text-indigo-300 font-semibold'
                : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]',
            )}
          >
            {tab.label}
            {filterCounts[tab.key] > 0 ? (
              <span className={clsx('badge px-1.5 py-0.5 font-mono text-[10px]', tab.key === 'unread' ? 'badge-red' : 'badge-glass')}>
                {filterCounts[tab.key]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <section className="glass-card overflow-hidden p-0">
        {inboxQuery.isLoading ? (
          <div className="px-5 py-10 text-sm text-[var(--text-3)]">Loading messages…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon="📭"
              title="No messages"
              description="Agent escalations and direct messages will appear here."
            />
          </div>
        ) : (
          <div>
            {filtered.map(message => {
              const name = message.from_agent_persona || message.from_agent_name || 'Agent'
              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => {
                    if (message.from_agent_id) navigate(`/messages/${message.from_agent_id}`)
                  }}
                  className="data-row min-h-[44px] w-full text-left"
                >
                  <div className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-[10px] font-bold text-white', avatarTone(name))}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{name}</div>
                    <div className="truncate text-xs text-[#8B9DBE]">{previewMessage(message)}</div>
                  </div>
                  <div className="font-mono text-[11px] text-[#8B9DBE]">{relativeTime(message.created_at)}</div>
                  {!message.read_at ? <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-400" /> : null}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <div className="glass-card flex items-center gap-3 px-4 py-3 text-sm text-[#8B9DBE]">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-300">
          <MessageSquare size={16} />
        </div>
        <div>
          Click any row to open the live direct-message thread with that agent.
        </div>
      </div>
    </div>
  )
}

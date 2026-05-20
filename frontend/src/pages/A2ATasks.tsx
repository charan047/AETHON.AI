import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Wallet,
  XCircle,
} from 'lucide-react'

import { a2aApi } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState'
import { GlassCard } from '../components/ui/GlassCard'
import { SkeletonCard } from '../components/ui/Skeleton'
import type { A2ATaskRecord, A2ATaskStatus } from '../types'

function formatRelative(value?: string | null) {
  if (!value) return 'Just now'
  const deltaMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.floor(deltaMs / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDuration(seconds?: number | null) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function formatPayment(amount?: number | null, currency?: string | null) {
  if (amount == null) return '$0.00'
  const symbol = (currency || 'USD').toUpperCase() === 'USD' ? '$' : `${(currency || 'USD').toUpperCase()} `
  return `${symbol}${amount.toFixed(2)}`
}

function statusMeta(status: A2ATaskStatus) {
  if (status === 'completed') {
    return { label: 'done', className: 'badge-emerald', icon: <CheckCircle2 size={12} className="text-emerald-400" /> }
  }
  if (status === 'failed') {
    return { label: 'failed', className: 'badge-red', icon: <XCircle size={12} className="text-red-400" /> }
  }
  if (status === 'input-required') {
    return { label: 'input', className: 'badge-amber', icon: <ShieldAlert size={12} className="text-amber-400" /> }
  }
  return { label: status === 'submitted' ? 'queued' : 'running', className: 'badge-indigo', icon: <Loader2 size={12} className="animate-spin text-indigo-300" /> }
}

function SetupState() {
  return (
    <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.20em] text-[#4B5A73]">A2A Setup</div>
      <div className="space-y-3">
        {[
          'Set A2A_ENABLED=true in backend/.env',
          'Set A2A_BASE_URL to your public HTTPS URL',
          'Restart backend services so A2A discovery is exposed',
          'Provision an API key for approved external callers',
        ].map(step => (
          <div key={step} className="data-row rounded-2xl border border-white/[0.06] bg-white/[0.025]">
            <span className="status-dot dot-blue dot-live mt-0.5" />
            <span className="text-sm text-[#C9D7EE]">{step}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

function TaskRow({ task }: { task: A2ATaskRecord }) {
  const meta = statusMeta(task.status)
  const incoming = task.direction === 'incoming'

  return (
    <div className="data-row min-h-[44px]">
      <div
        className={clsx(
          'flex h-8 w-8 items-center justify-center rounded-xl',
          incoming
            ? 'bg-indigo-500/12 text-indigo-300'
            : 'bg-emerald-500/12 text-emerald-300',
        )}
      >
        {incoming ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">
          {task.agent_name || task.external_agent_name || 'Agent'}
        </div>
        <div className="truncate text-xs text-[#8B9DBE]">{task.input_text || task.output_text || 'No task preview'}</div>
      </div>

      <div className="hidden text-xs text-[#8B9DBE] md:block">
        {incoming ? task.caller_identity || 'external caller' : task.external_agent_name || 'external agent'}
      </div>

      <div className="font-mono text-xs text-[#8B9DBE]">{formatDuration(task.duration_seconds)}</div>

      <span className={clsx('badge', meta.className)}>
        {meta.icon}
        {meta.label}
      </span>
    </div>
  )
}

export function A2ATasks() {
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['a2a', 'tasks-page'],
    queryFn: a2aApi.listTasks,
    refetchInterval: 10_000,
  })

  const tasks = data?.tasks || []
  const incomingCount = tasks.filter(task => task.direction === 'incoming').length
  const outgoingCount = tasks.filter(task => task.direction === 'outgoing').length
  const filteredTasks = useMemo(
    () => tasks.filter(task => task.direction === direction),
    [direction, tasks],
  )

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="page-title">Agent Requests</h1>
        <p className="page-subtitle">Incoming and outgoing A2A tasks</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} className="h-16 rounded-2xl" />)}
        </div>
      )}

      {!isLoading && (isError || !data) && (
        <GlassCard padding="none" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title="Could not load A2A task history"
            description="The agent request dashboard is temporarily unavailable. Try again in a moment."
          />
        </GlassCard>
      )}

      {!isLoading && data?.enabled === false && <SetupState />}

      {!isLoading && data?.enabled && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'incoming', label: 'Incoming', count: incomingCount },
              { key: 'outgoing', label: 'Outgoing', count: outgoingCount },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setDirection(tab.key as 'incoming' | 'outgoing')}
                className={clsx(
                  'inline-flex items-center gap-2 border-b-2 px-1 py-2 text-sm transition',
                  direction === tab.key
                    ? 'border-indigo-400 text-indigo-300'
                    : 'border-transparent text-[#8B9DBE] hover:text-white',
                )}
              >
                <span>{tab.label}</span>
                <span className="badge-glass">{tab.count}</span>
              </button>
            ))}

            <div className="ml-auto hidden items-center gap-2 text-xs text-[#4B5A73] lg:flex">
              <Wallet size={13} />
              Payments tracked when available
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <GlassCard padding="none" className="rounded-[28px] border border-dashed border-white/[0.10] bg-white/[0.03]">
              <EmptyState
                icon={<Bot size={24} />}
                title="No A2A tasks yet"
                description="Enable A2A in settings."
              />
            </GlassCard>
          ) : (
            <GlassCard padding="none" className="overflow-hidden rounded-[28px] border-white/[0.08] bg-white/[0.03]">
              {filteredTasks.map(task => (
                <TaskRow key={task.id} task={task} />
              ))}
            </GlassCard>
          )}
        </>
      )}
    </div>
  )
}

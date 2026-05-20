import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Minus,
  Plus,
  Target,
  X,
  XCircle,
} from 'lucide-react'

import { agentsApi, clientsApi, extractApiError, missionsApi } from '../api/client'
import { PageShell } from '../components/Layout/PageShell'
import { AnimatedNumber } from '../components/ui/AnimatedNumber'
import { EmptyState } from '../components/ui/EmptyState'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { useWebSocket } from '../contexts/WebSocketContext'
import { toast } from '../lib/toast'
import type { Mission, MissionTaskStatus, WsEvent } from '../types'

function formatRelative(value?: string | null) {
  if (!value) return 'Just now'
  const date = new Date(value)
  const delta = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.floor(delta / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDuration(startedAt?: string | null, completedAt?: string | null) {
  if (!startedAt) return 'Just started'
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const minutes = Math.max(1, Math.round((end - start) / 60000))
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function taskTone(status: MissionTaskStatus) {
  if (status === 'completed') return 'dot-green'
  if (status === 'running') return 'dot-blue dot-live'
  if (status === 'failed') return 'dot-red'
  if (status === 'skipped') return 'dot-muted'
  return 'dot-muted'
}

function statusBadge(mission: Mission) {
  if (mission.status === 'completed') {
    return {
      label: 'COMPLETED',
      className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
      icon: <CheckCircle2 size={13} className="text-emerald-400" />,
    }
  }
  if (mission.status === 'failed') {
    return {
      label: 'FAILED',
      className: 'border-red-400/20 bg-red-400/10 text-red-200',
      icon: <XCircle size={13} className="text-red-400" />,
    }
  }
  return {
    label: 'ACTIVE',
    className: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    icon: <span className="status-dot dot-amber dot-live" />,
  }
}

function MissionCard({
  mission,
  agentMap,
  onRetry,
  retrying,
}: {
  mission: Mission
  agentMap: Map<string, string>
  onRetry: (missionId: string) => void
  retrying: boolean
}) {
  const badge = statusBadge(mission)
  const total = mission.stats.total || mission.tasks.length
  const completed = mission.stats.completed || 0
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const uniqueAgents = new Set(mission.tasks.map(task => task.agent_id).filter(Boolean)).size
  const failedTask = mission.tasks.find(task => task.status === 'failed')
  const startedLabel = mission.status === 'completed'
    ? `${formatDuration(mission.created_at, mission.completed_at)} · ${uniqueAgents} agents`
    : `Started ${formatRelative(mission.created_at)}`

  return (
    <div
      className={clsx(
        'overflow-hidden p-5 transition-all',
        mission.status === 'completed'
          ? 'glass-card'
          : mission.status === 'failed'
            ? 'glass-card glass-card-red'
            : 'glass-card glass-card-amber',
      )}
      style={{
        borderLeftWidth: mission.status === 'failed' ? '3px' : '2px',
        borderLeftColor:
          mission.status === 'completed'
            ? 'var(--green)'
            : mission.status === 'failed'
              ? 'var(--red)'
              : 'var(--amber)',
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx('badge', badge.className)}>
                {badge.icon}
                {badge.label}
              </span>
              {mission.client_name && (
                <span className="badge badge-glass">
                  {mission.client_name}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-lg font-bold tracking-tight text-[var(--t1)]">
              {mission.title || mission.goal}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {mission.status === 'completed' && (
              <Link
                to={`/missions/${mission.id}/report`}
                className="btn-secondary btn-sm"
              >
                View Report →
              </Link>
            )}
            {mission.status === 'failed' && (
              <button
                type="button"
                onClick={() => onRetry(mission.id)}
                disabled={retrying}
                className="btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {retrying ? <Loader2 size={13} className="animate-spin" /> : null}
                Retry →
              </button>
            )}
          </div>
        </div>

        {mission.status === 'active' || mission.status === 'planning' ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5">
              {mission.tasks.map(task => (
                <span key={task.id} className={clsx('h-2.5 w-2.5 rounded-full', taskTone(task.status))} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-s)] px-3 py-3">
              <div className="mono text-xs text-[var(--t2)]">
                <AnimatedNumber value={completed} /> of <AnimatedNumber value={total} /> tasks complete
              </div>
              <div className="flex items-center gap-1.5">
                {mission.tasks.slice(0, 10).map(task => (
                  <span key={task.id} className={clsx('h-2.5 w-2.5 rounded-full', taskTone(task.status))} />
                ))}
              </div>
            </div>

            <div className="mono flex items-center justify-between gap-3 text-xs text-[var(--t3)]">
              <span>{startedLabel}</span>
              <span>{progress}% complete</span>
            </div>
          </div>
        ) : null}

        {mission.status === 'completed' && (
          <div className="mono flex flex-wrap items-center gap-2 text-sm text-[var(--t2)]">
            <span>{formatDuration(mission.created_at, mission.completed_at)}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--border)]" />
            <span>{uniqueAgents} agents</span>
          </div>
        )}

        {mission.status === 'failed' && (
          <div className="space-y-2">
            <div className="rounded-lg border border-[oklch(62%_0.22_25_/_30%)] bg-[oklch(62%_0.22_25_/_10%)] px-4 py-3 text-sm text-[var(--red)]">
              {failedTask ? `1 task failed: "${failedTask.title}"` : 'Mission stopped before completion.'}
            </div>
            <div className="mono text-xs text-[var(--t3)]">{startedLabel}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function MissionCardSkeleton() {
  return <SkeletonCard className="h-[260px] rounded-[28px]" />
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#4B5A73]">
        {label}
      </div>
      {children}
    </label>
  )
}

function NewMissionComposer({
  open,
  onToggle,
  onCreate,
  creating,
  clientOptions,
}: {
  open: boolean
  onToggle: (open: boolean) => void
  onCreate: (payload: { goal: string; client_id?: string | null }) => void
  creating: boolean
  clientOptions: Array<{ id: string; label: string }>
}) {
  const [goal, setGoal] = useState('')
  const [clientId, setClientId] = useState('')

  useEffect(() => {
    if (!open) {
      setGoal('')
      setClientId('')
    }
  }, [open])

  return (
    open ? (
      <div className="glass-card p-5">
        <div className="space-y-5">
          <textarea
            className="textarea min-h-36 resize-y text-base"
            value={goal}
            onChange={event => setGoal(event.target.value)}
            placeholder="Describe the goal for your agency..."
          />

          {clientOptions.length ? (
            <Field label="Client">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setClientId('')}
                  className={clsx(
                    clientId === ''
                      ? 'rounded-full border border-blue-500/30 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-300'
                      : 'btn-secondary rounded-full px-4 py-2 text-sm',
                  )}
                >
                  No client
                </button>
                {clientOptions.map(client => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => setClientId(client.id)}
                    className={clsx(
                      clientId === client.id
                        ? 'rounded-full border border-blue-500/30 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-300'
                        : 'btn-secondary rounded-full px-4 py-2 text-sm',
                    )}
                  >
                    {client.label}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => onToggle(false)} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onCreate({ goal: goal.trim(), client_id: clientId || null })}
              disabled={creating || !goal.trim()}
              className="btn-primary btn-runner"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Create Mission
            </button>
          </div>
        </div>
      </div>
    ) : null
  )
}

export function Missions() {
  const queryClient = useQueryClient()
  const { lastEvent } = useWebSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showModal, setShowModal] = useState(false)

  const missionsQuery = useQuery({
    queryKey: ['missions'],
    queryFn: missionsApi.list,
    refetchInterval: query =>
      (query.state.data || []).some(mission => mission.status === 'active' || mission.status === 'planning')
        ? 5_000
        : 15_000,
  })
  const agentsQuery = useQuery({
    queryKey: ['agents', 'missions-page'],
    queryFn: agentsApi.list,
    staleTime: 60_000,
  })
  const clientsQuery = useQuery({
    queryKey: ['clients', 'missions-modal'],
    queryFn: clientsApi.list,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!lastEvent) return
    const event = lastEvent as WsEvent
    const eventType = event.event || event.type
    if (!['mission_task_started', 'mission_task_completed', 'mission_completed'].includes(eventType)) return
    void queryClient.invalidateQueries({ queryKey: ['missions'] })
    if (event.mission_id) {
      void queryClient.invalidateQueries({ queryKey: ['mission', String(event.mission_id)] })
    }
  }, [lastEvent, queryClient])

  useEffect(() => {
    if (searchParams.get('create') !== '1') return
    setShowModal(true)
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const createMutation = useMutation({
    mutationFn: (payload: { goal: string; client_id?: string | null }) => missionsApi.create(payload),
    onSuccess: mission => {
      queryClient.setQueryData<Mission[]>(['missions'], previous => [mission, ...(previous || [])])
      setShowModal(false)
      toast.success('Mission started — your agents are working')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const retryMutation = useMutation({
    mutationFn: (missionId: string) => missionsApi.retry(missionId),
    onSuccess: mission => {
      queryClient.setQueryData<Mission[]>(['missions'], previous => [mission, ...(previous || [])])
      void queryClient.invalidateQueries({ queryKey: ['missions'] })
      toast.success('Mission retried — your agents are working')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const agentMap = useMemo(
    () => new Map((agentsQuery.data || []).map(agent => [agent.id, agent.persona_name || agent.name])),
    [agentsQuery.data],
  )
  const clientOptions = useMemo(
    () => (clientsQuery.data?.clients || []).map(client => ({ id: client.id, label: client.company_name || client.name })),
    [clientsQuery.data],
  )

  const missions = missionsQuery.data || []

  if (missionsQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-5">
          {Array.from({ length: 3 }).map((_, index) => <MissionCardSkeleton key={index} />)}
        </div>
      </div>
    )
  }

  return (
    <PageShell
      title="Missions"
      subtitle="Goals your agency is executing."
      actions={
        <button type="button" className="btn-primary btn-runner" onClick={() => setShowModal(value => !value)}>
          <Plus size={15} />
          New Mission
        </button>
      }
      contentClassName="space-y-6 p-6"
    >
      <NewMissionComposer
        open={showModal}
        onToggle={setShowModal}
        onCreate={payload => createMutation.mutate(payload)}
        creating={createMutation.isPending}
        clientOptions={clientOptions}
      />

      {missionsQuery.isError ? (
        <div className="surface-card p-6">
          <div className="flex items-start gap-3 text-red-100">
            <AlertTriangle size={18} className="mt-0.5 text-red-300" />
            <div>
              <div className="font-medium">Could not load missions</div>
              <div className="mt-1 text-sm text-red-100/80">{extractApiError(missionsQuery.error)}</div>
            </div>
          </div>
        </div>
      ) : missions.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<Target size={22} />}
            title="No missions yet. Start your first mission."
            description="Give your agency a multi-step goal and it will break the work into coordinated tasks."
            action={{ label: 'Start Mission', onClick: () => setShowModal(true) }}
          />
        </div>
      ) : (
        <div className="space-y-5">
          {missions.map(mission => (
            <MissionCard
              key={mission.id}
              mission={mission}
              agentMap={agentMap}
              onRetry={missionId => retryMutation.mutate(missionId)}
              retrying={retryMutation.isPending && retryMutation.variables === mission.id}
            />
          ))}
        </div>
      )}
    </PageShell>
  )
}

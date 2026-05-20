import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Minus, Target, X as XIcon, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

import { agentsApi, missionsApi } from '../../api/client'
import { AnimatedNumber } from '../ui/AnimatedNumber'
import { useWebSocket } from '../../contexts/WebSocketContext'
import type { MissionTask, MissionTaskStatus, WsEvent } from '../../types'

interface GoalCardProps {
  missionId: string
  missionTitle: string
  initialTasks: MissionTask[]
}

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

function taskStatusLabel(status: MissionTaskStatus) {
  if (status === 'completed') return 'Done'
  if (status === 'running') return 'Running'
  if (status === 'failed') return 'Failed'
  if (status === 'skipped') return 'Skipped'
  return 'Waiting'
}

function taskDot(status: MissionTaskStatus) {
  if (status === 'completed') return 'dot-green'
  if (status === 'running') return 'dot-blue dot-live'
  if (status === 'failed') return 'dot-red'
  if (status === 'skipped') return 'dot-muted'
  return 'dot-muted'
}

function taskIcon(status: MissionTaskStatus) {
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-blue-300" />
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-300" />
  if (status === 'failed') return <XCircle size={14} className="text-red-300" />
  if (status === 'skipped') return <Minus size={14} className="text-white/35" />
  return <XIcon size={12} className="text-white/25 opacity-0" />
}

export function GoalCard({
  missionId,
  missionTitle,
  initialTasks,
}: GoalCardProps) {
  const queryClient = useQueryClient()
  const { lastEvent } = useWebSocket()

  const agentsQuery = useQuery({
    queryKey: ['agents', 'mission-goal-card'],
    queryFn: agentsApi.list,
    staleTime: 60_000,
  })
  const missionQuery = useQuery({
    queryKey: ['mission', missionId],
    queryFn: () => missionsApi.get(missionId),
    initialData: initialTasks.length
      ? {
          id: missionId,
          org_id: '',
          client_id: null,
          client_name: null,
          goal: missionTitle,
          title: missionTitle,
          status: 'active' as const,
          report: null,
          report_delivered: false,
          created_by: null,
          created_at: new Date().toISOString(),
          completed_at: null,
          stats: {
            total: initialTasks.length,
            pending: initialTasks.length,
            running: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
          },
          tasks: initialTasks,
        }
      : undefined,
    refetchInterval: query =>
      query.state.data?.status === 'active' || query.state.data?.status === 'planning'
        ? 5_000
        : false,
  })

  useEffect(() => {
    if (!lastEvent) return
    const event = lastEvent as WsEvent
    const eventType = event.event || event.type
    if (!['mission_task_started', 'mission_task_completed', 'mission_completed'].includes(eventType)) return
    if (String(event.mission_id || '') !== missionId) return
    void queryClient.invalidateQueries({ queryKey: ['mission', missionId] })
  }, [lastEvent, missionId, queryClient])

  const mission = missionQuery.data
  const agentMap = useMemo(
    () =>
      new Map((agentsQuery.data || []).map(agent => [agent.id, agent.persona_name || agent.name])),
    [agentsQuery.data],
  )

  const tasks = useMemo(
    () => [...(mission?.tasks || initialTasks)].sort((a, b) => a.sequence - b.sequence),
    [initialTasks, mission?.tasks],
  )

  const completed = tasks.filter(task => task.status === 'completed').length
  const total = tasks.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const isComplete = mission?.status === 'completed'
  const isRunning = mission?.status === 'active'

  return (
    <div
      className={`
        mt-3 overflow-hidden text-left
        ${isComplete ? 'glass-card glass-card-emerald' : isRunning ? 'glass-card glass-card-indigo' : 'glass-card glass-card-amber'}
      `}
      style={{
        borderLeftWidth: '2px',
        borderLeftColor: isComplete ? 'var(--green)' : isRunning ? 'var(--blue)' : 'var(--amber)',
      }}
    >
      <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mono flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--t3)]">
              {isComplete ? <CheckCircle2 size={13} className="text-[var(--green)]" /> : <Target size={13} className={isRunning ? 'text-[var(--blue)]' : 'text-[var(--amber)]'} />}
              {isComplete ? 'Mission Complete' : 'Mission Started'}
            </div>
            <div className="mt-2 text-sm font-semibold leading-6 text-[var(--t1)] sm:text-[15px]">
              {mission?.title || missionTitle}
            </div>
          </div>
          {isComplete ? (
            <Link
              to={`/missions/${missionId}/report`}
              className="btn-emerald btn-sm shrink-0"
            >
              View Report →
            </Link>
          ) : (
            <Link
              to="/missions"
              className="btn-secondary btn-sm shrink-0"
            >
              View full mission ↗
            </Link>
          )}
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="surface overflow-hidden">
          {tasks.map(task => (
            <div
              key={task.id}
              className="row grid grid-cols-[18px_minmax(0,1fr)_max-content] items-center gap-3"
            >
              <div className="flex items-center justify-center">
                {taskIcon(task.status)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-[var(--t1)]">{task.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--t3)]">
                  <span>{agentMap.get(task.agent_id || '') || 'Unassigned'}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--border)]" />
                  <span>{taskStatusLabel(task.status)}</span>
                </div>
              </div>
              <div className="mono pt-0.5 text-[11px] text-[var(--t3)]">
                {task.completed_at ? formatRelative(task.completed_at) : task.started_at ? 'Running' : 'Waiting'}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {tasks.map(task => (
              <span key={task.id} className={`status-dot h-2 w-2 ${taskDot(task.status)}`} />
            ))}
          </div>
          <div className="mono text-xs text-[var(--t2)]">
            <AnimatedNumber value={completed} /> / <AnimatedNumber value={total} /> complete
          </div>
        </div>

        {isComplete && (
          <div className="badge badge-green mt-4 inline-flex">
            <CheckCircle2 size={12} />
            Mission Complete
          </div>
        )}
      </div>
    </div>
  )
}

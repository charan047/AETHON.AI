import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Activity, Ban, Clock3, Eye, Pause, Radio, X } from 'lucide-react'
import { agentsApi, extractApiError } from '../../api/client'
import { useWebSocket } from '../../hooks/useWebSocket'
import { AgentAvatar } from '../ui/AgentAvatar'
import { Skeleton } from '../ui/Skeleton'
import type { LongTaskStatus, WsEvent } from '../../types'
import { toast } from '../../lib/toast'

type FormattedEvent = {
  id: string
  text: string
  agentName: string
  agentId?: string
  actionUrl?: string
  type: string
  timestamp: string
}

export function formatEvent(wsEvent: WsEvent): FormattedEvent {
  const name = String(wsEvent.agent_name || wsEvent.agent || wsEvent.name || wsEvent.workflow || 'Company OS')
  const output = String(wsEvent.output_preview || wsEvent.output || wsEvent.response || '').slice(0, 110)
  const task = String(wsEvent.task || wsEvent.input || wsEvent.workflow || 'a task')
  const map: Record<string, string> = {
    ws_connected: `Realtime client connected (${wsEvent.connection_count || 1} online)`,
    ws_disconnected: `Realtime client disconnected (${wsEvent.connection_count || 0} online)`,
    execution_start: `Workflow '${wsEvent.workflow || wsEvent.name || 'Untitled'}' started`,
    execution_complete: `Workflow finished successfully`,
    execution_error: `Workflow failed: ${wsEvent.error || 'unknown error'}`,
    agent_started: `${name} started working on ${task}`,
    agent_completed: `${name} completed: ${output || 'task finished'}`,
    agent_done: `${name} completed: ${output || 'workflow step finished'}`,
    workflow_completed: `Workflow '${wsEvent.workflow || wsEvent.name || 'Untitled'}' finished successfully`,
    workflow_plan: `Workflow plan generated`,
    workflow_paused: `Workflow paused for human approval`,
    workflow_resumed: `Workflow resumed after approval`,
    workflow_rejected: `Workflow rejected by human reviewer`,
    workflow_timed_out: `Workflow approval timed out`,
    workflow_scheduled_trigger: `Scheduled workflow triggered`,
    workflow_webhook_trigger: `${wsEvent.source || 'Webhook'} triggered a workflow`,
    workflow_rolled_back: `Workflow rolled back to v${wsEvent.target_version || 'previous'}`,
    hitl_requested: `${name} needs your review: ${wsEvent.title || 'Approval required'}`,
    hitl_approved: `Approval request approved`,
    hitl_rejected: `Approval request rejected`,
    hitl_timed_out: `Approval request timed out`,
    agent_retry: `${name} retrying (attempt ${wsEvent.attempt || 1}/${wsEvent.max_retries || '?'})`,
    agent_retry_succeeded: `${name} recovered after retry ${wsEvent.attempt || ''}`,
    agent_retry_exhausted: `${name} exhausted retries: ${wsEvent.error || 'unknown error'}`,
    agent_message: `${wsEvent.from || 'Agent'} messaged ${wsEvent.to || 'another agent'}: ${wsEvent.preview || ''}`,
    agent_message_response: `${wsEvent.from || 'Agent'} replied to ${wsEvent.to || 'another agent'}: ${wsEvent.preview || ''}`,
    long_task_started: `${name} started a long-running task: ${wsEvent.task_preview || 'background work'}`,
    long_task_progress: `${name} long task progress: ${wsEvent.progress || 0}%`,
    long_task_completed: `${name} completed long-running task`,
    long_task_paused: `${name} long-running task paused`,
    long_task_cancelled: `${name} long-running task cancelled`,
    long_task_failed: `${name} long-running task failed: ${wsEvent.error || 'unknown error'}`,
    parallel_group_started: `${wsEvent.agent_count || 'Multiple'} agents started parallel work`,
    parallel_group_completed: `${wsEvent.succeeded || wsEvent.agent_count || 'Multiple'} agents finished parallel task`,
    parallel_group_done: `${wsEvent.succeeded || 'Multiple'} agents finished parallel task`,
    condition_evaluated: `Condition routed workflow to ${wsEvent.target_node_id || 'next step'}`,
    tool_call: `${name} used ${wsEvent.tool || 'a tool'}`,
    tool_result: `${wsEvent.tool || 'Tool'} returned: ${output || 'result ready'}`,
    telegram_message: `Telegram message received from ${wsEvent.from || 'founder'}`,
    in_app_notification: `${wsEvent.title || 'Notification'}: ${wsEvent.message || ''}`,
    budget_warning: `Budget warning: $${wsEvent.monthly_spend || 0} of $${wsEvent.monthly_budget || 0} used`,
    budget_exceeded: `Budget exceeded: $${wsEvent.monthly_spend || 0} spent`,
  }
  return {
    id: `${wsEvent.type}-${wsEvent.timestamp || Date.now()}-${String(wsEvent.execution_id || wsEvent.approval_id || wsEvent.agent_id || '')}`,
    text: map[wsEvent.type] || wsEvent.type.replace(/_/g, ' '),
    agentName: name,
    agentId: typeof wsEvent.agent_id === 'string' ? wsEvent.agent_id : undefined,
    actionUrl: typeof wsEvent.action_url === 'string' ? wsEvent.action_url : undefined,
    type: wsEvent.type,
    timestamp: wsEvent.timestamp,
  }
}

function shouldSurfaceEvent(event: WsEvent) {
  return !['ws_connected', 'ws_disconnected'].includes(event.type)
}

function tone(type: string) {
  if (type.includes('error') || type.includes('rejected') || type.includes('exceeded')) return 'bg-red-400'
  if (type.includes('budget')) return 'bg-red-400'
  if (type.includes('hitl') || type.includes('approval')) return 'bg-amber-400'
  if (type.includes('workflow') || type.includes('execution')) return 'bg-emerald-400'
  if (type.includes('long_task')) return 'bg-emerald-400'
  if (type.includes('agent_message')) return 'bg-sky-400'
  if (type.includes('parallel')) return 'bg-fuchsia-400'
  return 'bg-indigo-400'
}

function secondsLabel(seconds?: number) {
  const value = Math.max(0, Number(seconds || 0))
  if (value < 60) return `${value}s`
  const minutes = Math.floor(value / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function longTaskFromEvent(event: WsEvent): LongTaskStatus | null {
  if (!event.type.startsWith('long_task_') || typeof event.task_id !== 'string') return null
  return {
    task_id: event.task_id,
    agent_id: typeof event.agent_id === 'string' ? event.agent_id : undefined,
    task_preview: typeof event.task_preview === 'string' ? event.task_preview : undefined,
    status: event.type.replace('long_task_', ''),
    progress: Number(event.progress || 0),
    current_step: String(event.current_step || 'Working'),
    intermediate_outputs: Array.isArray(event.intermediate_outputs) ? event.intermediate_outputs.map(String) : [],
    elapsed_seconds: Number(event.elapsed_seconds || 0),
    error: typeof event.error === 'string' ? event.error : undefined,
  }
}

const ActivityEventItem = memo(function ActivityEventItem({ event }: { event: FormattedEvent }) {
  return (
    <div className="activity-enter group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 transition hover:bg-white/[0.045]">
      <div className={`absolute inset-y-0 left-0 w-1 ${tone(event.type)}`} />
      <div className="flex items-center gap-3 pl-2">
        <AgentAvatar name={event.agentName} size="sm" running={event.type.includes('started') || event.type === 'tool_call'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-obsidian-100">{event.text}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-faint">
            {event.timestamp ? formatDistanceToNow(new Date(event.timestamp), { addSuffix: true }) : 'just now'}
          </p>
        </div>
        {event.actionUrl ? (
          <Link to={event.actionUrl} className="btn-secondary h-8 px-3 text-xs">Open</Link>
        ) : (
          <Activity size={15} className="text-obsidian-600 transition group-hover:text-indigo-300" />
        )}
      </div>
    </div>
  )
})

function LongTaskProgressCard({
  task,
  onView,
}: {
  task: LongTaskStatus
  onView: (task: LongTaskStatus) => void
}) {
  const pause = useMutation({
    mutationFn: () => agentsApi.pauseLongTask(task.task_id),
    onSuccess: () => toast.success('Pause requested'),
    onError: error => toast.error(extractApiError(error)),
  })
  const cancel = useMutation({
    mutationFn: () => agentsApi.cancelLongTask(task.task_id),
    onSuccess: () => toast.success('Task cancelled'),
    onError: error => toast.error(extractApiError(error)),
  })
  const active = ['started', 'progress', 'running', 'queued'].includes(task.status)

  return (
    <div className="activity-enter rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4 shadow-glow-sm">
      <div className="flex items-start gap-3">
        <AgentAvatar name={task.agent_id || 'Long task'} size="sm" running={active} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{task.task_preview || task.task || 'Long-running agent task'}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-obsidian-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300" style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-emerald-100/80">
            <span className="font-mono">{Math.round(task.progress)}%</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Clock3 size={12} /> {secondsLabel(task.elapsed_seconds)}</span>
            <span>·</span>
            <span className="truncate">{task.current_step}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary h-8 px-3 text-xs" disabled={!active || pause.isPending} onClick={() => pause.mutate()}>
              <Pause size={13} /> Pause
            </button>
            <button className="btn-ghost h-8 px-3 text-xs text-red-300 hover:text-red-200" disabled={!active || cancel.isPending} onClick={() => cancel.mutate()}>
              <Ban size={13} /> Cancel
            </button>
            <button className="btn-primary h-8 px-3 text-xs" onClick={() => onView(task)}>
              <Eye size={13} /> View Progress
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LongTaskSlideOver({ task, onClose }: { task: LongTaskStatus | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['long-task-status', task?.task_id],
    queryFn: () => agentsApi.getLongTaskStatus(task!.task_id),
    enabled: Boolean(task?.task_id),
    refetchInterval: task && ['started', 'progress', 'running', 'queued'].includes(task.status) ? 5000 : false,
  })
  const detail = data || task
  const cancel = useMutation({
    mutationFn: () => agentsApi.cancelLongTask(detail!.task_id),
    onSuccess: () => toast.success('Task cancelled'),
    onError: error => toast.error(extractApiError(error)),
  })

  if (!detail) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-white/[0.08] bg-obsidian-925 p-6 text-white shadow-glow-lg" onClick={event => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-300">Long-running task</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{detail.task_preview || detail.task || 'Agent background work'}</h2>
            <p className="mt-2 text-sm text-ink-muted">{detail.status} · {secondsLabel(detail.elapsed_seconds)} elapsed</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-obsidian-300">{detail.current_step}</span>
            <span className="font-mono text-emerald-300">{Math.round(detail.progress)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-obsidian-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300" style={{ width: `${Math.min(100, Math.max(0, detail.progress))}%` }} />
          </div>
          <p className="mt-3 text-xs text-ink-faint">Estimated completion updates as checkpoints arrive.</p>
        </div>

        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-white">Progress Timeline</h3>
          <div className="space-y-3">
            {detail.intermediate_outputs?.length ? detail.intermediate_outputs.map((output, index) => (
              <div key={`${detail.task_id}-${index}`} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                <div className="mb-2 font-mono text-xs text-emerald-300">Checkpoint {index + 1}</div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-obsidian-300">{output}</p>
              </div>
            )) : (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-ink-faint">
                No intermediate output yet. The agent is still sharpening its pencils.
              </div>
            )}
          </div>
        </div>

        <button className="btn-ghost mt-6 w-full justify-center text-red-300 hover:text-red-200" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          <Ban size={15} /> Cancel Task
        </button>
      </aside>
    </div>
  )
}

export function LiveActivityFeed() {
  const { events, lastEvent, connected } = useWebSocket()
  const [formatted, setFormatted] = useState<FormattedEvent[]>([])
  const [longTasks, setLongTasks] = useState<Record<string, LongTaskStatus>>({})
  const [selectedTask, setSelectedTask] = useState<LongTaskStatus | null>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const filteredInitialEvents = useMemo(
    () => events.filter(shouldSurfaceEvent).slice(-30).reverse().map(formatEvent),
    [events],
  )

  useEffect(() => {
    if (formatted.length || !filteredInitialEvents.length) return
    seenRef.current = new Set(filteredInitialEvents.map(event => event.id))
    setFormatted(filteredInitialEvents)
  }, [filteredInitialEvents, formatted.length])

  useEffect(() => {
    if (!lastEvent) return
    if (!shouldSurfaceEvent(lastEvent)) return
    const event = formatEvent(lastEvent)
    const longTask = longTaskFromEvent(lastEvent)
    if (longTask) {
      setLongTasks(current => ({
        ...current,
        [longTask.task_id]: {
          ...(current[longTask.task_id] || {}),
          ...longTask,
          intermediate_outputs: longTask.intermediate_outputs.length
            ? longTask.intermediate_outputs
            : current[longTask.task_id]?.intermediate_outputs || [],
        },
      }))
    }
    if (seenRef.current.has(event.id)) return
    seenRef.current.add(event.id)
    setFormatted(current => [event, ...current].slice(0, 30))
  }, [lastEvent])

  useEffect(() => {
    const tasks = events.map(longTaskFromEvent).filter(Boolean) as LongTaskStatus[]
    if (!tasks.length) return
    setLongTasks(current => {
      const next = { ...current }
      for (const task of tasks) {
        next[task.task_id] = {
          ...(next[task.task_id] || {}),
          ...task,
          intermediate_outputs: task.intermediate_outputs.length
            ? task.intermediate_outputs
            : next[task.task_id]?.intermediate_outputs || [],
        }
      }
      return next
    })
  }, [events])

  const visibleLongTasks = Object.values(longTasks).sort((a, b) => a.task_id.localeCompare(b.task_id)).slice(-4).reverse()

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-x border-white/[0.08] bg-base-bg">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Live Activity</h2>
          <p className="text-xs text-ink-faint">The heartbeat of your AI company.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs text-ink-muted">
          <span className={`h-2 w-2 rounded-full ${connected ? 'animate-pulse bg-emerald-400' : 'bg-obsidian-600'}`} />
          {connected ? 'Live' : 'Offline'}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!connected && !formatted.length ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        ) : !formatted.length ? (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <div className="breathing mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl border border-indigo-400/20 bg-indigo-400/10 text-indigo-200 shadow-glow-md">
                <Radio size={30} />
              </div>
              <p className="text-sm font-medium text-obsidian-300">Quiet right now - your team will show activity here</p>
              <p className="mt-2 text-xs text-obsidian-600">Run a workflow and watch the company come alive.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleLongTasks.map(task => (
              <LongTaskProgressCard key={task.task_id} task={task} onView={setSelectedTask} />
            ))}
            {formatted.map(event => <ActivityEventItem key={event.id} event={event} />)}
          </div>
        )}
      </div>
      <LongTaskSlideOver task={selectedTask} onClose={() => setSelectedTask(null)} />
    </section>
  )
}

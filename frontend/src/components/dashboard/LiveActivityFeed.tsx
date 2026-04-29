import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Activity, Radio } from 'lucide-react'
import { useWebSocket } from '../../hooks/useWebSocket'
import { AgentAvatar } from '../ui/AgentAvatar'
import { Skeleton } from '../ui/Skeleton'
import type { WsEvent } from '../../types'

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

function tone(type: string) {
  if (type.includes('error') || type.includes('rejected') || type.includes('exceeded')) return 'bg-red-400'
  if (type.includes('budget')) return 'bg-red-400'
  if (type.includes('hitl') || type.includes('approval')) return 'bg-amber-400'
  if (type.includes('workflow') || type.includes('execution')) return 'bg-cyan-400'
  if (type.includes('parallel')) return 'bg-fuchsia-400'
  return 'bg-accent-400'
}

const ActivityEventItem = memo(function ActivityEventItem({ event }: { event: FormattedEvent }) {
  return (
    <div className="activity-enter group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 transition hover:bg-white/[0.045]">
      <div className={`absolute inset-y-0 left-0 w-1 ${tone(event.type)}`} />
      <div className="flex items-center gap-3 pl-2">
        <AgentAvatar name={event.agentName} size="sm" running={event.type.includes('started') || event.type === 'tool_call'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-obsidian-100">{event.text}</p>
          <p className="mt-1 font-mono text-[11px] text-obsidian-500">
            {event.timestamp ? formatDistanceToNow(new Date(event.timestamp), { addSuffix: true }) : 'just now'}
          </p>
        </div>
        {event.actionUrl ? (
          <Link to={event.actionUrl} className="btn-secondary h-8 px-3 text-xs">Open</Link>
        ) : (
          <Activity size={15} className="text-obsidian-600 transition group-hover:text-accent-300" />
        )}
      </div>
    </div>
  )
})

export function LiveActivityFeed() {
  const { events, lastEvent, connected } = useWebSocket()
  const [formatted, setFormatted] = useState<FormattedEvent[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const initialEvents = useMemo(() => events.slice(-30).reverse().map(formatEvent), [events])

  useEffect(() => {
    if (formatted.length || !initialEvents.length) return
    seenRef.current = new Set(initialEvents.map(event => event.id))
    setFormatted(initialEvents)
  }, [formatted.length, initialEvents])

  useEffect(() => {
    if (!lastEvent) return
    const event = formatEvent(lastEvent)
    if (seenRef.current.has(event.id)) return
    seenRef.current.add(event.id)
    setFormatted(current => [event, ...current].slice(0, 30))
  }, [lastEvent])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-x border-white/[0.08] bg-obsidian-950">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Live Activity</h2>
          <p className="text-xs text-obsidian-500">The heartbeat of your AI company.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-obsidian-400">
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
              <div className="breathing mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl border border-accent-400/20 bg-accent-400/10 text-accent-200 shadow-glow-md">
                <Radio size={30} />
              </div>
              <p className="text-sm font-medium text-obsidian-300">Quiet right now - your team will show activity here</p>
              <p className="mt-2 text-xs text-obsidian-600">Run a workflow and watch the company come alive.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {formatted.map(event => <ActivityEventItem key={event.id} event={event} />)}
          </div>
        )}
      </div>
    </section>
  )
}

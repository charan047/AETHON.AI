import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, ShieldAlert, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { approvalsApi, extractApiError } from '../api/client'
import { useWebSocket } from '../hooks/useWebSocket'
import { toast } from '../lib/toast'
import type { AgentApprovalRequestItem, ApprovalRequest, WsEvent } from '../types'

function timeUntil(value?: string | null) {
  if (!value) return 'No expiry'
  const diff = new Date(value).getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`
}

function riskMeta(risk: AgentApprovalRequestItem['risk_level'] | string) {
  if (risk === 'critical') return { color: '#EF4444', badge: 'badge-red', glow: '0 0 20px rgba(239,68,68,0.14)' }
  if (risk === 'high') return { color: '#F59E0B', badge: 'badge-amber', glow: '0 0 20px rgba(245,158,11,0.12)' }
  if (risk === 'medium') return { color: '#2563EB', badge: 'badge-blue', glow: '0 0 20px rgba(37,99,235,0.12)' }
  return { color: '#10B981', badge: 'badge-emerald', glow: '0 0 20px rgba(16,185,129,0.10)' }
}

function ContextViewer({ data }: { data: ApprovalRequest['context_data'] }) {
  const [open, setOpen] = useState(false)
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? {}, null, 2)

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
      <button
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#8B9DBE] transition hover:bg-white/[0.04]"
        onClick={() => setOpen(value => !value)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Context data
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-white/[0.06] p-3 text-xs text-white/75">
          {text}
        </pre>
      )}
    </div>
  )
}

function HumanApprovalCard({
  approval,
  onDecision,
}: {
  approval: ApprovalRequest
  onDecision: (approval: ApprovalRequest, decision: 'approve' | 'reject', comment: string) => void
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [comment, setComment] = useState('')

  return (
    <div className="glass-card overflow-hidden rounded-2xl border-l-[3px] border-l-amber-500 p-5 shadow-[0_0_20px_rgba(245,158,11,0.10)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge-amber">Pending</span>
            <span className="text-xs text-[#8B9DBE]">{approval.workflow_name || 'Workflow'}</span>
            {approval.agent_name && <span className="text-xs text-[#4B5A73]">· {approval.agent_name}</span>}
          </div>
          <h3 className="mt-3 text-lg font-semibold text-white">{approval.title}</h3>
          {approval.description && <p className="mt-2 text-sm text-[#8B9DBE]">{approval.description}</p>}
        </div>
        <div className="text-right text-xs text-[#8B9DBE]">
          <div>{new Date(approval.requested_at).toLocaleString()}</div>
          <div className="mt-1 flex items-center justify-end gap-1 text-amber-300">
            <Clock3 size={12} /> {timeUntil(approval.expires_at)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ContextViewer data={approval.context_data} />
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-3">
        {!decision ? (
          <>
            <button className="btn-emerald" onClick={() => setDecision('approve')}>
              <CheckCircle2 size={16} /> Approve
            </button>
            <button className="btn-danger" onClick={() => setDecision('reject')}>
              <XCircle size={16} /> Reject
            </button>
          </>
        ) : (
          <div className="w-full space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
            <textarea
              className="input min-h-[80px]"
              placeholder={decision === 'approve' ? 'Optional approval comment...' : 'Why are you rejecting this?'}
              value={comment}
              onChange={event => setComment(event.target.value)}
            />
            <div className="flex gap-2">
              <button
                className={decision === 'approve' ? 'btn-emerald' : 'btn-danger'}
                onClick={() => onDecision(approval, decision, comment)}
              >
                Confirm {decision === 'approve' ? 'approval' : 'rejection'}
              </button>
              <button className="btn-secondary" onClick={() => setDecision(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AgentPermissionCard({
  approval,
  onDecision,
  highlight,
}: {
  approval: AgentApprovalRequestItem
  onDecision: (approval: AgentApprovalRequestItem, decision: 'approve' | 'reject', note: string) => void
  highlight?: boolean
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [note, setNote] = useState('')
  const agentDisplay = approval.agent.persona_name || approval.agent.name || 'Agent'
  const risk = riskMeta(approval.risk_level)

  return (
    <div
      className={clsx('glass-card overflow-hidden rounded-2xl p-5 transition-all duration-150', highlight && 'ring-2 ring-blue-500/25')}
      style={{ borderLeft: `3px solid ${risk.color}`, boxShadow: risk.glow }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={risk.badge}>
              {approval.risk_level.toUpperCase()}
            </span>
            <span className="text-xs text-[#8B9DBE]">{approval.approval_type}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-white">{approval.title}</h3>
          <p className="mt-1 text-sm text-white/85">
            {agentDisplay}
            {approval.agent.role ? ` · ${approval.agent.role}` : ''}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm text-[#8B9DBE]">{approval.description}</p>
        </div>
        <div className="text-right text-xs text-[#8B9DBE]">
          <div>{new Date(approval.created_at).toLocaleString()}</div>
          <div className="mt-1 flex items-center justify-end gap-1 text-amber-300">
            <Clock3 size={12} /> {timeUntil(approval.expires_at)}
          </div>
          <div className="mt-2 text-[#4B5A73]">
            Trust {approval.agent.trust_score?.toFixed(0) ?? '50'}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-3">
        {!decision ? (
          <>
            <button className="btn-emerald" onClick={() => setDecision('approve')}>
              <CheckCircle2 size={16} /> Approve
            </button>
            <button className="btn-danger" onClick={() => setDecision('reject')}>
              <XCircle size={16} /> Reject
            </button>
          </>
        ) : (
          <div className="w-full space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
            <textarea
              className="input min-h-[80px]"
              placeholder={decision === 'approve' ? 'Optional approval note...' : 'Why are you rejecting this?'}
              value={note}
              onChange={event => setNote(event.target.value)}
            />
            <div className="flex gap-2">
              <button
                className={decision === 'approve' ? 'btn-emerald' : 'btn-danger'}
                onClick={() => onDecision(approval, decision, note)}
              >
                Confirm {decision === 'approve' ? 'approval' : 'rejection'}
              </button>
              <button className="btn-secondary" onClick={() => setDecision(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Approvals() {
  const qc = useQueryClient()
  const { lastEvent } = useWebSocket()
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const [agentPending, setAgentPending] = useState<AgentApprovalRequestItem[]>([])
  const [freshAgentRequestIds, setFreshAgentRequestIds] = useState<string[]>([])

  const pendingQuery = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: approvalsApi.pending,
    refetchInterval: 10_000,
  })
  const historyQuery = useQuery({
    queryKey: ['approvals', 'history'],
    queryFn: () => approvalsApi.history(50, 0),
    refetchInterval: 30_000,
  })
  const agentPendingQuery = useQuery({
    queryKey: ['approvals', 'agent-requests'],
    queryFn: approvalsApi.agentRequests,
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (pendingQuery.data) setPending(pendingQuery.data)
  }, [pendingQuery.data])

  useEffect(() => {
    if (agentPendingQuery.data?.requests) setAgentPending(agentPendingQuery.data.requests)
  }, [agentPendingQuery.data])

  useEffect(() => {
    if (!lastEvent) return
    const event = lastEvent as WsEvent & {
      event?: string
      approval_id?: string
    }
    if (event.event !== 'new_approval_request' || !event.approval_id) return

    setFreshAgentRequestIds(ids => [event.approval_id!, ...ids.filter(id => id !== event.approval_id)].slice(0, 10))
    qc.invalidateQueries({ queryKey: ['approvals', 'agent-requests'] })
  }, [lastEvent, qc])

  useEffect(() => {
    if (!freshAgentRequestIds.length) return
    const timer = window.setTimeout(() => setFreshAgentRequestIds([]), 3000)
    return () => window.clearTimeout(timer)
  }, [freshAgentRequestIds])

  const decisionMut = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: 'approve' | 'reject'; comment: string }) =>
      decision === 'approve' ? approvalsApi.approve(id, comment) : approvalsApi.reject(id, comment),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
      toast.success(variables.decision === 'approve' ? 'Approved' : 'Rejected')
    },
    onError: error => {
      qc.invalidateQueries({ queryKey: ['approvals', 'pending'] })
      toast.error(extractApiError(error))
    },
  })

  const agentDecisionMut = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note: string }) =>
      decision === 'approve'
        ? approvalsApi.approveAgentRequest(id, note)
        : approvalsApi.rejectAgentRequest(id, note),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['approvals', 'agent-requests'] })
      toast.success(variables.decision === 'approve' ? 'Approved' : 'Rejected')
    },
    onError: error => {
      qc.invalidateQueries({ queryKey: ['approvals', 'agent-requests'] })
      toast.error(extractApiError(error))
    },
  })

  const submitDecision = (approval: ApprovalRequest, decision: 'approve' | 'reject', comment: string) => {
    setPending(items => items.filter(item => item.id !== approval.id))
    decisionMut.mutate({ id: approval.id, decision, comment })
  }

  const submitAgentDecision = (
    approval: AgentApprovalRequestItem,
    decision: 'approve' | 'reject',
    note: string,
  ) => {
    setAgentPending(items => items.filter(item => item.id !== approval.id))
    agentDecisionMut.mutate({ id: approval.id, decision, note })
  }

  const history = historyQuery.data ?? []
  const totalPending = pending.length + agentPending.length
  const agentPendingCount = useMemo(
    () => agentPendingQuery.data?.pending_count ?? agentPending.length,
    [agentPending, agentPendingQuery.data],
  )

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8B9DBE]">
            Review queue
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">Approvals</h1>
          <p className="mt-2 text-sm text-[#8B9DBE]">
            Review paused workflow steps and risky agent permission requests.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
              totalPending
                ? 'border-red-500/20 bg-red-500/10 text-red-300'
                : 'border-white/[0.08] bg-white/[0.03] text-[#8B9DBE]',
            )}
          >
            <ShieldAlert size={14} /> {totalPending} pending
          </span>
          <span className="text-xs text-[#4B5A73]">Auto-refreshes every 10s</span>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">Pending workflow approvals</h2>
          <span className="badge-glass">{pending.length}</span>
        </div>
        {pendingQuery.isLoading ? (
          <div className="glass-card h-32 animate-pulse rounded-2xl" />
        ) : pending.length ? (
          pending.map(approval => (
            <HumanApprovalCard key={approval.id} approval={approval} onDecision={submitDecision} />
          ))
        ) : (
          <div className="glass-card rounded-2xl p-10 text-center text-[#8B9DBE]">
            <ShieldAlert size={32} className="mx-auto mb-3 text-[#2D3748]" />
            No pending workflow approvals right now.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">Agent permission requests</h2>
          <span className="badge-glass">{agentPendingCount}</span>
        </div>
        {agentPendingQuery.isLoading ? (
          <div className="glass-card h-32 animate-pulse rounded-2xl" />
        ) : agentPending.length ? (
          agentPending.map(approval => (
            <AgentPermissionCard
              key={approval.id}
              approval={approval}
              onDecision={submitAgentDecision}
              highlight={freshAgentRequestIds.includes(approval.id)}
            />
          ))
        ) : (
          <div className="glass-card rounded-2xl p-10 text-center text-[#8B9DBE]">
            <ShieldAlert size={32} className="mx-auto mb-3 text-[#2D3748]" />
            No agent permission requests right now.
          </div>
        )}
      </section>

      <section className="glass-card overflow-hidden rounded-2xl">
        <div className="border-b border-white/[0.08] px-5 py-4 text-sm font-semibold text-white">Decision history</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[rgba(8,13,26,0.9)] text-xs uppercase tracking-wide text-[#4B5A73] backdrop-blur">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Reviewer</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Comment</th>
              </tr>
            </thead>
            <tbody>
              {history.map(item => (
                <tr key={item.id} className="border-t border-white/[0.04] text-[#8B9DBE] transition hover:bg-white/[0.025]">
                  <td className="px-4 py-3 text-white">{item.title}</td>
                  <td className="px-4 py-3">
                    <span className={item.status === 'approved' ? 'badge-emerald' : item.status === 'rejected' ? 'badge-red' : 'badge-glass'}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{item.reviewer || item.reviewed_by_user_id || 'You'}</td>
                  <td className="px-4 py-3">{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : '-'}</td>
                  <td className="max-w-md truncate px-4 py-3">{item.reviewer_comment || '-'}</td>
                </tr>
              ))}
              {!history.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#4B5A73]">
                    No decisions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, ShieldAlert, XCircle } from 'lucide-react'
import { clsx } from 'clsx'

import { approvalsApi, extractApiError } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import { PageShell } from '../components/Layout/PageShell'
import { AnimatedContent } from '../components/reactbits/AnimatedContent'
import { EmptyState } from '../components/ui/EmptyState'
import { Button as MovingBorderButton } from '../components/ui/aceternity/MovingBorder'
import { AnimatedList, AnimatedListItem } from '../components/ui/magicui/AnimatedList'
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
  if (risk === 'critical') return { color: '#ef4444', badge: 'badge-red', cardClass: 'card card-red animate-pulse-ring', label: 'CRITICAL' }
  if (risk === 'high') return { color: '#f59e0b', badge: 'badge-amber', cardClass: 'card card-amber', label: 'HIGH' }
  if (risk === 'medium') return { color: 'rgba(99,102,241,0.50)', badge: 'badge-indigo', cardClass: 'card card-indigo', label: 'MEDIUM' }
  return { color: 'rgba(255,255,255,0.18)', badge: 'badge-glass', cardClass: 'card', label: 'LOW' }
}

function recommendationMeta(kind: 'approve' | 'review' | 'reject') {
  if (kind === 'approve') return { label: 'AI: Approve ✓', className: 'badge badge-emerald' }
  if (kind === 'reject') return { label: 'AI: Reject', className: 'badge badge-red' }
  return { label: 'AI: Review', className: 'badge badge-amber' }
}

function roleTone(role?: string | null) {
  const value = (role || '').toLowerCase()
  if (value.includes('sales') || value.includes('outreach')) return 'from-amber-500/80 to-red-500/70'
  if (value.includes('research') || value.includes('analysis')) return 'from-indigo-500/80 to-violet-500/70'
  if (value.includes('ops') || value.includes('automation')) return 'from-emerald-500/80 to-emerald-500/70'
  return 'from-indigo-500/80 to-violet-500/70'
}

function initials(name?: string | null) {
  return (name || 'A').trim().charAt(0).toUpperCase() || 'A'
}

function RecommendationBanner({ kind }: { kind: 'approve' | 'review' | 'reject' }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 3000)
    return () => window.clearTimeout(timer)
  }, [])

  const meta = recommendationMeta(kind)

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2"
        >
          <span className={meta.className}>{meta.label}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function ContextViewer({ data }: { data: ApprovalRequest['context_data'] }) {
  const [open, setOpen] = useState(false)
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? {}, null, 2)

  return (
    <div className="surface overflow-hidden">
      <button
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[var(--text-2)] transition hover:bg-white/[0.04]"
        onClick={() => setOpen(value => !value)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Context data
      </button>
      {open ? (
        <pre className="max-h-64 overflow-auto border-t border-[var(--border)] p-3 text-xs text-[var(--text-2)]">
          {text}
        </pre>
      ) : null}
    </div>
  )
}

function ApprovalCardShell({
  avatarName,
  role,
  title,
  analysis,
  timeText,
  badge,
  leftBorder,
  className,
  children,
}: {
  avatarName: string
  role?: string | null
  title: string
  analysis: string
  timeText: string
  badge: ReactNode
  leftBorder: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.32, ease: [0.34, 1.56, 0.64, 1] }}
      className={clsx(className, 'relative overflow-hidden p-4 sm:p-5')}
      style={{ borderLeftWidth: leftBorder.startsWith('#ef') || leftBorder.startsWith('#f59') ? '3px' : '2px', borderLeftColor: leftBorder }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white', roleTone(role))}>
              {initials(avatarName)}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white break-words">{avatarName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {badge}
                {role ? <span className="text-xs text-[var(--text-3)] break-words">{role}</span> : null}
              </div>
            </div>
          </div>
          <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
        </div>
        <div className="font-mono text-left text-xs text-[var(--text-3)] sm:text-right">
          <div>{timeText}</div>
        </div>
      </div>

      <div className="mt-4">{children}</div>

      <p className="mt-3 line-clamp-2 text-sm text-[var(--text-2)]">{analysis}</p>
    </motion.div>
  )
}

function WorkflowReviewCard({
  approval,
  onDecision,
}: {
  approval: ApprovalRequest
  onDecision: (approval: ApprovalRequest, decision: 'approve' | 'reject', comment: string) => void
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [comment, setComment] = useState('')
  const agentDisplay = approval.agent_name || 'Agent'

  return (
    <ApprovalCardShell
      avatarName={agentDisplay}
      role={approval.workflow_name || 'Workflow'}
      title={approval.title}
      analysis={approval.description || 'Final output is ready for CEO review before it goes to the client.'}
      timeText={timeUntil(approval.expires_at)}
      badge={<span className="badge badge-amber">REVIEW</span>}
      leftBorder="#f59e0b"
      className="card card-amber"
    >
      <RecommendationBanner kind="approve" />
      <div className="mt-4">
        <ContextViewer data={approval.context_data} />
      </div>
      <div className="mt-4">
        {!decision ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="btn-danger h-12 w-full justify-center sm:h-10" onClick={() => setDecision('reject')}>
              <XCircle size={16} /> Reject
            </button>
            <MovingBorderButton
              className="h-12 w-full justify-center bg-emerald-600/85 px-4 text-white sm:h-10"
              containerClassName="w-full"
              borderClassName="bg-[radial-gradient(#34d399_40%,transparent_60%)]"
              borderRadius="12px"
              duration={3200}
              onClick={() => setDecision('approve')}
            >
              <CheckCircle2 size={16} /> Approve
            </MovingBorderButton>
          </div>
        ) : (
          <div className="space-y-3">
            {decision === 'reject' ? (
              <FloatingField label="Reason for rejection" type="text" value={comment} onChange={setComment} />
            ) : (
              <input
                className="input h-[52px] w-full"
                placeholder="Optional approval comment..."
                value={comment}
                onChange={event => setComment(event.target.value)}
              />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className={decision === 'approve' ? 'btn-emerald h-12 w-full justify-center sm:h-10' : 'btn-danger h-12 w-full justify-center sm:h-10'}
                onClick={() => onDecision(approval, decision, comment)}
              >
                {decision === 'approve' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                Confirm {decision === 'approve' ? 'approval' : 'rejection'}
              </button>
              <button className="btn-secondary h-12 w-full justify-center sm:h-10" onClick={() => setDecision(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </ApprovalCardShell>
  )
}

function AgentRequestCard({
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
  const recommendation =
    approval.risk_level === 'critical' ? 'review' : approval.risk_level === 'high' ? 'reject' : 'approve'
  const rejectNeedsReason = decision === 'reject' && !note.trim()

  const handleConfirm = () => {
    if (rejectNeedsReason) return
    onDecision(approval, decision!, note.trim())
  }

  return (
    <ApprovalCardShell
      avatarName={agentDisplay}
      role={approval.agent.role || approval.approval_type}
      title={approval.title}
      analysis={approval.description}
      timeText={timeUntil(approval.expires_at)}
      badge={
        <span className={clsx('badge', risk.badge, approval.risk_level === 'critical' && 'animate-pulse-ring')}>
          {risk.label}
        </span>
      }
      leftBorder={risk.color}
      className={clsx(risk.cardClass, highlight && 'shadow-red')}
    >
      <RecommendationBanner kind={recommendation} />
      <div className="mt-4">
        {!decision ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="btn-danger h-12 w-full justify-center sm:h-10"
              onClick={() => setDecision('reject')}
            >
              <XCircle size={16} /> Reject
            </button>
            <MovingBorderButton
              className="h-12 w-full justify-center bg-emerald-600/85 px-4 text-white sm:h-10"
              containerClassName="w-full"
              borderClassName="bg-[radial-gradient(#34d399_40%,transparent_60%)]"
              borderRadius="12px"
              duration={3200}
              onClick={() => setDecision('approve')}
            >
              <CheckCircle2 size={16} /> Approve
            </MovingBorderButton>
          </div>
        ) : (
          <div className="space-y-3">
            {decision === 'reject' ? (
              <div className="space-y-2">
                <FloatingField
                  label="Reason for rejection"
                  type="text"
                  value={note}
                  onChange={setNote}
                />
                {rejectNeedsReason ? <p className="text-xs text-red-400">Reason for rejection is required.</p> : null}
              </div>
            ) : (
              <input
                className="input h-[52px] w-full"
                placeholder="Optional approval note..."
                value={note}
                onChange={event => setNote(event.target.value)}
              />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className={decision === 'approve' ? 'btn-emerald h-12 w-full justify-center sm:h-10' : 'btn-danger h-12 w-full justify-center sm:h-10'}
                disabled={rejectNeedsReason}
                onClick={handleConfirm}
              >
                {decision === 'approve' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                Confirm {decision === 'approve' ? 'approval' : 'rejection'}
              </button>
              <button className="btn-secondary h-12 w-full justify-center sm:h-10" onClick={() => setDecision(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </ApprovalCardShell>
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
    const event = lastEvent as WsEvent & { event?: string; approval_id?: string }
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
    <PageShell
      title="Approvals"
      subtitle="Review paused workflow steps and risky agent permission requests."
      actions={
        <span className={clsx('badge', totalPending ? 'badge-red animate-pulse' : 'badge-muted')}>
          <ShieldAlert size={12} /> {totalPending} pending
        </span>
      }
      contentClassName="space-y-8 p-6"
    >
      {totalPending === 0 && !pendingQuery.isLoading && !agentPendingQuery.isLoading ? (
        <div className="card flex min-h-[48vh] items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="flex items-center gap-3 text-center"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <div className="text-base font-semibold text-white">All clear</div>
              <div className="text-sm text-[var(--text-3)]">When an agent needs your sign-off before doing something sensitive, it shows up here.</div>
            </div>
          </motion.div>
        </div>
      ) : (
        <>
          <AnimatedContent distance={40} direction="vertical" duration={0.5}>
          <section className="space-y-3">
            <div className="section-title flex items-center justify-between">
              <span>AGENT REQUESTS</span>
              <span className="badge badge-muted">{agentPendingCount}</span>
            </div>
            {agentPendingQuery.isLoading ? (
              <div className="card sk h-32" />
            ) : agentPending.length ? (
              <AnimatedList className="space-y-3">
                {agentPending.map(approval => (
                  <AnimatedListItem key={approval.id}>
                    <AgentRequestCard
                      approval={approval}
                      onDecision={submitAgentDecision}
                      highlight={freshAgentRequestIds.includes(approval.id)}
                    />
                  </AnimatedListItem>
                ))}
              </AnimatedList>
            ) : (
              <div className="card px-5 py-6 text-sm text-[var(--text-2)]">
                No agent permission requests right now.
              </div>
            )}
          </section>
          </AnimatedContent>

          <AnimatedContent distance={40} direction="vertical" duration={0.5}>
          <section className="space-y-3">
            <div className="section-title flex items-center justify-between">
              <span>WORKFLOW REVIEWS</span>
              <span className="badge badge-muted">{pending.length}</span>
            </div>
            {pendingQuery.isLoading ? (
              <div className="card sk h-32" />
            ) : pending.length ? (
              <AnimatedList className="space-y-3">
                {pending.map(approval => (
                  <AnimatedListItem key={approval.id}>
                    <WorkflowReviewCard approval={approval} onDecision={submitDecision} />
                  </AnimatedListItem>
                ))}
              </AnimatedList>
            ) : (
              <div className="card px-5 py-6 text-sm text-[var(--text-2)]">
                No pending workflow approvals right now.
              </div>
            )}
          </section>
          </AnimatedContent>
        </>
      )}

      <section className="surface-card overflow-hidden">
        <div className="section-title mb-0 border-b border-[var(--border)] px-5 py-4">DECISION HISTORY</div>
        <div className="divide-y divide-[var(--border)] md:hidden">
          {history.length ? history.map(item => (
            <div key={item.id} className="space-y-2 px-4 py-4 text-sm">
              <div className="font-semibold text-white">{item.title}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={clsx('badge', item.status === 'approved' ? 'badge-green' : item.status === 'rejected' ? 'badge-red' : 'badge-muted')}>
                  {item.status}
                </span>
                <span className="font-mono text-xs text-[var(--text-3)]">{item.reviewer || item.reviewed_by_user_id || 'You'}</span>
              </div>
              <div className="font-mono text-xs text-[var(--text-3)]">
                {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : '-'}
              </div>
              <div className="text-[var(--text-2)] break-words">{item.reviewer_comment || '-'}</div>
            </div>
          )) : (
            <div className="px-4 py-8 text-center text-[var(--text-3)]">No decisions yet.</div>
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[var(--surface)] text-xs uppercase tracking-wide text-[var(--text-3)]">
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
                <tr key={item.id} className="border-t border-[var(--border)] text-[var(--text-2)] transition hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-white">{item.title}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('badge', item.status === 'approved' ? 'badge-green' : item.status === 'rejected' ? 'badge-red' : 'badge-muted')}>
                      {item.status}
                    </span>
                  </td>
                  <td className="mono px-4 py-3">{item.reviewer || item.reviewed_by_user_id || 'You'}</td>
                  <td className="mono px-4 py-3">{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : '-'}</td>
                  <td className="max-w-md truncate px-4 py-3">{item.reviewer_comment || '-'}</td>
                </tr>
              ))}
              {!history.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-3)]">
                    No decisions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  )
}

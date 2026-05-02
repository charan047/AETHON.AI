import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, ShieldAlert, XCircle } from 'lucide-react'
import { approvalsApi } from '../api/client'
import type { ApprovalRequest } from '../types'
import { clsx } from 'clsx'
import { toast } from '../lib/toast'

function timeUntil(value?: string | null) {
  if (!value) return 'No expiry'
  const diff = new Date(value).getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`
}

function ContextViewer({ data }: { data: ApprovalRequest['context_data'] }) {
  const [open, setOpen] = useState(false)
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? {}, null, 2)
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-400" onClick={() => setOpen(value => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Context data
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-slate-800 p-3 text-xs text-slate-300 whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  )
}

function ApprovalCard({
  approval,
  onDecision,
}: {
  approval: ApprovalRequest
  onDecision: (approval: ApprovalRequest, decision: 'approve' | 'reject', comment: string) => void
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [comment, setComment] = useState('')

  return (
    <div className="card p-5 border-amber-900/50 bg-gradient-to-br from-slate-900 to-amber-950/20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge-yellow">Pending</span>
            <span className="text-xs text-slate-500">{approval.workflow_name || 'Workflow'}</span>
            {approval.agent_name && <span className="text-xs text-slate-600">· {approval.agent_name}</span>}
          </div>
          <h3 className="mt-2 text-lg font-semibold text-slate-100">{approval.title}</h3>
          {approval.description && <p className="mt-1 text-sm text-slate-400">{approval.description}</p>}
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{new Date(approval.requested_at).toLocaleString()}</div>
          <div className="mt-1 flex items-center justify-end gap-1 text-amber-400">
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
            <button className="btn bg-emerald-900/40 text-emerald-300 border border-emerald-800/60 hover:bg-emerald-900/70" onClick={() => setDecision('approve')}>
              <CheckCircle2 size={16} /> Approve
            </button>
            <button className="btn-danger" onClick={() => setDecision('reject')}>
              <XCircle size={16} /> Reject
            </button>
          </>
        ) : (
          <div className="w-full space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <textarea
              className="input min-h-[80px]"
              placeholder={decision === 'approve' ? 'Optional approval comment...' : 'Why are you rejecting this?'}
              value={comment}
              onChange={event => setComment(event.target.value)}
            />
            <div className="flex gap-2">
              <button
                className={decision === 'approve' ? 'btn bg-emerald-900/50 text-emerald-300 border border-emerald-800/60 hover:bg-emerald-900/80' : 'btn-danger'}
                onClick={() => onDecision(approval, decision, comment)}
              >
                Confirm {decision === 'approve' ? 'approval' : 'rejection'}
              </button>
              <button className="btn-secondary" onClick={() => setDecision(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Approvals() {
  const qc = useQueryClient()
  const [pending, setPending] = useState<ApprovalRequest[]>([])

  const pendingQuery = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: approvalsApi.pending,
    refetchInterval: 10_000,
  })
  const { data: history = [] } = useQuery({
    queryKey: ['approvals', 'history'],
    queryFn: () => approvalsApi.history(50, 0),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (pendingQuery.data) setPending(pendingQuery.data)
  }, [pendingQuery.data])

  const decisionMut = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: 'approve' | 'reject'; comment: string }) =>
      decision === 'approve' ? approvalsApi.approve(id, comment) : approvalsApi.reject(id, comment),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['approvals'] })
      toast.success(variables.decision === 'approve' ? 'Approved' : 'Rejected')
    },
    onError: (error: any) => {
      qc.invalidateQueries({ queryKey: ['approvals', 'pending'] })
      toast.error(error.response?.data?.detail || 'Failed to submit decision')
    },
  })

  const submitDecision = (approval: ApprovalRequest, decision: 'approve' | 'reject', comment: string) => {
    setPending(items => items.filter(item => item.id !== approval.id))
    decisionMut.mutate({ id: approval.id, decision, comment })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Human Approvals</h1>
          <p className="mt-1 text-sm text-slate-400">Review paused workflow steps and resume or reject them.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={clsx('badge border text-sm', pending.length ? 'bg-red-900/40 text-red-300 border-red-800/60' : 'bg-slate-800 text-slate-400 border-slate-700')}>
            <ShieldAlert size={14} className="mr-1" /> {pending.length} pending
          </span>
          <span className="text-xs text-slate-600">Auto-refreshes every 10s</span>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pending approvals</h2>
        {pendingQuery.isLoading ? (
          <div className="card h-32 animate-pulse bg-slate-800/50" />
        ) : pending.length ? (
          pending.map(approval => (
            <ApprovalCard key={approval.id} approval={approval} onDecision={submitDecision} />
          ))
        ) : (
          <div className="card p-10 text-center text-slate-500">
            <ShieldAlert size={32} className="mx-auto mb-3 text-slate-700" />
            No pending approvals right now.
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-300">Decision history</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Reviewer</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {history.map(item => (
                <tr key={item.id} className="text-slate-400">
                  <td className="px-4 py-3 text-slate-200">{item.title}</td>
                  <td className="px-4 py-3"><span className={item.status === 'approved' ? 'badge-green' : item.status === 'rejected' ? 'badge-red' : 'badge-gray'}>{item.status}</span></td>
                  <td className="px-4 py-3">{item.reviewer || item.reviewed_by_user_id || 'You'}</td>
                  <td className="px-4 py-3">{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3 max-w-md truncate">{item.reviewer_comment || '-'}</td>
                </tr>
              ))}
              {!history.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-600">No decisions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

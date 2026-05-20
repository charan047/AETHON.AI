import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, FileDown, FileText, Link2, Mail, MessageSquareQuote, RotateCcw, XCircle } from 'lucide-react'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { MarkdownContent } from '../components/ui/MarkdownContent'
import { clientsApi, executionsApi, extractApiError, integrationsApi } from '../api/client'
import { toast } from '../lib/toast'
import type { Execution, ExecutionRevisionSummary } from '../types'

function refetchExecutionInterval(data: Execution | undefined) {
  const status = data?.status
  if (!status || ['completed', 'pending_review', 'failed', 'cancelled', 'timed_out', 'rejected'].includes(status)) {
    return false
  }
  return 3000
}

function extractReviewOutput(execution: Execution) {
  if (execution.output && execution.output.trim()) return execution.output
  if (execution.output_message && execution.output_message.trim()) return execution.output_message
  const finalStep = execution.steps
    ?.filter(step => step.step_type === 'final_answer')
    .sort((a, b) => b.step_index - a.step_index)[0]
  return finalStep?.content || ''
}

function formatDuration(durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) return 'In progress'
  if (durationSeconds < 60) return `${durationSeconds}s`
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function statusBadgeClass(status: Execution['status']) {
  if (status === 'completed') return 'badge-emerald'
  if (status === 'running' || status === 'pending') return 'badge-indigo'
  if (status === 'pending_review' || status === 'waiting_approval') return 'badge-amber'
  if (status === 'cancelled') return 'badge-glass'
  return 'badge-red'
}

function statusBadgeLabel(status: Execution['status']) {
  if (status === 'pending_review' || status === 'waiting_approval') return 'review'
  if (status === 'completed') return 'done'
  if (status === 'cancelled') return 'stopped'
  return status
}

function initials(name?: string | null) {
  return (name || 'A').trim().charAt(0).toUpperCase() || 'A'
}

function RevisionHistory({
  execution,
  revisions,
}: {
  execution: Execution
  revisions: ExecutionRevisionSummary[]
}) {
  const navigate = useNavigate()
  const currentRevision = revisions.find(item => item.id === execution.id) ?? null
  const previousRevisionNumber = currentRevision && currentRevision.revision_number > 1 ? currentRevision.revision_number - 1 : null

  return (
    <section className="glass-card overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-5 border-b border-white/[0.08] px-5 py-4">
        {revisions.map(revision => {
          const isCurrent = revision.id === execution.id
          const isApproved = Boolean(revision.approved_by)
          return (
            <button
              key={revision.id}
              type="button"
              onClick={() => {
                if (!isCurrent) navigate(`/executions/${revision.id}`)
              }}
              className={[
                'relative inline-flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-mono uppercase tracking-[0.14em] transition-colors',
                isCurrent
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]',
              ].join(' ')}
            >
              <span className="font-semibold">v{revision.revision_number}</span>
              {isApproved && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  <CheckCircle2 size={11} />
                  <span>ok</span>
                </span>
              )}
            </button>
          )
        })}
      </div>

      {currentRevision?.ceo_feedback && previousRevisionNumber ? (
        <div className="m-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/12 text-amber-300">
              <MessageSquareQuote size={15} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">CEO feedback on v{previousRevisionNumber}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-amber-100/80">{currentRevision.ceo_feedback}</p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ReviewPanel({ execution }: { execution: Execution }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [feedback, setFeedback] = useState(execution.approval_note || '')
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null)
  const [deliveryMode, setDeliveryMode] = useState<'email' | 'google_doc' | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const output = useMemo(() => extractReviewOutput(execution), [execution])
  const isPendingReview = execution.status === 'pending_review'
  const isApproved = execution.status === 'completed' && Boolean(execution.approved_by)
  const isDelivered = isApproved && Boolean(execution.delivered_at && execution.delivery_method)

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
    enabled: isApproved,
  })
  const { data: client } = useQuery({
    queryKey: ['client', execution.client_id],
    queryFn: () => clientsApi.get(execution.client_id!),
    enabled: isApproved && Boolean(execution.client_id),
  })

  const gmailConnected = integrations.some(integration => integration.integration_type === 'gmail' && integration.is_active)
  const googleConnected = gmailConnected

  useEffect(() => {
    setFeedback(execution.approval_note || '')
  }, [execution.id, execution.approval_note])

  useEffect(() => {
    setEmailTo(client?.contact_email || '')
  }, [client?.contact_email, execution.id])

  useEffect(() => {
    const dateLabel = execution.completed_at
      ? new Date(execution.completed_at).toLocaleDateString()
      : new Date().toLocaleDateString()
    setDocTitle(`${execution.workflow_name || 'Execution'} — ${execution.client_name || client?.company_name || client?.name || 'Client'} — ${dateLabel}`)
  }, [client?.company_name, client?.name, execution.client_name, execution.completed_at, execution.id, execution.workflow_name])

  const approveMutation = useMutation({
    mutationFn: () => executionsApi.approve(execution.id, feedback.trim() || undefined),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['execution', execution.id] })
      toast.success('Approved — trust score updated')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const regenerateMutation = useMutation({
    mutationFn: () => executionsApi.regenerate(execution.id, feedback.trim()),
    onSuccess: async payload => {
      toast.info('Regenerating — watch the new version below')
      await qc.invalidateQueries({ queryKey: ['execution', execution.id] })
      navigate(`/executions/${payload.revision_id}`)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deliverMutation = useMutation({
    mutationFn: (payload: { method: 'email' | 'google_doc' | 'portal'; email_to?: string; doc_title?: string }) =>
      executionsApi.deliver(execution.id, payload),
    onSuccess: async payload => {
      await qc.invalidateQueries({ queryKey: ['execution', execution.id] })
      setDeliveryError(null)
      setDeliveryMode(null)
      if (payload.method === 'portal') {
        await navigator.clipboard.writeText(payload.target)
        toast.success('Portal link copied — share with your client')
      } else {
        toast.success(`Delivered via ${payload.method === 'google_doc' ? 'Google Doc' : 'email'}`)
      }
    },
    onError: error => {
      const message = extractApiError(error)
      setDeliveryError(message)
      toast.error(message)
    },
  })

  const handleExport = async (format: 'pdf' | 'docx') => {
    try {
      setExportingFormat(format)
      const { blob, filename } = await executionsApi.export(execution.id, format)
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(href)
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setExportingFormat(null)
    }
  }

  const deliveredLabel = execution.delivery_method === 'google_doc'
    ? 'Google Doc'
    : execution.delivery_method === 'portal'
      ? 'client portal'
      : execution.delivery_method

  const handleReject = () => {
    if (!feedback.trim()) {
      toast.error('Add feedback before rejecting this output')
      return
    }
    regenerateMutation.mutate()
  }

  return (
    <section className="glass-card p-5">
      <div className="section-title">Output</div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm text-[var(--text-2)]">Review the final execution output.</div>
        {isApproved ? <div className="badge badge-emerald">approved</div> : null}
      </div>

      {isApproved && (
        <div className="glass-card glass-card-emerald mt-4 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 size={15} />
            <span className="font-medium">
              Approved
              {execution.approved_at ? ` on ${new Date(execution.approved_at).toLocaleString()}` : ''}
            </span>
          </div>
          {execution.approval_note && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-100/80">
              {execution.approval_note}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="text-xs text-[var(--t3)]">Export approved output:</p>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              disabled={exportingFormat !== null}
              className="btn-secondary btn-sm"
            >
              <FileText size={13} />
              {exportingFormat === 'pdf' ? 'Exporting…' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={() => handleExport('docx')}
              disabled={exportingFormat !== null}
              className="btn-secondary btn-sm"
            >
              <FileDown size={13} />
              {exportingFormat === 'docx' ? 'Exporting…' : 'Word'}
            </button>
          </div>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            {isDelivered ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 size={15} />
                  <span className="font-medium">
                    Delivered via {deliveredLabel}
                    {execution.delivered_at ? ` on ${new Date(execution.delivered_at).toLocaleString()}` : ''}
                  </span>
                </div>
                {execution.delivery_target && (
                  <p className="mt-2 break-all text-xs text-emerald-100/80">{execution.delivery_target}</p>
                )}
              </div>
            ) : (
              <div>
                <div className="section-title">Deliver</div>
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    className="row w-full rounded-lg border border-[var(--border)]"
                    onClick={() => {
                      setDeliveryMode(current => current === 'email' ? null : 'email')
                      setDeliveryError(null)
                    }}
                  >
                    <Mail size={13} />
                    Email
                  </button>
                  <button
                    type="button"
                    disabled={!googleConnected}
                    title={googleConnected ? 'Save to Google Docs' : 'Connect Google in /integrations'}
                    className="row w-full rounded-lg border border-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      setDeliveryMode(current => current === 'google_doc' ? null : 'google_doc')
                      setDeliveryError(null)
                    }}
                  >
                    <FileText size={13} />
                    Google Doc
                  </button>
                  <button
                    type="button"
                    disabled={!execution.client_id || deliverMutation.isPending}
                    title={execution.client_id ? 'Copy portal link' : 'Assign this execution to a client first'}
                    className="row w-full rounded-lg border border-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => deliverMutation.mutate({ method: 'portal' })}
                  >
                    <Link2 size={13} />
                    Client Portal
                  </button>
                </div>

                {deliveryMode === 'email' && (
                  <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-s)] p-3">
                    <label className="block text-xs font-medium text-white">
                      To:
                      <input
                        className="input mt-2 w-full"
                        placeholder="client@company.com"
                        value={emailTo}
                        onChange={event => setEmailTo(event.target.value)}
                      />
                    </label>
                    <button type="button" className="btn-primary mt-3 text-xs"
                      disabled={!emailTo.trim() || !gmailConnected || deliverMutation.isPending}
                      onClick={() => deliverMutation.mutate({ method: 'email', email_to: emailTo.trim() })}
                    >
                      {deliverMutation.isPending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                )}

                {deliveryMode === 'google_doc' && (
                  <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-s)] p-3">
                    <label className="block text-xs font-medium text-white">
                      Doc title:
                      <input
                        className="input mt-2 w-full"
                        value={docTitle}
                        onChange={event => setDocTitle(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-primary mt-3 text-xs"
                      disabled={!docTitle.trim() || !googleConnected || deliverMutation.isPending}
                      onClick={() => deliverMutation.mutate({ method: 'google_doc', doc_title: docTitle.trim() })}
                    >
                      {deliverMutation.isPending ? 'Saving…' : 'Save to Drive'}
                    </button>
                  </div>
                )}

                {deliveryError && (
                  <p className="mt-3 text-xs text-red-300">{deliveryError}</p>
                )}
                {!execution.client_id && (
                  <p className="mt-3 text-xs text-[#8B9DBE]">Assign this execution to a client first to share a portal link.</p>
                )}
                {!googleConnected && (
                  <p className="mt-2 text-xs text-[#8B9DBE]">Connect Google in <code>/integrations</code> to save approved outputs to Docs.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-[var(--border)] pt-5">
        {output.trim() ? (
          <MarkdownContent content={output} className="text-sm" />
        ) : (
          <p className="text-sm text-[var(--text-2)]">No final output was captured for this execution.</p>
        )}
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <div className="section-title">Feedback</div>
        <textarea
          value={feedback}
          onChange={event => setFeedback(event.target.value)}
          placeholder="What needs to change? Be specific — the agent will use this to regenerate."
          className="input mt-3 min-h-[120px] w-full resize-y px-3.5 py-3"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleReject}
            disabled={!isPendingReview || regenerateMutation.isPending}
            className="btn-danger"
          >
            <XCircle size={14} />
            {regenerateMutation.isPending ? 'Sending back…' : 'Reject'}
          </button>
          <button
            type="button"
            onClick={() => approveMutation.mutate()}
            disabled={!isPendingReview || approveMutation.isPending}
            className="btn-emerald btn-runner"
          >
            {approveMutation.isPending ? 'Approving…' : '✓ Approve'}
          </button>
          {feedback.trim() ? (
            <button
              type="button"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
              className="btn-secondary"
            >
              <RotateCcw size={14} />
              {regenerateMutation.isPending ? 'Regenerating…' : 'Regenerate with feedback'}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function ExecutionPage() {
  const { executionId } = useParams<{ executionId: string }>()
  const navigate = useNavigate()

  const { data: execution, isLoading, isError, error } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.get(executionId!),
    enabled: Boolean(executionId),
    refetchInterval: query => refetchExecutionInterval(query.state.data as Execution | undefined),
  })
  const { data: revisions = [] } = useQuery({
    queryKey: ['execution-revisions', executionId],
    queryFn: () => executionsApi.revisions(executionId!),
    enabled: Boolean(executionId),
    refetchInterval: refetchExecutionInterval(execution),
  })

  if (!executionId) return null

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-white/30">Loading execution…</div>
      </div>
    )
  }

  if (isError || !execution) {
    const detail = extractApiError(error) || 'Execution could not be loaded.'
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <div className="flex items-center gap-2 text-sm text-white/30">
          <button
            onClick={() => navigate('/monitoring')}
            className="transition-colors hover:text-white/60"
          >
            Monitoring
          </button>
          <span>/</span>
          <span className="max-w-[240px] truncate font-mono text-xs text-white/50">{executionId}</span>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="text-sm font-medium text-red-300">Execution unavailable</div>
          <div className="mt-1 text-sm text-white/60">{detail}</div>
        </div>
      </div>
    )
  }

  const showReviewPanel = execution.status === 'pending_review' || execution.status === 'completed'

  return (
    <div className="animate-in-up mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
        <button
          type="button"
          onClick={() => navigate('/monitoring')}
          className="inline-flex items-center gap-2 transition-colors hover:text-[var(--text-2)]"
        >
          <ArrowLeft size={14} />
          Monitoring
        </button>
        <span className="text-[var(--text-3)]">·</span>
        <span className="max-w-[260px] truncate text-[var(--text-2)]">
          {execution.workflow_name || executionId}
        </span>
      </div>

      <div className="glass-card flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/18 text-sm font-bold text-indigo-200">
          {initials(execution.agent_name || execution.workflow_name)}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-[var(--text-2)]">
          <span className="font-semibold text-white">{execution.agent_name || 'Agent'}</span>
          <span>·</span>
          <span>{execution.workflow_name || 'Workflow'}</span>
          <span>·</span>
          <span className="font-mono text-xs uppercase tracking-[0.10em]">{formatDuration(execution.duration_seconds)}</span>
          <span>·</span>
          <span className={['badge font-mono text-[10px] uppercase tracking-[0.08em]', statusBadgeClass(execution.status)].join(' ')}>
            {statusBadgeLabel(execution.status)}
          </span>
        </div>
      </div>

      {revisions.length > 1 ? <RevisionHistory execution={execution} revisions={revisions} /> : null}

      <div className="overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.03]">
        <ExecutionLiveView
          executionId={executionId}
          agentName={execution.workflow_name ?? execution.agent_name ?? 'Agent'}
          modelName={execution.model_name}
          initialInput={execution.input ?? execution.input_message}
          initialStatus={execution.status ?? 'queued'}
          existingSteps={execution.steps ?? []}
          maxHeight="65vh"
        />
      </div>

      {showReviewPanel ? <ReviewPanel execution={execution} /> : null}
    </div>
  )
}

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Flag, Pencil, ThumbsDown, ThumbsUp, CheckCircle2 } from 'lucide-react'
import { feedbackApi } from '../../api/client'
import type { FeedbackType } from '../../types'

type Mode = FeedbackType | null

export function FeedbackBar({
  executionId,
  agentId,
  output,
}: {
  executionId: string
  agentId: string | null
  output: string
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [comment, setComment] = useState('')
  const [editedOutput, setEditedOutput] = useState(output)
  const [submitted, setSubmitted] = useState(false)

  if (!agentId) return null

  const submit = async () => {
    if (!mode) return
    setSubmitted(true)
    try {
      await feedbackApi.record(executionId, agentId, {
        feedback_type: mode,
        edited_output: mode === 'edited' ? editedOutput : undefined,
        comment: comment || undefined,
      })
    } catch {
      // Optimistic by design; reputation will refresh on next view.
    }
  }

  if (submitted) {
    return (
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
        <CheckCircle2 size={13} />
        Feedback recorded
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex flex-wrap gap-2">
        <FeedbackButton active={mode === 'approved'} tone="green" onClick={() => setMode('approved')}>
          <ThumbsUp size={14} /> Approve
        </FeedbackButton>
        <FeedbackButton active={mode === 'edited'} tone="amber" onClick={() => setMode('edited')}>
          <Pencil size={14} /> Edit
        </FeedbackButton>
        <FeedbackButton active={mode === 'rejected'} tone="red" onClick={() => setMode('rejected')}>
          <ThumbsDown size={14} /> Reject
        </FeedbackButton>
        <FeedbackButton active={mode === 'flagged'} tone="gray" onClick={() => setMode('flagged')}>
          <Flag size={14} /> Flag
        </FeedbackButton>
      </div>

      {mode && (
        <div className="mt-3 space-y-2">
          {mode === 'edited' && (
            <textarea
              className="input min-h-[140px] resize-y font-mono text-xs"
              value={editedOutput}
              onChange={event => setEditedOutput(event.target.value)}
            />
          )}
          <textarea
            className="input min-h-[70px] resize-y text-xs"
            placeholder="Optional comment..."
            value={comment}
            onChange={event => setComment(event.target.value)}
          />
          <button className="btn-primary text-xs" onClick={submit}>Submit feedback</button>
        </div>
      )}
    </div>
  )
}

function FeedbackButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean
  tone: 'green' | 'amber' | 'red' | 'gray'
  onClick: () => void
  children: ReactNode
}) {
  const tones = {
    green: active ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'text-obsidian-400 hover:text-emerald-200',
    amber: active ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'text-obsidian-400 hover:text-amber-200',
    red: active ? 'border-red-400/30 bg-red-400/10 text-red-200' : 'text-obsidian-400 hover:text-red-200',
    gray: active ? 'border-white/20 bg-white/[0.06] text-white' : 'text-obsidian-400 hover:text-white',
  }
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs transition ${tones[tone]}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

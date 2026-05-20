import { FormEvent, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, X } from 'lucide-react'
import { extractApiError, organizationsApi } from '../../api/client'
import { FloatingField } from '../../components/AuthShell'
import type { OrgMemberRole } from '../../types'
import { toast } from '../../lib/toast'

interface InviteMemberModalProps {
  open: boolean
  orgId?: string | null
  onClose: () => void
  onSent?: () => void
}

export function InviteMemberModal({ open, orgId, onClose, onSent }: InviteMemberModalProps) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<OrgMemberRole, 'owner'>>('member')
  const [message, setMessage] = useState('')

  const invite = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error('Choose an organization first')
      return organizationsApi.invite(orgId, { email, role, message: message || undefined })
    },
    onSuccess: () => {
      toast.success(`Invite sent to ${email}`)
      void queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] })
      setEmail('')
      setRole('member')
      setMessage('')
      onSent?.()
      onClose()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    invite.mutate()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={submit}
        className="glass-elevated w-full max-w-lg rounded-[28px] border border-white/[0.10] p-6 text-white"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-200">
              <Mail size={20} />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Invite member</h2>
            <p className="mt-1 text-sm text-[#8B9DBE]">Bring another operator into this AI company workspace.</p>
          </div>
          <button type="button" className="btn-ghost px-2" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <FloatingField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            required
            autoComplete="email"
          />

          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.20em] text-[#4B5A73]">Role</div>
            <div className="flex flex-wrap gap-2">
              {([
                ['member', 'Member'],
                ['admin', 'Admin'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className={
                    role === value
                      ? 'rounded-full border border-indigo-500/30 bg-indigo-500/15 px-4 py-2 text-sm text-indigo-300'
                      : 'rounded-full border border-white/[0.10] bg-white/[0.03] px-4 py-2 text-sm text-[#8B9DBE]'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <FloatingField
            label="Personal message"
            type="text"
            value={message}
            onChange={setMessage}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-runner" disabled={invite.isPending || !orgId}>
            {invite.isPending ? 'Sending...' : 'Send Invite'}
          </button>
        </div>
      </form>
    </div>
  )
}

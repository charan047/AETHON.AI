import { FormEvent, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, X } from 'lucide-react'
import { organizationsApi } from '../../api/client'
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
    onError: (error: any) => toast.error(error.response?.data?.detail || error.message || 'Could not send invite'),
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
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-obsidian-900 p-6 text-white shadow-glow-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-500/15 text-accent-200">
              <Mail size={20} />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Invite member</h2>
            <p className="mt-1 text-sm text-obsidian-400">Bring another operator into this AI company workspace.</p>
          </div>
          <button type="button" className="btn-ghost px-2" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="founder@company.com"
              required
            />
          </div>

          <div>
            <label className="label">Role</label>
            <select className="input" value={role} onChange={event => setRole(event.target.value as Exclude<OrgMemberRole, 'owner'>)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <p className="mt-1 text-xs text-obsidian-500">Owner invites are disabled; ownership transfer should be handled separately.</p>
          </div>

          <div>
            <label className="label">Personal message</label>
            <textarea
              className="input min-h-28"
              value={message}
              onChange={event => setMessage(event.target.value)}
              placeholder="Optional note for the invite email."
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={invite.isPending || !orgId}>
            {invite.isPending ? 'Sending...' : 'Send Invite'}
          </button>
        </div>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { MailPlus, RefreshCw, Trash2, UserMinus, Users } from 'lucide-react'
import { extractApiError, organizationsApi } from '../api/client'
import { InviteMemberModal } from '../components/org/InviteMemberModal'
import { Skeleton } from '../components/ui/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import type { OrgInvite, OrgMember, OrgMemberRole } from '../types'
import { toast } from '../lib/toast'

function formatAgo(value?: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return formatDistanceToNow(date, { addSuffix: true })
}

function initials(name?: string | null, email?: string | null) {
  const source = (name || email || 'Member').trim()
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
}

function roleBadge(role: OrgMemberRole) {
  if (role === 'owner') return 'badge-indigo'
  return 'badge-glass'
}

function MemberRow({
  member,
  currentUserId,
  canRemove,
  canEditRole,
  canPromoteAdmin,
  onRoleChange,
  onRemove,
}: {
  member: OrgMember
  currentUserId?: string | null
  canRemove: boolean
  canEditRole: boolean
  canPromoteAdmin: boolean
  onRoleChange: (role: OrgMemberRole) => void
  onRemove: () => void
}) {
  return (
    <div className="data-row group min-h-[48px]">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/15 text-xs font-semibold text-indigo-200">
        {initials(member.full_name, member.email)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">
          {member.full_name || 'Unnamed member'}
          {member.user_id === currentUserId && <span className="ml-2 text-xs text-indigo-300">You</span>}
        </div>
        <div className="truncate text-xs text-[#8B9DBE]">{member.email || 'Unknown'}</div>
      </div>
      {canEditRole ? (
        <select
          className="input h-9 w-28 py-1 text-xs capitalize"
          value={member.role}
          onChange={event => onRoleChange(event.target.value as OrgMemberRole)}
        >
          <option value="member">Member</option>
          {canPromoteAdmin && <option value="admin">Admin</option>}
        </select>
      ) : (
        <span className={roleBadge(member.role)}>{member.role === 'owner' ? 'CEO' : member.role}</span>
      )}
      <button
        className="btn-danger btn-sm opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
        onClick={onRemove}
        disabled={!canRemove}
      >
        <UserMinus size={13} />
        Remove
      </button>
    </div>
  )
}

function PendingInviteRow({
  invite,
  onResend,
  onCancel,
}: {
  invite: OrgInvite
  onResend: () => void
  onCancel: () => void
}) {
  return (
    <div className="data-row data-row-amber min-h-[48px]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">{invite.email}</div>
        <div className="text-xs text-[#8B9DBE]">Sent {formatAgo(invite.created_at)}</div>
      </div>
      <span className="badge-amber">{invite.role}</span>
      <button className="btn-ghost btn-sm" onClick={onResend}>
        <RefreshCw size={13} />
        Resend
      </button>
      <button className="btn-ghost btn-sm text-red-300 hover:text-red-200" onClick={onCancel}>
        <Trash2 size={13} />
        Cancel
      </button>
    </div>
  )
}

export function TeamManagement() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const orgId = auth.activeOrg?.id
  const currentRole = auth.activeOrg?.role
  const canManage = currentRole === 'owner' || currentRole === 'admin'
  const [inviteOpen, setInviteOpen] = useState(false)

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => organizationsApi.members(orgId!),
    enabled: Boolean(orgId),
  })
  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ['org-invites', orgId],
    queryFn: () => organizationsApi.invites(orgId!),
    enabled: Boolean(orgId && canManage),
  })

  const removeMember = useMutation({
    mutationFn: (member: OrgMember) => organizationsApi.removeMember(orgId!, member.user_id),
    onSuccess: () => {
      toast.success('Member removed')
      void queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
      void auth.refreshOrganizations(orgId)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const isOwner = currentRole === 'owner'

  const roleChange = useMutation({
    mutationFn: ({ member, role }: { member: OrgMember; role: OrgMemberRole }) =>
      organizationsApi.updateMemberRole(orgId!, member.user_id, role),
    onSuccess: () => {
      toast.success('Role updated')
      void queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
      void auth.refreshOrganizations(orgId)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const resendInvite = useMutation({
    mutationFn: (inviteId: string) => organizationsApi.resendInvite(orgId!, inviteId),
    onSuccess: () => {
      toast.success('Invite resent')
      void queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] })
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => organizationsApi.revokeInvite(orgId!, inviteId),
    onSuccess: () => {
      toast.success('Invite revoked')
      void queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] })
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const canEditRole = (member: OrgMember) => {
    if (!canManage || member.role === 'owner' || member.user_id === auth.userId) return false
    if (member.role === 'admin' && !isOwner) return false
    return true
  }

  const canRemove = (member: OrgMember) => canManage && member.role !== 'owner' && member.user_id !== auth.userId

  if (!auth.activeOrg) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div className="glass-card max-w-md p-8">
          <Users className="mx-auto text-[#4B5A73]" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">No organization selected</h1>
          <p className="mt-2 text-sm text-[#8B9DBE]">Create or switch into an organization before managing teammates.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">{members.length} members</p>
        </div>
        {canManage && (
          <button className="btn-primary btn-runner" onClick={() => setInviteOpen(true)}>
            <MailPlus size={16} /> Invite Member
          </button>
        )}
      </div>

      <section className="glass-card overflow-hidden">
        <div className="page-header px-5 py-4">
          <div>
            <div className="section-title mb-0 border-none pb-0">Members</div>
          </div>
        </div>

        {membersLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map(item => <Skeleton key={item} className="h-16 rounded-2xl" />)}
          </div>
        ) : (
          <div>
            {members.map(member => (
              <MemberRow
                key={member.id}
                member={member}
                currentUserId={auth.userId}
                canRemove={canRemove(member)}
                canEditRole={canEditRole(member)}
                canPromoteAdmin={isOwner}
                onRoleChange={role => roleChange.mutate({ member, role })}
                onRemove={() => removeMember.mutate(member)}
              />
            ))}
          </div>
        )}
      </section>

      {canManage && (
        <section className="glass-card overflow-hidden">
          <div className="px-5 py-4">
            <div className="section-title mb-0 border-none pb-0">Pending Invites</div>
          </div>

          {invitesLoading ? (
            <div className="p-5"><Skeleton className="h-20 rounded-2xl" /></div>
          ) : invites.length ? (
            <div>
              {invites.map(invite => (
                <PendingInviteRow
                  key={invite.id}
                  invite={invite}
                  onResend={() => resendInvite.mutate(invite.id)}
                  onCancel={() => revokeInvite.mutate(invite.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.10] px-4 py-8 text-center text-sm text-[#8B9DBE]">
              No pending invites right now.
            </div>
          )}
        </section>
      )}

      <InviteMemberModal open={inviteOpen} orgId={orgId} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

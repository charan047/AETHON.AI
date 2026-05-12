import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { MailPlus, RefreshCw, Shield, Trash2, UserMinus, Users } from 'lucide-react'
import { extractApiError, organizationsApi } from '../api/client'
import { InviteMemberModal } from '../components/org/InviteMemberModal'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { Skeleton } from '../components/ui/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import type { OrgMember, OrgMemberRole } from '../types'
import { toast } from '../lib/toast'

function formatDate(value?: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return format(date, 'MMM d, yyyy')
}

function formatAgo(value?: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return formatDistanceToNow(date, { addSuffix: true })
}

function roleBadge(role: OrgMemberRole) {
  const tone = role === 'owner' ? 'text-amber-200 bg-amber-400/10 border-amber-400/20' : role === 'admin' ? 'text-cyan-200 bg-cyan-400/10 border-cyan-400/20' : 'text-obsidian-300 bg-white/[0.04] border-white/10'
  return `rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`
}

export function TeamManagement() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const orgId = auth.activeOrg?.id
  const currentRole = auth.activeOrg?.role
  const canManage = currentRole === 'owner' || currentRole === 'admin'
  const isOwner = currentRole === 'owner'
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

  const roleChange = useMutation({
    mutationFn: ({ member, role }: { member: OrgMember; role: OrgMemberRole }) => organizationsApi.updateMemberRole(orgId!, member.user_id, role),
    onSuccess: () => {
      toast.success('Role updated')
      void queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
      void auth.refreshOrganizations(orgId)
    },
    onError: error => toast.error(extractApiError(error)),
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
        <div className="card max-w-md p-8">
          <Users className="mx-auto text-obsidian-600" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">No organization selected</h1>
          <p className="mt-2 text-sm text-obsidian-400">Create or switch into an organization before managing teammates.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">{auth.activeOrg.name}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-white">Team Management</h1>
          <p className="mt-2 text-sm text-obsidian-400">Manage access, roles, and pending invitations for this company workspace.</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <MailPlus size={16} /> Invite Member
          </button>
        )}
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <div>
            <h2 className="text-xl font-semibold text-white">Team Members</h2>
            <p className="mt-1 text-sm text-obsidian-500">{members.length} active member{members.length === 1 ? '' : 's'}</p>
          </div>
          <Shield className="text-obsidian-600" />
        </div>

        {membersLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map(item => <Skeleton key={item} className="h-16 rounded-2xl" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-white/[0.02] text-xs uppercase tracking-[0.16em] text-obsidian-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                  <th className="px-5 py-3 font-medium">Last Active</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {members.map(member => (
                  <tr key={member.id} className="text-obsidian-300">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <AgentAvatar name={member.full_name || member.email || 'Member'} size="sm" />
                        <div>
                          <div className="font-medium text-white">{member.full_name || 'Unnamed member'}</div>
                          {member.user_id === auth.userId && <div className="text-xs text-accent-300">You</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">{member.email || 'Unknown'}</td>
                    <td className="px-5 py-4">
                      {canEditRole(member) ? (
                        <select
                          className="input h-9 w-32 py-1 text-xs capitalize"
                          value={member.role}
                          onChange={event => roleChange.mutate({ member, role: event.target.value as OrgMemberRole })}
                        >
                          <option value="member">Member</option>
                          {isOwner && <option value="admin">Admin</option>}
                        </select>
                      ) : (
                        <span className={roleBadge(member.role)}>{member.role}</span>
                      )}
                    </td>
                    <td className="px-5 py-4">{formatDate(member.joined_at)}</td>
                    <td className="px-5 py-4">{formatAgo(member.last_active_at)}</td>
                    <td className="px-5 py-4 text-right">
                      {canRemove(member) ? (
                        <button className="btn-ghost h-9 text-red-300 hover:text-red-200" onClick={() => removeMember.mutate(member)}>
                          <UserMinus size={14} /> Remove
                        </button>
                      ) : (
                        <span className="text-xs text-obsidian-600">Locked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 p-5">
            <div>
              <h2 className="text-xl font-semibold text-white">Pending Invites</h2>
              <p className="mt-1 text-sm text-obsidian-500">Invites that have not been accepted yet.</p>
            </div>
          </div>

          {invitesLoading ? (
            <div className="p-5"><Skeleton className="h-20 rounded-2xl" /></div>
          ) : invites.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-white/[0.02] text-xs uppercase tracking-[0.16em] text-obsidian-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Invited By</th>
                    <th className="px-5 py-3 font-medium">Sent</th>
                    <th className="px-5 py-3 font-medium">Expiry</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {invites.map(invite => (
                    <tr key={invite.id} className="text-obsidian-300">
                      <td className="px-5 py-4">{invite.email}</td>
                      <td className="px-5 py-4"><span className={roleBadge(invite.role)}>{invite.role}</span></td>
                      <td className="px-5 py-4">{invite.invited_by || invite.invited_by_user_id}</td>
                      <td className="px-5 py-4">{formatDate(invite.created_at)}</td>
                      <td className="px-5 py-4">{formatDate(invite.expires_at)}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button className="btn-ghost h-9 px-2 text-xs" onClick={() => resendInvite.mutate(invite.id)}>
                            <RefreshCw size={13} /> Resend
                          </button>
                          <button className="btn-ghost h-9 px-2 text-xs text-red-300 hover:text-red-200" onClick={() => revokeInvite.mutate(invite.id)}>
                            <Trash2 size={13} /> Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-obsidian-500">No pending invites. Suspiciously peaceful.</div>
          )}
        </section>
      )}

      <InviteMemberModal open={inviteOpen} orgId={orgId} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

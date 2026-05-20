import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, LogOut, Plus, Send } from 'lucide-react'
import { clsx } from 'clsx'
import { extractApiError, organizationsApi } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { AgentAvatar } from '../ui/AgentAvatar'
import { InviteMemberModal } from './InviteMemberModal'
import { toast } from '../../lib/toast'

function planLabel(plan?: string) {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Free'
}

export function OrgSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const currentRole = auth.activeOrg?.role
  const canInvite = currentRole === 'owner' || currentRole === 'admin'

  const createOrg = useMutation({
    mutationFn: (name: string) => organizationsApi.create({ name }),
    onSuccess: async org => {
      await auth.refreshOrganizations(org.id)
      void queryClient.invalidateQueries()
      toast.success(`Switched to ${org.name}`)
      setCreating(false)
      setNewOrgName('')
      setOpen(false)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const switchOrg = (orgId: string) => {
    auth.switchOrg(orgId)
    setOpen(false)
  }

  const handleSignOut = () => {
    auth.logout()
    setOpen(false)
    setCreating(false)
    setNewOrgName('')
    navigate('/login', { replace: true })
  }

  const submitCreateOrg = () => {
    const name = newOrgName.trim()
    if (!name) {
      toast.error('Enter an organization name')
      return
    }
    createOrg.mutate(name)
  }

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setCreating(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  if (!auth.activeOrg) {
    return (
      <div ref={wrapperRef} className={clsx('relative border-b border-white/[0.06] p-3', collapsed && 'px-2')}>
        <div className={clsx('flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2', collapsed && 'justify-center')}>
          <AgentAvatar name="Org" size="sm" />
          {!collapsed && <span className="text-xs text-ink-muted">No organization</span>}
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={clsx('relative z-20 border-b border-white/[0.06] p-3', collapsed && 'px-2')}>
      <button
        type="button"
        className={clsx('flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-2 text-left transition hover:border-indigo-400/30 hover:bg-white/[0.06]', collapsed && 'justify-center')}
        onClick={() => setOpen(value => !value)}
        title={collapsed ? auth.activeOrg.name : undefined}
        aria-expanded={open}
      >
        <AgentAvatar name={auth.activeOrg.name} imageUrl={auth.activeOrg.logo_url || undefined} size="sm" />
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{auth.activeOrg.name}</div>
              <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-ink-faint">{planLabel(auth.activeOrg.plan)} · {auth.activeOrg.role}</div>
            </div>
            <ChevronDown size={15} className={clsx('text-ink-faint transition', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && (
        <div className={clsx(
          'absolute top-full z-40 mt-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-base-surface p-2 shadow-[0_24px_64px_rgba(0,0,0,0.45)]',
          collapsed ? 'left-14 w-[min(20rem,calc(100vw-2rem))]' : 'left-0 right-0',
        )}>
          <div className="max-h-72 overflow-y-auto">
            {auth.userOrgs.map(org => {
              const active = org.id === auth.activeOrg?.id
              return (
                <button
                  key={org.id}
                  type="button"
                  className={clsx('flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-white/[0.04]', active && 'bg-indigo-500/10')}
                  onClick={() => switchOrg(org.id)}
                >
                  <AgentAvatar name={org.name} imageUrl={org.logo_url || undefined} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{org.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-faint">
                      <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-emerald-300">{planLabel(org.plan)}</span>
                      <span className="capitalize">{org.role}</span>
                    </div>
                  </div>
                  {active && <Check size={16} className="text-emerald-300" />}
                </button>
              )
            })}
          </div>

          <div className="my-2 h-px bg-white/10" />

          {creating ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <label className="label">New organization</label>
              <input
                className="input"
                value={newOrgName}
                onChange={event => setNewOrgName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') submitCreateOrg()
                  if (event.key === 'Escape') {
                    setCreating(false)
                    setNewOrgName('')
                  }
                }}
                placeholder="Acme AI"
                autoFocus
              />
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-primary h-8 flex-1 text-xs" disabled={createOrg.isPending} onClick={submitCreateOrg}>
                  {createOrg.isPending ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  className="btn-ghost h-8 px-3 text-xs"
                  onClick={() => {
                    setCreating(false)
                    setNewOrgName('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-secondary transition hover:bg-white/[0.04] hover:text-white"
              onClick={() => setCreating(true)}
            >
              <Plus size={15} /> Create new organization
            </button>
          )}
          {canInvite && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-secondary transition hover:bg-white/[0.04] hover:text-white"
              onClick={() => {
                setInviteOpen(true)
                setOpen(false)
              }}
            >
              <Send size={15} /> Invite to current org
            </button>
          )}

          <div className="my-2 h-px bg-white/10" />

          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
            onClick={handleSignOut}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}

      <InviteMemberModal open={inviteOpen} orgId={auth.activeOrg.id} onClose={() => setInviteOpen(false)} />
    </div>
  )
}

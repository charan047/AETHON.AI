import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { organizationsApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'

function formatDate(value?: string | null) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : format(date, 'MMM d, yyyy')
}

export function AcceptInvite() {
  const { token = '' } = useParams()
  const auth = useAuth()
  const navigate = useNavigate()
  const invitePath = `/invite/${token}`
  const { data: invite, isLoading, error } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => organizationsApi.inviteDetails(token),
    enabled: Boolean(token),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => organizationsApi.acceptInvite(token),
    onSuccess: async result => {
      await auth.refreshOrganizations(result.org_id)
      toast.success(`Welcome to ${result.org_name || invite?.org_name || 'your new org'}!`)
      navigate('/')
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Could not accept invitation'),
  })

  return (
    <div className="grid min-h-screen place-items-center overflow-hidden bg-obsidian-950 px-4 py-10 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.18),transparent_30%)]" />
      <div className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-obsidian-900/90 p-8 shadow-glow-lg backdrop-blur">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-500/15 text-accent-200">
          <Mail size={24} />
        </div>

        {isLoading || auth.isLoading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto animate-spin text-accent-300" />
            <p className="mt-3 text-sm text-obsidian-400">Loading invitation...</p>
          </div>
        ) : error || !invite ? (
          <div className="py-8 text-center">
            <h1 className="text-2xl font-semibold">Invite unavailable</h1>
            <p className="mt-2 text-sm text-obsidian-400">This invite may have expired, been revoked, or already accepted.</p>
            <Link className="btn-primary mt-6" to="/login">Sign in</Link>
          </div>
        ) : (
          <>
            <div className="mt-6 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Workspace invitation</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Join {invite.org_name}</h1>
              <p className="mt-3 leading-7 text-obsidian-300">
                {invite.inviter_name} invited you as <span className="font-semibold capitalize text-white">{invite.role}</span>.
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-emerald-300" size={20} />
                <div>
                  <div className="text-sm font-medium text-white">{invite.email}</div>
                  <div className="mt-1 text-xs text-obsidian-500">Expires {formatDate(invite.expires_at)}</div>
                </div>
              </div>
            </div>

            {auth.isAuthenticated ? (
              <button className="btn-primary mt-6 h-12 w-full justify-center" disabled={accept.isPending} onClick={() => accept.mutate()}>
                {accept.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {accept.isPending ? 'Accepting...' : 'Accept Invitation'}
              </button>
            ) : (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Link className="btn-primary h-12 justify-center" to="/login" state={{ from: { pathname: invitePath } }}>
                  Sign in to accept
                </Link>
                <Link className="btn-secondary h-12 justify-center" to="/register" state={{ from: { pathname: invitePath } }}>
                  Create account
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

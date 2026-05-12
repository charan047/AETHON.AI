import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { extractApiError, organizationsApi } from '../api/client'
import { AuthShell } from '../components/AuthShell'
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
  const {
    data: invite,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => organizationsApi.inviteDetails(token),
    enabled: Boolean(token),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => organizationsApi.acceptInvite(token),
    onSuccess: async result => {
      await auth.refreshOrganizations(result.org_id)
      toast.success(`Welcome to ${result.org_name || invite?.org_name || 'your new agency'}!`)
      navigate('/')
    },
    onError: err => toast.error(extractApiError(err)),
  })

  return (
    <AuthShell
      mode="invite"
      title="You've been invited"
      subtitle="Accept to join the agency workspace."
    >
      {isLoading || auth.isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="mx-auto animate-spin text-blue-300" />
          <p className="mt-3 text-sm text-[#8B9DBE]">Loading invitation...</p>
        </div>
      ) : error || !invite ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            This invite may have expired, been revoked, or already accepted.
          </div>
          <Link className="btn-primary h-12 w-full justify-center" to="/login">
            Sign in
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">
              Inviting agency
            </div>
            <div className="text-xl font-semibold tracking-tight text-white">{invite.org_name}</div>
            <p className="mt-2 text-sm leading-6 text-[#8B9DBE]">
              {invite.inviter_name} invited you as{' '}
              <span className="font-semibold capitalize text-white">{invite.role}</span>.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/10 text-blue-300">
                <Mail size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{invite.email}</div>
                <div className="mt-1 text-xs text-[#8B9DBE]">Expires {formatDate(invite.expires_at)}</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-xs text-[#8B9DBE]">
              <ShieldCheck size={14} className="text-emerald-400" />
              Join the shared workspace, clients, and AI team context.
            </div>
          </div>

          {auth.isAuthenticated ? (
            <button
              className="btn-primary h-12 w-full justify-center"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CheckCircle2 size={16} />
              )}
              {accept.isPending ? 'Accepting...' : 'Accept invitation'}
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                className="btn-primary h-12 justify-center"
                to="/login"
                state={{ from: { pathname: invitePath } }}
              >
                Sign in to accept
              </Link>
              <Link
                className="btn-secondary h-12 justify-center"
                to="/register"
                state={{ from: { pathname: invitePath } }}
              >
                Create account
              </Link>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  )
}

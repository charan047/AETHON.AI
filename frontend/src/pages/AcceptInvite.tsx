import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { extractApiError, organizationsApi } from '../api/client'
import { AuthShell } from '../components/AuthShell'
import { Button as MovingBorderButton } from '../components/ui/aceternity/MovingBorder'
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
      title="You're invited"
      subtitle={invite?.org_name ? `Join ${invite.org_name}.` : 'Join the agency workspace.'}
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
          <MovingBorderButton
            as={Link}
            to="/login"
            className="h-12 w-full justify-center bg-indigo-600 text-sm font-semibold text-white"
            containerClassName="w-full"
            borderClassName="bg-[radial-gradient(#818cf8_40%,transparent_60%)]"
            borderRadius="10px"
            duration={3000}
          >
            Sign in
          </MovingBorderButton>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 auth-invite-card">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
              Inviting agency
            </div>
            <div className="text-xl font-semibold tracking-tight text-white auth-shell__title">{invite.org_name}</div>
            <p className="mt-2 text-sm leading-6 text-[#8B9DBE] auth-shell__subtitle">
              {invite.inviter_name} invited you as{' '}
              <span className="font-semibold capitalize text-white auth-shell__title">{invite.role}</span>.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 auth-invite-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/10 text-indigo-300">
                <Mail size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white auth-shell__title">{invite.email}</div>
                <div className="mt-1 text-xs text-[#8B9DBE] auth-shell__subtitle">Expires {formatDate(invite.expires_at)}</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-xs text-[#8B9DBE] auth-invite-note">
              <ShieldCheck size={14} className="text-emerald-400" />
              Join the shared workspace, clients, and AI team context.
            </div>
          </div>

          {auth.isAuthenticated ? (
            <MovingBorderButton
              className="h-12 w-full justify-center bg-indigo-600 text-sm font-semibold text-white"
              containerClassName="w-full"
              borderClassName="bg-[radial-gradient(#818cf8_40%,transparent_60%)]"
              borderRadius="10px"
              duration={3000}
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CheckCircle2 size={16} />
              )}
              {accept.isPending ? 'Accepting...' : 'Accept invitation'}
            </MovingBorderButton>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <MovingBorderButton
                as={Link}
                to="/login"
                state={{ from: { pathname: invitePath } }}
                className="h-12 w-full justify-center bg-indigo-600 text-sm font-semibold text-white"
                containerClassName="w-full"
                borderClassName="bg-[radial-gradient(#818cf8_40%,transparent_60%)]"
                borderRadius="10px"
                duration={3000}
              >
                Sign in to accept
              </MovingBorderButton>
              <Link
                className="btn-secondary btn-lg justify-center"
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

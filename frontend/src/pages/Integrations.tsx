import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Github, Mail, Plus, RefreshCw, Search, Slack, Trash2, X } from 'lucide-react'
import { extractApiError, integrationsApi, toolsApi } from '../api/client'
import type { UserIntegration } from '../types'
import { GlowCard } from '../components/ui/GlowCard'
import { toast } from '../lib/toast'

interface ProviderStatus {
  provider: string
  status: 'healthy' | 'degraded' | 'not_configured' | 'unavailable'
  last_check?: string
  note?: string
}

interface ProviderHealth {
  search: ProviderStatus
  gmail: ProviderStatus
  slack: ProviderStatus
  github: ProviderStatus
}

function providerDot(status: ProviderStatus['status']) {
  if (status === 'healthy') return 'bg-emerald-400'
  if (status === 'degraded') return 'bg-amber-400'
  if (status === 'unavailable') return 'bg-red-400'
  return 'bg-obsidian-600'
}

function providerLabel(status: ProviderStatus['status']) {
  if (status === 'healthy') return 'Healthy'
  if (status === 'degraded') return 'Degraded'
  if (status === 'unavailable') return 'Unavailable'
  return 'Not configured'
}

function providerTextColor(status: ProviderStatus['status']) {
  if (status === 'healthy') return 'text-emerald-400'
  if (status === 'degraded') return 'text-amber-400'
  if (status === 'unavailable') return 'text-red-400'
  return 'text-obsidian-500'
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  search: <Search size={15} />,
  gmail:  <Mail size={15} />,
  slack:  <Slack size={15} />,
  github: <Github size={15} />,
}

const PROVIDER_LABELS: Record<string, string> = {
  search: 'Web Search',
  gmail:  'Gmail',
  slack:  'Slack',
  github: 'GitHub',
}

type ModalType = 'github' | 'email' | null

function statusBadge(integration: UserIntegration) {
  if (!integration.last_tested_at) return 'badge-gray'
  if (integration.last_test_result === 'success') return 'badge-green'
  return 'badge-red'
}

function statusLabel(integration: UserIntegration) {
  if (!integration.last_tested_at) return 'Untested'
  if (integration.last_test_result === 'success') return 'Connected'
  return 'Error'
}

export function Integrations() {
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [modal, setModal] = useState<ModalType>(null)
  const [handledOAuthCallback, setHandledOAuthCallback] = useState(false)
  const [githubForm, setGithubForm] = useState({ name: 'My GitHub', access_token: '', default_repo: '' })
  const [emailForm, setEmailForm] = useState({
    name: 'Work Email',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    imap_host: '',
    imap_port: 993,
    from_name: '',
  })

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  })

  const { data: providerHealth, isLoading: healthLoading, refetch: refetchHealth } = useQuery<ProviderHealth>({
    queryKey: ['tools-provider-health'],
    queryFn: toolsApi.toolsHealth,
    staleTime: 60_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] })
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['integrations'] })
    qc.invalidateQueries({ queryKey: ['tools-provider-health'] })
  }
  const github = integrations.filter(item => item.integration_type === 'github')
  const email = integrations.filter(item => item.integration_type === 'email_smtp')
  const gmailIntegration = integrations.find(item => item.integration_type === 'gmail') || null
  const slackIntegration = integrations.find(item => item.integration_type === 'slack') || null

  const createGitHub = useMutation({
    mutationFn: integrationsApi.createGitHub,
    onSuccess: () => {
      toast.success('GitHub connected')
      setModal(null)
      refresh()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const createEmail = useMutation({
    mutationFn: integrationsApi.createEmail,
    onSuccess: () => {
      toast.success('Email connected')
      setModal(null)
      refresh()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const startGmailOAuth = useMutation({
    mutationFn: integrationsApi.startGmailOAuth,
    onSuccess: data => {
      window.location.href = data.oauth_url
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const startSlackOAuth = useMutation({
    mutationFn: integrationsApi.startSlackOAuth,
    onSuccess: data => {
      window.location.href = data.oauth_url
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const oauthCallback = useMutation({
    mutationFn: integrationsApi.oauthCallback,
    onSuccess: data => {
      const label = data.provider === 'gmail' ? data.email : data.workspace
      toast.success(`${data.provider === 'gmail' ? 'Gmail' : 'Slack'} connected${label ? ` as ${label}` : ''}`)
      refreshAll()
      navigate('/integrations', { replace: true })
    },
    onError: error => {
      toast.error(extractApiError(error))
      navigate('/integrations', { replace: true })
    },
  })

  const testIntegration = useMutation({
    mutationFn: integrationsApi.test,
    onSuccess: integration => {
      toast[integration.last_test_result === 'success' ? 'success' : 'error'](
        integration.last_test_result === 'success' ? 'Connection test passed' : integration.last_test_result || 'Test failed',
      )
      refresh()
    },
  })

  const deleteIntegration = useMutation({
    mutationFn: integrationsApi.delete,
    onSuccess: () => {
      toast.success('Integration removed')
      refreshAll()
    },
  })

  useEffect(() => {
    if (location.pathname !== '/integrations/oauth/callback' || handledOAuthCallback) return

    const params = new URLSearchParams(location.search)
    const error = params.get('error')
    const code = params.get('code')
    const state = params.get('state')

    setHandledOAuthCallback(true)

    if (error) {
      toast.error(`OAuth failed: ${error}`)
      navigate('/integrations', { replace: true })
      return
    }
    if (!code || !state) {
      toast.error('OAuth callback is missing code or state')
      navigate('/integrations', { replace: true })
      return
    }
    oauthCallback.mutate({ code, state })
  }, [handledOAuthCallback, location.pathname, location.search, navigate, oauthCallback])

  const isOAuthCallbackScreen = location.pathname === '/integrations/oauth/callback'

  const providerCards = useMemo(() => ([
    {
      key: 'gmail',
      title: 'Gmail',
      description: 'Send and read emails through your connected account.',
      icon: <Mail className="h-5 w-5 text-blue-400" />,
      integration: gmailIntegration,
      health: providerHealth?.gmail,
      connecting: startGmailOAuth.isPending,
      onConnect: () => startGmailOAuth.mutate(),
    },
    {
      key: 'slack',
      title: 'Slack',
      description: 'Send updates and read workspace messages from connected Slack.',
      icon: <Slack className="h-5 w-5 text-emerald-400" />,
      integration: slackIntegration,
      health: providerHealth?.slack,
      connecting: startSlackOAuth.isPending,
      onConnect: () => startSlackOAuth.mutate(),
    },
  ]), [gmailIntegration, providerHealth?.gmail, providerHealth?.slack, slackIntegration, startGmailOAuth, startSlackOAuth])

  const IntegrationCard = ({ integration }: { integration: UserIntegration }) => (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-white">{integration.name}</div>
          <div className="mt-1 font-mono text-xs text-obsidian-500">
            {integration.integration_type}
            {integration.default_repo ? ` · ${integration.default_repo}` : ''}
          </div>
        </div>
        <span className={statusBadge(integration)}>{statusLabel(integration)}</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-obsidian-500">
          Last tested: {integration.last_tested_at ? new Date(integration.last_tested_at).toLocaleString() : 'Never'}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary px-3 text-xs" onClick={() => testIntegration.mutate(integration.id)}>
            <RefreshCw size={13} /> Test
          </button>
          <button className="btn-danger px-3 text-xs" onClick={() => deleteIntegration.mutate(integration.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )

  const OAuthCard = ({
    title,
    icon,
    description,
    integration,
    health,
    connecting,
    onConnect,
  }: {
    title: string
    icon: ReactNode
    description: string
    integration: UserIntegration | null
    health?: ProviderStatus
    connecting: boolean
    onConnect: () => void
  }) => (
    <GlowCard glowColor="blue" className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white">{title}</h2>
              {integration && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-obsidian-400">{description}</p>
            {integration ? (
              <p className="mt-2 text-xs font-medium text-white/80">
                {integration.connected_account || integration.name}
              </p>
            ) : (
              <p className="mt-2 text-xs text-obsidian-500">
                {health?.note || 'Not connected yet.'}
              </p>
            )}
          </div>
        </div>

        {!integration ? (
          <button className="btn-primary text-xs" onClick={onConnect} disabled={connecting}>
            {connecting ? 'Redirecting...' : `Connect ${title} →`}
          </button>
        ) : (
          <div className="flex gap-2">
            <button className="btn-secondary px-3 text-xs" onClick={() => testIntegration.mutate(integration.id)}>
              Test
            </button>
            <button className="btn-danger px-3 text-xs" onClick={() => deleteIntegration.mutate(integration.id)}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    </GlowCard>
  )

  if (isOAuthCallbackScreen) {
    return (
      <div className="grid min-h-[70vh] place-items-center p-6">
        <GlowCard glowColor="blue" className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/15">
            <RefreshCw size={20} className="animate-spin text-blue-400" />
          </div>
          <h1 className="text-xl font-semibold text-white">Completing connection</h1>
          <p className="mt-2 text-sm text-obsidian-400">
            Aethon is securely finishing your OAuth setup.
          </p>
        </GlowCard>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Integrations</h1>
          <p className="mt-2 text-sm text-obsidian-400">Connect real-world tools so agents can create deployable artifacts.</p>
        </div>
      </div>

      {/* Tool Health */}
      <GlowCard glowColor="blue" className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">Tool Health</h2>
            <p className="text-xs text-obsidian-500">Live status of provider backends used by agents.</p>
          </div>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => refetchHealth()}
            disabled={healthLoading}
          >
            <RefreshCw size={13} className={healthLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {healthLoading && !providerHealth ? (
          <div className="text-sm text-obsidian-500">Checking providers…</div>
        ) : providerHealth ? (
          <div className="space-y-3">
            {(Object.entries(providerHealth) as [keyof ProviderHealth, ProviderStatus][]).map(([key, ps]) => (
              <div key={key} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <span className={`mt-0.5 flex-shrink-0 ${providerTextColor(ps.status)}`}>
                  {PROVIDER_ICONS[key]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{PROVIDER_LABELS[key] ?? key}</span>
                    <span className="font-mono text-xs text-obsidian-600">{ps.provider}</span>
                    <span className="flex items-center gap-1.5 ml-auto">
                      <span className={`h-2 w-2 rounded-full ${providerDot(ps.status)}`} />
                      <span className={`text-xs font-medium ${providerTextColor(ps.status)}`}>
                        {providerLabel(ps.status)}
                      </span>
                    </span>
                  </div>
                  {ps.note && (
                    <p className="mt-0.5 text-xs text-obsidian-500 leading-snug">{ps.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </GlowCard>

      <div className="grid gap-5 xl:grid-cols-2">
        {providerCards.map(card => (
          <OAuthCard
            key={card.key}
            title={card.title}
            icon={card.icon}
            description={card.description}
            integration={card.integration}
            health={card.health}
            connecting={card.connecting}
            onConnect={card.onConnect}
          />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <GlowCard glowColor="indigo" className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-accent-300" />
              <div>
                <h2 className="font-semibold text-white">GitHub</h2>
                <p className="text-xs text-obsidian-500">Read repos, commit files, and open PRs.</p>
              </div>
            </div>
            <button className="btn-primary text-xs" onClick={() => setModal('github')}><Plus size={14} /> Add</button>
          </div>
          <div className="space-y-3">
            {github.map(item => <IntegrationCard key={item.id} integration={item} />)}
            {!github.length && !isLoading && <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-obsidian-500">No GitHub integration yet.</div>}
          </div>
        </GlowCard>

        <GlowCard glowColor="cyan" className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-cyan-300" />
              <div>
                <h2 className="font-semibold text-white">Email</h2>
                <p className="text-xs text-obsidian-500">Send replies and inspect recent mailbox context.</p>
              </div>
            </div>
            <button className="btn-primary text-xs" onClick={() => setModal('email')}><Plus size={14} /> Add</button>
          </div>
          <div className="space-y-3">
            {email.map(item => <IntegrationCard key={item.id} integration={item} />)}
            {!email.length && !isLoading && <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-obsidian-500">No email integration yet.</div>}
          </div>
        </GlowCard>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-obsidian-900 p-5 shadow-glow-md">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Add {modal === 'github' ? 'GitHub' : 'Email'} Integration</h2>
              <button className="btn-ghost p-2" onClick={() => setModal(null)}><X size={16} /></button>
            </div>

            {modal === 'github' ? (
              <form
                className="space-y-4"
                onSubmit={event => {
                  event.preventDefault()
                  createGitHub.mutate(githubForm)
                }}
              >
                <input className="input w-full" placeholder="Name" value={githubForm.name} onChange={e => setGithubForm({ ...githubForm, name: e.target.value })} />
                <input className="input w-full" type="password" placeholder="GitHub personal access token" value={githubForm.access_token} onChange={e => setGithubForm({ ...githubForm, access_token: e.target.value })} />
                <input className="input w-full" placeholder="Default repo, e.g. owner/repo" value={githubForm.default_repo} onChange={e => setGithubForm({ ...githubForm, default_repo: e.target.value })} />
                <button className="btn-primary w-full" disabled={createGitHub.isPending}>{createGitHub.isPending ? 'Connecting...' : 'Connect GitHub'}</button>
              </form>
            ) : (
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={event => {
                  event.preventDefault()
                  createEmail.mutate(emailForm)
                }}
              >
                <input className="input md:col-span-2" placeholder="Name" value={emailForm.name} onChange={e => setEmailForm({ ...emailForm, name: e.target.value })} />
                <input className="input" placeholder="SMTP host" value={emailForm.smtp_host} onChange={e => setEmailForm({ ...emailForm, smtp_host: e.target.value })} />
                <input className="input" type="number" placeholder="SMTP port" value={emailForm.smtp_port} onChange={e => setEmailForm({ ...emailForm, smtp_port: Number(e.target.value) })} />
                <input className="input" placeholder="SMTP user / email" value={emailForm.smtp_user} onChange={e => setEmailForm({ ...emailForm, smtp_user: e.target.value })} />
                <input className="input" type="password" placeholder="SMTP password" value={emailForm.smtp_password} onChange={e => setEmailForm({ ...emailForm, smtp_password: e.target.value })} />
                <input className="input" placeholder="IMAP host" value={emailForm.imap_host} onChange={e => setEmailForm({ ...emailForm, imap_host: e.target.value })} />
                <input className="input" type="number" placeholder="IMAP port" value={emailForm.imap_port} onChange={e => setEmailForm({ ...emailForm, imap_port: Number(e.target.value) })} />
                <input className="input md:col-span-2" placeholder="From name" value={emailForm.from_name} onChange={e => setEmailForm({ ...emailForm, from_name: e.target.value })} />
                <button className="btn-primary md:col-span-2" disabled={createEmail.isPending}>{createEmail.isPending ? 'Testing connection...' : 'Connect Email'}</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

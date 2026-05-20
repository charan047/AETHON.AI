import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Github, Loader2, Mail, Plus, RefreshCw, Search, Slack, Trash2, X } from 'lucide-react'
import { extractApiError, integrationsApi, toolsApi } from '../api/client'
import type { UserIntegration } from '../types'
import { FloatingField } from '../components/AuthShell'
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
  return 'text-[#8B9DBE]'
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

function providerStatusSummary(key: keyof ProviderHealth, status: ProviderStatus) {
  const label = PROVIDER_LABELS[key] ?? key
  if (key === 'search') {
    return `${label}: ${status.provider || 'Not configured'}`
  }
  if (status.status === 'healthy') {
    return `${label}: ${status.provider || 'Connected'}`
  }
  if (status.status === 'degraded') {
    return `${label}: Needs reconnect`
  }
  if (status.status === 'unavailable') {
    return `${label}: Unavailable`
  }
  return `${label}: Not configured`
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
          <div className="mt-1 font-mono text-xs text-ink-faint">
            {integration.integration_type}
            {integration.default_repo ? ` · ${integration.default_repo}` : ''}
          </div>
        </div>
        <span className={statusBadge(integration)}>{statusLabel(integration)}</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-ink-faint">
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
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 text-blue-300">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-white">{title}</h2>
              {integration && !integration.needs_reauth ? (
                <span className="badge-emerald">Connected</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-[#8B9DBE]">{description}</p>
            <p className="mt-3 text-xs text-[#4B5A73]">Required for: client delivery, outreach agents</p>
            {integration ? (
              <p className="mt-3 font-mono text-xs text-white/70">{integration.connected_account || integration.name}</p>
            ) : (
              <p className="mt-3 font-mono text-xs text-[#8B9DBE]">{health?.note || 'Not connected yet.'}</p>
            )}
          </div>
        </div>

        {!integration ? (
          <button className="btn-primary btn-runner btn-sm" onClick={onConnect} disabled={connecting}>
            {connecting ? <><Loader2 size={14} className="animate-spin" /> Connecting…</> : 'Connect'}
          </button>
        ) : integration.needs_reauth ? (
          <button className="btn-amber btn-sm" onClick={() => startGmailOAuth.mutate()} disabled={startGmailOAuth.isPending}>
            {startGmailOAuth.isPending ? <><Loader2 size={14} className="animate-spin" /> Connecting…</> : 'Reconnect'}
          </button>
        ) : (
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => testIntegration.mutate(integration.id)}>
              Test
            </button>
            <button className="btn-ghost btn-sm" onClick={() => deleteIntegration.mutate(integration.id)}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    </GlowCard>
  )

  const ManualProviderCard = ({
    title,
    icon,
    description,
    integrationsList,
    onAdd,
  }: {
    title: string
    icon: ReactNode
    description: string
    integrationsList: UserIntegration[]
    onAdd: () => void
  }) => {
    const primary = integrationsList[0] || null
    const connected = integrationsList.length > 0

    return (
      <GlowCard glowColor="blue" className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 text-blue-300">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold text-white">{title}</h2>
                {connected ? <span className="badge-emerald">Connected</span> : null}
              </div>
              <p className="mt-1 text-sm text-[#8B9DBE]">{description}</p>
              <p className="mt-3 text-xs text-[#4B5A73]">
                Required for: {title === 'GitHub' ? 'repo access, code agents' : 'email delivery, outreach agent'}
              </p>
              {primary ? (
                <p className="mt-3 font-mono text-xs text-white/70">
                  {primary.connected_account || primary.name}
                  {primary.default_repo ? ` · ${primary.default_repo}` : ''}
                </p>
              ) : null}
            </div>
          </div>

          <button className={connected ? 'btn-secondary btn-sm' : 'btn-primary btn-runner btn-sm'} onClick={onAdd}>
            {connected ? <><Plus size={14} /> Add</> : 'Connect'}
          </button>
        </div>

        {connected ? (
          <div className="mt-4 space-y-3">
            {integrationsList.map(item => (
              <IntegrationCard key={item.id} integration={item} />
            ))}
          </div>
        ) : null}
      </GlowCard>
    )
  }

  if (isOAuthCallbackScreen) {
    return (
      <div className="grid min-h-[70vh] place-items-center p-6">
        <GlowCard glowColor="blue" className="w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/15">
            <RefreshCw size={20} className="animate-spin text-blue-400" />
          </div>
          <h1 className="text-xl font-semibold text-white">Completing connection</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Aethon is securely finishing your OAuth setup.
          </p>
        </GlowCard>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div className="space-y-2">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-subtitle">Connect your tools</p>
        </div>
      </div>

      <GlowCard glowColor="blue" className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="section-title mb-0 border-0 pb-0">TOOL STATUS</div>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => refetchHealth()} disabled={healthLoading}>
            <RefreshCw size={13} className={healthLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {providerHealth ? (
          <div className="flex flex-wrap gap-3">
            {(Object.entries(providerHealth) as [keyof ProviderHealth, ProviderStatus][]).map(([key, status]) => (
              <div key={key} className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-white/80">
                <span className={`h-2 w-2 rounded-full ${providerDot(status.status)}`} />
                <span className={providerTextColor(status.status)}>{providerStatusSummary(key, status)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="font-mono text-xs text-[#8B9DBE]">Checking providers…</div>
        )}
      </GlowCard>

      {gmailIntegration?.needs_reauth ? (
        <GlowCard glowColor="amber" className="glass-card-amber flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-300" />
            <div className="text-sm text-amber-100">
              Gmail needs updated permissions for Google Docs
            </div>
          </div>
          <button className="btn-amber btn-sm" onClick={() => startGmailOAuth.mutate()} disabled={startGmailOAuth.isPending}>
            {startGmailOAuth.isPending ? <><Loader2 size={14} className="animate-spin" /> Reconnecting…</> : 'Reconnect Gmail →'}
          </button>
        </GlowCard>
      ) : null}

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
        <ManualProviderCard
          title="GitHub"
          icon={<Github className="h-5 w-5" />}
          description="Read repos, commit files, and open pull requests."
          integrationsList={github}
          onAdd={() => setModal('github')}
        />
        <ManualProviderCard
          title="Email"
          icon={<Mail className="h-5 w-5" />}
          description="Send replies and inspect mailbox context from your agency inbox."
          integrationsList={email}
          onAdd={() => setModal('email')}
        />
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="glass-elevated w-full max-w-xl p-5">
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
                <FloatingField label="Name" type="text" value={githubForm.name} onChange={value => setGithubForm({ ...githubForm, name: value })} required />
                <FloatingField label="GitHub personal access token" type="password" value={githubForm.access_token} onChange={value => setGithubForm({ ...githubForm, access_token: value })} required />
                <FloatingField label="Default repo (owner/repo)" type="text" value={githubForm.default_repo} onChange={value => setGithubForm({ ...githubForm, default_repo: value })} />
                <button className="btn-primary btn-runner w-full" disabled={createGitHub.isPending}>
                  {createGitHub.isPending ? <><Loader2 size={16} className="animate-spin" /> Connecting…</> : 'Connect GitHub'}
                </button>
              </form>
            ) : (
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={event => {
                  event.preventDefault()
                  createEmail.mutate(emailForm)
                }}
              >
                <div className="md:col-span-2">
                  <FloatingField label="Name" type="text" value={emailForm.name} onChange={value => setEmailForm({ ...emailForm, name: value })} required />
                </div>
                <FloatingField label="SMTP host" type="text" value={emailForm.smtp_host} onChange={value => setEmailForm({ ...emailForm, smtp_host: value })} required />
                <FloatingField label="SMTP port" type="number" value={String(emailForm.smtp_port)} onChange={value => setEmailForm({ ...emailForm, smtp_port: Number(value) || 0 })} required />
                <FloatingField label="SMTP user / email" type="text" value={emailForm.smtp_user} onChange={value => setEmailForm({ ...emailForm, smtp_user: value })} required />
                <FloatingField label="SMTP password" type="password" value={emailForm.smtp_password} onChange={value => setEmailForm({ ...emailForm, smtp_password: value })} required />
                <FloatingField label="IMAP host" type="text" value={emailForm.imap_host} onChange={value => setEmailForm({ ...emailForm, imap_host: value })} required />
                <FloatingField label="IMAP port" type="number" value={String(emailForm.imap_port)} onChange={value => setEmailForm({ ...emailForm, imap_port: Number(value) || 0 })} required />
                <div className="md:col-span-2">
                  <FloatingField label="From name" type="text" value={emailForm.from_name} onChange={value => setEmailForm({ ...emailForm, from_name: value })} />
                </div>
                <button className="btn-primary btn-runner md:col-span-2" disabled={createEmail.isPending}>
                  {createEmail.isPending ? <><Loader2 size={16} className="animate-spin" /> Connecting…</> : 'Connect Email'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

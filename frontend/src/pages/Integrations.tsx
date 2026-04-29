import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Github, Mail, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { integrationsApi } from '../api/client'
import type { UserIntegration } from '../types'
import { GlowCard } from '../components/ui/GlowCard'

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
  const [modal, setModal] = useState<ModalType>(null)
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

  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] })
  const github = integrations.filter(item => item.integration_type === 'github')
  const email = integrations.filter(item => item.integration_type === 'email_smtp')

  const createGitHub = useMutation({
    mutationFn: integrationsApi.createGitHub,
    onSuccess: () => {
      toast.success('GitHub connected')
      setModal(null)
      refresh()
    },
    onError: (error: any) => toast.error(error.response?.data?.detail || 'Failed to connect GitHub'),
  })

  const createEmail = useMutation({
    mutationFn: integrationsApi.createEmail,
    onSuccess: () => {
      toast.success('Email connected')
      setModal(null)
      refresh()
    },
    onError: (error: any) => toast.error(error.response?.data?.detail || 'Failed to connect email'),
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
      refresh()
    },
  })

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

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Integrations</h1>
          <p className="mt-2 text-sm text-obsidian-400">Connect real-world tools so agents can create deployable artifacts.</p>
        </div>
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

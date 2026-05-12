import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import { ArrowRight, CheckCircle2, Download, X } from 'lucide-react'
import { agentsApi, extractApiError, marketplaceApi } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import type { MarketplaceListing } from '../../types'

type InstallModalProps = {
  listing: MarketplaceListing | null
  open: boolean
  onClose: () => void
}

function targetPath(type: string, resourceId?: string | null) {
  if (type === 'agent') return resourceId ? `/agents?agent=${resourceId}` : '/agents'
  if (type === 'workflow') return resourceId ? `/workflows?workflow=${resourceId}` : '/workflows'
  if (type === 'tool_config') return resourceId ? `/tools?tool=${resourceId}` : '/tools'
  if (type === 'eval_suite') return '/evals'
  return '/'
}

function resourceLabel(type: string) {
  if (type === 'tool_config') return 'tool config'
  return type === 'eval_suite' ? 'eval suite' : type
}

export function InstallModal({ listing, open, onClose }: InstallModalProps) {
  const auth = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [installed, setInstalled] = useState<{ resource_id: string | null; type: string } | null>(null)
  const [agentId, setAgentId] = useState('')
  const [reinstall, setReinstall] = useState(false)

  useEffect(() => {
    setInstalled(null)
    setAgentId('')
    setReinstall(false)
  }, [listing?.id, open])

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', 'install-modal'],
    queryFn: agentsApi.list,
    enabled: open && auth.isAuthenticated && listing?.listing_type === 'eval_suite',
  })

  const install = useMutation({
    mutationFn: () => marketplaceApi.install(listing!.id, { agent_id: agentId || undefined, reinstall }),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['marketplace', 'installs'] })
      if (result.reinstalled) {
        toast.success('Fresh copy installed')
      } else {
        confetti({ particleCount: 60, spread: 50, origin: { y: 0.72 }, disableForReducedMotion: true })
        toast.success(listing?.listing_type === 'agent' ? 'Agent installed' : 'Installed successfully')
      }
      setInstalled({
        resource_id: result.resource_id ?? result.agent_id ?? result.workflow_id ?? null,
        type: result.type ?? 'agent',
      })
    },
    onError: error => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        toast.info(extractApiError(error))
        return
      }
      toast.error(extractApiError(error))
    },
  })

  if (!open || !listing) return null

  if (!auth.isAuthenticated) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-xl">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-obsidian-900 p-6 shadow-glow-lg">
          <button className="float-right rounded-lg p-1.5 text-obsidian-400 hover:bg-white/5 hover:text-white" onClick={onClose}><X size={18} /></button>
          <h2 className="text-xl font-semibold text-white">Sign in to install</h2>
          <p className="mt-3 text-sm leading-6 text-obsidian-400">Marketplace browsing is public, but installs need a company workspace.</p>
          <button
            className="btn-primary mt-6 w-full"
            onClick={() => navigate('/login', { state: { from: { pathname: `/marketplace/${listing.slug}` } } })}
          >
            Sign in and continue <ArrowRight size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-xl">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-obsidian-900 shadow-glow-lg">
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent-300">Marketplace install</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Installing: {listing.name}</h2>
          </div>
          <button className="rounded-lg p-1.5 text-obsidian-400 hover:bg-white/5 hover:text-white" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-5 p-5">
          {installed ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5 text-center">
              <CheckCircle2 className="mx-auto text-emerald-300" size={38} />
              <h3 className="mt-3 text-lg font-semibold text-white">Installed!</h3>
              <p className="mt-2 text-sm text-emerald-100/80">Your new {resourceLabel(installed.type)} is ready.</p>
              <Link className="btn-primary mt-5" to={targetPath(installed.type, installed.resource_id)}>
                View in {installed.type === 'agent' ? 'My Team' : installed.type === 'workflow' ? 'Workflows' : installed.type === 'tool_config' ? 'Tools' : 'Eval Lab'}
              </Link>
              <button className="btn-ghost mt-3 w-full justify-center" onClick={onClose}>
                Install another
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-obsidian-300">
                A new <span className="font-medium text-white">{resourceLabel(listing.listing_type)}</span> named{' '}
                <span className="font-medium text-white">{listing.template_data?.name as string || listing.name}</span>{' '}
                will be added to your company.
                {listing.listing_type === 'workflow' && (
                  <p className="mt-3 text-amber-200">Note: you’ll need to assign your own agents to workflow nodes after installation.</p>
                )}
              </div>

              {listing.listing_type === 'eval_suite' && (
                <div>
                  <label className="label">Target agent</label>
                  <select className="input" value={agentId} onChange={event => setAgentId(event.target.value)}>
                    <option value="">Choose an agent for this eval suite</option>
                    {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
                  </select>
                </div>
              )}

              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-obsidian-300">
                Create a fresh copy if already installed
                <input type="checkbox" className="accent-accent-500" checked={reinstall} onChange={event => setReinstall(event.target.checked)} />
              </label>
              <button
                className="btn-primary h-12 w-full"
                disabled={install.isPending || (listing.listing_type === 'eval_suite' && !agentId)}
                onClick={() => install.mutate()}
              >
                <Download size={16} />
                {install.isPending ? 'Installing...' : 'Install Now'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

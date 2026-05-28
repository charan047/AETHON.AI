import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Download, Play, X } from 'lucide-react'
import { agentsApi, extractApiError, marketplaceApi } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { ShimmerButton } from '../ui/magicui/ShimmerButton'
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
        <div className="glass-elevated w-full max-w-md rounded-3xl p-6">
          <button className="float-right rounded-lg p-1.5 text-ink-muted hover:bg-white/5 hover:text-white" onClick={onClose}><X size={18} /></button>
          <h2 className="text-xl font-semibold text-white">Sign in to install</h2>
          <p className="mt-3 text-sm leading-6 text-ink-muted">Marketplace browsing is public, but installs need a company workspace.</p>
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
    <AnimatePresence>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 10 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="glass-elevated w-full max-w-lg overflow-hidden rounded-[28px]"
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] p-5">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-indigo-300">Marketplace install</p>
              <h2 className="mt-1 text-xl font-semibold text-white">{installed ? 'Agent installed' : `Installing: ${listing.name}`}</h2>
            </div>
            <button className="rounded-lg p-1.5 text-ink-muted hover:bg-white/5 hover:text-white" onClick={onClose}><X size={18} /></button>
          </div>

          <div className="space-y-5 p-5">
            {installed ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 18 }}
                  className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border border-emerald-400/30 bg-emerald-400/12 text-emerald-300"
                >
                  <CheckCircle2 size={34} />
                </motion.div>
                <h3 className="text-2xl font-semibold text-white">Agent installed</h3>
                <p className="mt-2 text-sm text-[#8B9DBE]">Your new {resourceLabel(installed.type)} is ready. Here are the fastest next steps.</p>

                <div className="mt-6 space-y-3 text-left">
                  {[
                    `Open it in ${installed.type === 'agent' ? 'Agents' : installed.type === 'workflow' ? 'Processes' : installed.type === 'tool_config' ? 'Tools' : 'Evaluations'}.`,
                    installed.type === 'workflow' ? 'Assign your own agents and variables before the first run.' : 'Review the installed configuration and personalize it for your agency.',
                    'Run it now to verify everything is wired correctly.',
                  ].map((step, index) => (
                    <div key={step} className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
                      <div className="mt-0.5 grid h-6 w-6 place-items-center rounded-full bg-indigo-500/15 font-mono text-xs text-indigo-300">
                        {index + 1}
                      </div>
                      <div className="text-sm text-[#D7E0EF]">{step}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Link className="btn-primary btn-runner h-11 justify-center" to={targetPath(installed.type, installed.resource_id)}>
                    <ArrowRight size={16} /> Go to Agents
                  </Link>
                  <Link className="btn-emerald h-11 justify-center" to={targetPath(installed.type, installed.resource_id)}>
                    <Play size={16} /> Run it now
                  </Link>
                </div>
                <button className="btn-ghost mt-3 w-full justify-center" onClick={onClose}>
                  Install another
                </button>
              </motion.div>
            ) : (
              <>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-6 text-[#D7E0EF]">
                  A new <span className="font-medium text-white">{resourceLabel(listing.listing_type)}</span> named{' '}
                  <span className="font-medium text-white">{listing.template_data?.name as string || listing.name}</span>{' '}
                  will be added to your company.
                  {listing.listing_type === 'workflow' && (
                    <p className="mt-3 text-amber-200">You’ll need to assign your own agents to workflow nodes after installation.</p>
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

                <label className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-sm text-[#8B9DBE]">
                  Create a fresh copy if already installed
                  <input type="checkbox" className="indigo-indigo-500" checked={reinstall} onChange={event => setReinstall(event.target.checked)} />
                </label>
                <ShimmerButton
                  className="h-12 w-full justify-center rounded-xl px-6 text-sm font-semibold"
                  background="rgba(79,70,229,1)"
                  disabled={install.isPending || (listing.listing_type === 'eval_suite' && !agentId)}
                  onClick={() => install.mutate()}
                >
                  <Download size={16} />
                  {install.isPending ? 'Installing...' : 'Install Now'}
                </ShimmerButton>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

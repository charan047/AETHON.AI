import { X, Lock, Sparkles, ArrowRight } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { billingApi } from '../../api/client'
import type { OrgPlan } from '../../types'

type UpgradeModalProps = {
  open: boolean
  onClose: () => void
  resource?: string
  message?: string
  currentPlan?: OrgPlan
}

const FEATURE_LABELS: Record<string, string> = {
  agents: 'more AI team members',
  workflows: 'more workflows',
  executions: 'more monthly runs',
  custom_tools: 'more custom tools',
  integrations: 'more integrations',
  eval_suites: 'more eval suites',
  eval_cases_per_suite: 'larger eval suites',
  memory_enabled: 'persistent memory',
  parallel_execution: 'parallel execution',
  webhooks: 'webhook triggers',
  scheduling: 'scheduled workflows',
  version_history: 'workflow history',
  api_keys: 'API keys',
}

const TARGET_PLAN: Record<string, OrgPlan> = {
  members: 'team',
  default: 'solo',
}

function titleFor(resource?: string) {
  return `Upgrade to unlock ${FEATURE_LABELS[resource || ''] || 'this feature'}`
}

export function UpgradeModal({ open, onClose, resource, message, currentPlan = 'free' }: UpgradeModalProps) {
  const targetPlan = TARGET_PLAN[resource || ''] || TARGET_PLAN.default
  const price = targetPlan === 'team' ? '$99/month' : '$29/month'
  const mutation = useMutation({
    mutationFn: () => billingApi.upgrade(targetPlan),
    onSuccess: data => {
      toast.success(data.message || "Upgrade requested! You'll hear back within 24 hours.")
      onClose()
    },
    onError: () => toast.error('Could not request upgrade. Please try again.'),
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-xl">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-obsidian-900 shadow-glow-lg">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-accent-500/20 to-transparent" />
        <button
          className="absolute right-4 top-4 rounded-lg p-2 text-obsidian-400 transition hover:bg-white/5 hover:text-white"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="relative p-6">
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/15 text-accent-200 shadow-glow-sm">
            <Lock size={20} />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">{titleFor(resource)}</h2>
          <p className="mt-3 text-sm leading-6 text-obsidian-300">
            {message || 'This action is outside your current plan. Upgrade when you are ready to scale.'}
          </p>

          <div className="mt-6 grid gap-3 rounded-xl border border-white/10 bg-obsidian-950/70 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-obsidian-400">Current plan</span>
              <span className="badge-gray capitalize">{currentPlan}</span>
            </div>
            <div className="h-px bg-white/10" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-obsidian-400">Recommended upgrade</span>
              <span className="badge-purple capitalize">{targetPlan}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-obsidian-400">Price</span>
              <span className="font-mono text-sm font-semibold text-white">{price}</span>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-100">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Sparkles size={16} /> What changes
            </div>
            <p className="text-cyan-100/80">
              Your current plan keeps the product lean. The upgrade unlocks the blocked capability without changing your existing agents, workflows, or data.
            </p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              className="btn-primary flex-1"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Requesting...' : `Upgrade to ${targetPlan}`}
              <ArrowRight size={16} />
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

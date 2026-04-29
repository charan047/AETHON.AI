import { CheckCircle2, CreditCard, Lock, Sparkles, Zap } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { billingApi } from '../api/client'
import { GlowCard } from '../components/ui/GlowCard'
import { Skeleton } from '../components/ui/Skeleton'
import type { BillingPlan, BillingUsageSummary, OrgPlan, PlanUsageItem } from '../types'

const RESOURCE_LABELS: Record<string, string> = {
  members: 'Seats',
  agents: 'Agents',
  workflows: 'Workflows',
  executions: 'Monthly executions',
  custom_tools: 'Custom tools',
  integrations: 'Integrations',
  api_keys: 'API keys',
  webhooks: 'Webhook endpoints',
  eval_suites: 'Eval suites',
  monthly_budget: 'Monthly AI budget',
}

const FEATURE_LABELS: Record<string, string> = {
  memory_enabled: 'Persistent memory',
  parallel_execution: 'Parallel execution',
  webhooks: 'Webhook triggers',
  scheduling: 'Scheduled workflows',
  version_history: 'Workflow version history',
  api_keys: 'API keys',
}

function formatLimit(value: number) {
  if (value >= 999999) return 'Unlimited'
  return value.toLocaleString()
}

function UsageBar({ label, item }: { label: string; item: PlanUsageItem }) {
  const color = item.percent >= 100 ? 'bg-red-400' : item.percent >= 85 ? 'bg-amber-400' : item.percent >= 60 ? 'bg-cyan-400' : 'bg-emerald-400'
  return (
    <div className={clsx('rounded-xl border border-white/10 bg-white/[0.025] p-4', item.percent >= 100 && 'shadow-glow-red')}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="mt-1 font-mono text-xs text-obsidian-500">
            {Number(item.used).toLocaleString()} of {formatLimit(Number(item.limit))} used
          </p>
        </div>
        <span className={clsx('font-mono text-sm font-semibold', item.percent >= 100 ? 'text-red-300' : item.percent >= 85 ? 'text-amber-300' : 'text-obsidian-300')}>
          {item.limit >= 999999 ? '∞' : `${item.percent}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-obsidian-800">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(item.percent, 100)}%` }} />
      </div>
    </div>
  )
}

function PlanCard({ plan, current, onUpgrade, loading }: {
  plan: BillingPlan
  current?: OrgPlan
  onUpgrade: (plan: OrgPlan) => void
  loading: boolean
}) {
  const isCurrent = current === plan.plan
  return (
    <div className={clsx('rounded-2xl border p-5 transition', isCurrent ? 'border-accent-400/40 bg-accent-500/10 shadow-glow-sm' : 'border-white/10 bg-obsidian-900')}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
          <p className="mt-1 font-mono text-sm text-obsidian-400">
            {plan.monthly_usd === null ? 'Custom' : `$${plan.monthly_usd}/mo`}
          </p>
        </div>
        {isCurrent && <span className="badge-purple">Current</span>}
      </div>
      <div className="mt-4 space-y-2 text-sm text-obsidian-300">
        <p>{formatLimit(Number(plan.limits.max_agents))} agents</p>
        <p>{formatLimit(Number(plan.limits.max_workflows))} workflows</p>
        <p>{formatLimit(Number(plan.limits.max_monthly_executions))} monthly executions</p>
      </div>
      <button
        className={clsx('mt-5 w-full', isCurrent ? 'btn-secondary' : 'btn-primary')}
        disabled={isCurrent || loading}
        onClick={() => onUpgrade(plan.plan)}
      >
        {isCurrent ? 'Active plan' : 'Request upgrade'}
      </button>
    </div>
  )
}

export function Billing() {
  const { data: planData, isLoading: loadingPlan, refetch } = useQuery({
    queryKey: ['billing', 'plan'],
    queryFn: billingApi.plan,
  })
  const { data: plans = [] } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: billingApi.plans,
  })
  const upgrade = useMutation({
    mutationFn: (targetPlan: OrgPlan) => billingApi.upgrade(targetPlan),
    onSuccess: data => {
      toast.success(data.message)
      refetch()
    },
    onError: () => toast.error('Upgrade request failed. Please try again.'),
  })

  const usage = planData?.usage as BillingUsageSummary | undefined
  const resourceEntries = usage
    ? Object.entries(RESOURCE_LABELS).filter(([key]) => usage[key as keyof BillingUsageSummary])
    : []
  const lockedFeatures = usage
    ? Object.entries(usage.features).filter(([, value]) => !value.allowed)
    : []
  const availableFeatures = usage
    ? Object.entries(usage.features).filter(([, value]) => value.allowed)
    : []

  return (
    <div className="min-h-full overflow-y-auto bg-obsidian-950 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-accent-300">Monetization foundation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Billing</h1>
            <p className="mt-2 text-sm text-obsidian-400">
              Plan limits, usage, and upgrade paths for your organization.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 font-mono text-xs text-obsidian-300">
            {planData?.organization.name || 'Organization'}
          </div>
        </div>

        {loadingPlan ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl lg:col-span-2" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <GlowCard glowColor="indigo" active>
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent-500/15 text-accent-200">
                  <CreditCard size={20} />
                </div>
                <div>
                  <p className="text-sm text-obsidian-400">Current plan</p>
                  <h2 className="text-2xl font-semibold capitalize text-white">{planData?.organization.plan || 'free'}</h2>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-obsidian-400">
                Limits are enforced before resource creation, so your team never accidentally exceeds the plan.
              </p>
            </GlowCard>

            <GlowCard glowColor="cyan" hoverable>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-obsidian-400">Usage health</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">
                    {usage ? Math.max(...resourceEntries.map(([key]) => (usage[key as keyof BillingUsageSummary] as PlanUsageItem).percent)).toFixed(0) : 0}% peak usage
                  </h2>
                </div>
                <Zap className="text-cyan-300" size={22} />
              </div>
              <p className="mt-5 text-sm leading-6 text-obsidian-400">
                Resources at 100% will trigger the upgrade modal instead of silently failing.
              </p>
            </GlowCard>

            <GlowCard glowColor="amber" hoverable>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-obsidian-400">Locked features</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">{lockedFeatures.length}</h2>
                </div>
                <Lock className="text-amber-300" size={22} />
              </div>
              <p className="mt-5 text-sm leading-6 text-obsidian-400">
                Locked features show clear upgrade guidance without dark patterns.
              </p>
            </GlowCard>
          </div>
        )}

        {usage && (
          <section className="card p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Usage</h2>
                <p className="mt-1 text-sm text-obsidian-400">Current usage against your plan limits.</p>
              </div>
              <Sparkles className="text-accent-300" size={20} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {resourceEntries.map(([key, label]) => (
                <UsageBar key={key} label={label} item={usage[key as keyof BillingUsageSummary] as PlanUsageItem} />
              ))}
            </div>
          </section>
        )}

        {usage && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="text-lg font-semibold text-white">Available features</h2>
              <div className="mt-4 space-y-2">
                {availableFeatures.map(([feature]) => (
                  <div key={feature} className="flex items-center gap-3 rounded-xl border border-emerald-400/10 bg-emerald-400/5 p-3 text-sm text-emerald-200">
                    <CheckCircle2 size={16} /> {FEATURE_LABELS[feature] || feature}
                  </div>
                ))}
                {availableFeatures.length === 0 && <p className="text-sm text-obsidian-500">No premium features unlocked yet.</p>}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-lg font-semibold text-white">Locked features</h2>
              <div className="mt-4 space-y-2">
                {lockedFeatures.map(([feature, detail]) => (
                  <div key={feature} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-sm">
                    <span className="flex items-center gap-3 text-obsidian-300"><Lock size={16} /> {FEATURE_LABELS[feature] || feature}</span>
                    <span className="badge-gray">Unlocks on {detail.upgrade_to}</span>
                  </div>
                ))}
                {lockedFeatures.length === 0 && <p className="text-sm text-obsidian-500">Everything is unlocked on this plan.</p>}
              </div>
            </div>
          </section>
        )}

        <section className="card p-5">
          <h2 className="text-lg font-semibold text-white">Plans</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {plans.map(plan => (
              <PlanCard
                key={plan.plan}
                plan={plan}
                current={planData?.organization.plan}
                loading={upgrade.isPending}
                onUpgrade={targetPlan => upgrade.mutate(targetPlan)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

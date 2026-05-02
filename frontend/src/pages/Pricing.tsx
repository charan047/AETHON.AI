import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useNavigate } from 'react-router-dom'
import { billingApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { BILLING_PLAN_ORDER, PLAN_META, planPrice, type BillingCadence } from '../components/billing/planMeta'
import type { OrgPlan } from '../types'

const FAQS = [
  ['Can I change plans anytime?', 'Yes. Upgrades apply immediately and downgrades take effect at the end of the current billing period.'],
  ['What happens when I hit my execution limit?', "We'll notify you before you hit it, and you can upgrade before anything important gets interrupted."],
  ['Is there a free trial?', 'Yes. Every paid plan comes with a 14-day trial.'],
  ['What counts as an execution?', 'One complete workflow run counts as a single execution.'],
  ['Can I cancel anytime?', 'Yes. No questions asked.'],
  ['Do you offer refunds?', 'Yes. We offer refunds within 7 days of any charge.'],
] as const

const COMPARISON_ROWS = [
  { label: 'Agents', key: 'max_agents' },
  { label: 'Workflows', key: 'max_workflows' },
  { label: 'Monthly executions', key: 'max_monthly_executions' },
  { label: 'Memory', feature: 'memory_enabled' },
  { label: 'Parallel execution', feature: 'parallel_execution' },
  { label: 'Scheduling', feature: 'scheduling' },
  { label: 'Webhooks', feature: 'webhooks' },
  { label: 'API keys', feature: 'api_keys' },
] as const

function formatLimit(value: string | number | boolean | undefined) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && value >= 999999) return 'Unlimited'
  return String(value ?? '—')
}

export function Pricing() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [cadence, setCadence] = useState<BillingCadence>('monthly')
  const [showComparison, setShowComparison] = useState(false)
  const { data } = useQuery({
    queryKey: ['billing', 'plans', 'public'],
    queryFn: billingApi.plans,
  })

  const plans = useMemo(
    () => BILLING_PLAN_ORDER.filter(plan => plan !== 'enterprise').map(plan => ({
      ...PLAN_META[plan],
      backend: data?.plans.find(item => item.plan === plan),
    })),
    [data],
  )

  const handleCta = (plan: OrgPlan) => {
    if (!isAuthenticated) {
      navigate('/register')
      return
    }
    if (plan === 'free') {
      navigate('/settings/billing')
      return
    }
    navigate(`/settings/billing?plan=${plan}`)
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_35%),linear-gradient(180deg,#080910_0%,#0b0d13_100%)] text-white">
      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyan-300">Pricing</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight">Simple, transparent pricing</h1>
          <p className="mt-4 text-lg leading-8 text-obsidian-300">
            Start free. Scale as your AI company grows.
          </p>

          <div className="mt-8 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
            {(['monthly', 'annual'] as BillingCadence[]).map(option => (
              <button
                key={option}
                className={clsx(
                  'rounded-full px-5 py-2 text-sm transition',
                  cadence === option ? 'bg-white text-obsidian-950' : 'text-obsidian-300 hover:text-white',
                )}
                onClick={() => setCadence(option)}
              >
                {option === 'monthly' ? 'Monthly' : 'Annual'}
                {option === 'annual' && <span className="ml-2 text-xs font-semibold text-emerald-600">2 months free</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-5 xl:grid-cols-4">
          {plans.map(plan => (
            <section
              key={plan.plan}
              className={clsx(
                'relative overflow-hidden rounded-[30px] border p-6',
                plan.highlighted
                  ? 'translate-y-[-8px] border-accent-400/35 bg-gradient-to-br from-accent-500/25 via-accent-500/12 to-cyan-500/10 shadow-glow-lg'
                  : 'border-white/10 bg-white/[0.03]',
              )}
            >
              {plan.badge && (
                <div className={clsx(
                  'mb-5 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                  plan.highlighted ? 'bg-white/15 text-white' : 'bg-cyan-400/10 text-cyan-200',
                )}>
                  {plan.badge}
                </div>
              )}
              <h2 className="text-2xl font-semibold">{plan.label}</h2>
              <p className="mt-2 text-sm text-obsidian-300">{plan.tagline}</p>

              <div className="mt-8 flex items-end gap-2">
                <div className="text-5xl font-semibold">
                  {plan.plan === 'free' ? '$0' : `$${planPrice(plan.plan, cadence)}`}
                </div>
                <div className={clsx('pb-1 text-sm', plan.highlighted ? 'text-white/70' : 'text-obsidian-400')}>
                  / month
                </div>
              </div>
              {cadence === 'annual' && plan.plan !== 'free' && (
                <p className="mt-2 text-sm text-emerald-300">Billed annually. Effective monthly price shown.</p>
              )}

              <p className={clsx('mt-5 text-sm leading-7', plan.highlighted ? 'text-white/80' : 'text-obsidian-400')}>
                {plan.subtitle}
              </p>

              <div className="mt-6 space-y-2 text-sm">
                {plan.limits.map(limit => (
                  <div key={limit} className={clsx('rounded-xl border px-3 py-2', plan.highlighted ? 'border-white/10 bg-white/5' : 'border-white/10 bg-black/20')}>
                    {limit}
                  </div>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                {plan.features.map(feature => (
                  <div key={feature.label} className="flex items-center gap-3 text-sm">
                    {feature.included ? <Check size={16} className="text-emerald-300" /> : <X size={16} className="text-obsidian-500" />}
                    <span className={feature.included ? 'text-obsidian-100' : 'text-obsidian-500'}>{feature.label}</span>
                  </div>
                ))}
              </div>

              <button
                className={clsx(
                  'mt-8 w-full',
                  plan.plan === 'free'
                    ? 'btn-secondary'
                    : plan.highlighted
                      ? 'rounded-xl bg-white px-4 py-3 text-sm font-semibold text-obsidian-950 transition hover:bg-obsidian-100'
                      : 'btn-primary',
                )}
                onClick={() => handleCta(plan.plan)}
              >
                {plan.cta}
              </button>
            </section>
          ))}
        </div>

        <div className="mt-10">
          <button className="inline-flex items-center gap-2 text-sm text-accent-300 transition hover:text-accent-200" onClick={() => setShowComparison(value => !value)}>
            {showComparison ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            See full comparison
          </button>

          {showComparison && (
            <div className="mt-5 overflow-x-auto rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-obsidian-400">
                    <th className="pb-3 pr-4 font-medium">Feature</th>
                    {plans.map(plan => (
                      <th key={plan.plan} className="pb-3 pr-4 font-medium text-white">{plan.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map(row => (
                    <tr key={row.label} className="border-b border-white/[0.06] last:border-b-0">
                      <td className="py-4 pr-4 text-obsidian-200">{row.label}</td>
                      {plans.map(plan => (
                        <td key={plan.plan} className="py-4 pr-4 text-obsidian-300">
                          {'key' in row
                            ? formatLimit(plan.backend?.limits[row.key] as string | number | boolean | undefined)
                            : (plan.backend?.features[row.feature] ? 'Yes' : 'No')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <section className="mt-16 grid gap-6 lg:grid-cols-2">
          {FAQS.map(([question, answer]) => (
            <div key={question} className="rounded-[26px] border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-lg font-semibold">{question}</h3>
              <p className="mt-3 text-sm leading-7 text-obsidian-400">{answer}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

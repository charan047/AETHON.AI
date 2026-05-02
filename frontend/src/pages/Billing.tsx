import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { differenceInCalendarDays, format, getDaysInMonth } from 'date-fns'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, CreditCard, ReceiptText, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useSearchParams } from 'react-router-dom'
import { billingApi } from '../api/client'
import { UpgradeFlow } from '../components/billing/UpgradeFlow'
import { PaymentMethodModal } from '../components/billing/PaymentMethodModal'
import { PLAN_META } from '../components/billing/planMeta'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Skeleton } from '../components/ui/Skeleton'
import { toast } from '../lib/toast'
import type { BillingPaymentMethod, BillingUpcomingInvoiceLineItem, BillingUsageSummary, OrgPlan, PlanUsageItem } from '../types'

const RESOURCE_LABELS: Record<string, string> = {
  members: 'Seats',
  agents: 'Agents',
  workflows: 'Workflows',
  executions: 'Executions',
  custom_tools: 'Custom tools',
  integrations: 'Integrations',
  api_keys: 'API keys',
  webhooks: 'Webhook endpoints',
  eval_suites: 'Eval suites',
  monthly_budget: 'AI budget',
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return format(new Date(value), 'MMM d, yyyy')
}

function progressTone(percent: number) {
  if (percent > 100) return 'bg-red-400'
  if (percent >= 80) return 'bg-amber-400'
  if (percent >= 60) return 'bg-cyan-400'
  return 'bg-emerald-400'
}

function UsageRow({ label, item }: { label: string; item: PlanUsageItem }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="mt-1 text-xs text-obsidian-400">
            {Number(item.used).toLocaleString()} of {item.limit >= 999999 ? 'Unlimited' : Number(item.limit).toLocaleString()} used
          </div>
        </div>
        <div className={clsx(
          'text-sm font-semibold',
          item.percent > 100 ? 'text-red-300' : item.percent >= 80 ? 'text-amber-300' : 'text-obsidian-200',
        )}>
          {item.limit >= 999999 ? '∞' : `${item.percent}%`}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-obsidian-800">
        <div className={clsx('h-full rounded-full transition-all', progressTone(item.percent))} style={{ width: `${Math.min(item.percent, 100)}%` }} />
      </div>
    </div>
  )
}

function InvoiceDetails({ lineItems }: { lineItems: BillingUpcomingInvoiceLineItem[] }) {
  if (!lineItems.length) return <p className="text-sm text-obsidian-500">No upcoming line items yet.</p>
  return (
    <div className="space-y-3">
      {lineItems.map((item, index) => (
        <div key={`${item.description}-${index}`} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm text-white">{item.description || 'Usage charge'}</div>
            <div className="mt-1 text-xs text-obsidian-400">Quantity: {item.quantity ?? 1}</div>
          </div>
          <div className="text-sm font-medium text-obsidian-200">{formatCurrency(item.amount)}</div>
        </div>
      ))}
    </div>
  )
}

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showUpgradeFlow, setShowUpgradeFlow] = useState(false)
  const [showInvoiceDetails, setShowInvoiceDetails] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)

  const selectedPlan = (searchParams.get('plan') as OrgPlan | null) || null

  const subscriptionQuery = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: billingApi.subscription,
  })
  const plansQuery = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: billingApi.plans,
  })
  const paymentMethodsQuery = useQuery({
    queryKey: ['billing', 'payment-methods'],
    queryFn: billingApi.paymentMethods,
  })
  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: billingApi.invoices,
  })
  const upcomingInvoiceQuery = useQuery({
    queryKey: ['billing', 'upcoming-invoice'],
    queryFn: billingApi.upcomingInvoice,
  })

  const refreshBilling = async () => {
    await Promise.all([
      subscriptionQuery.refetch(),
      paymentMethodsQuery.refetch(),
      invoicesQuery.refetch(),
      upcomingInvoiceQuery.refetch(),
      plansQuery.refetch(),
    ])
  }

  const setDefaultMutation = useMutation({
    mutationFn: billingApi.setDefaultPaymentMethod,
    onSuccess: async () => {
      toast.success('Default payment method updated.')
      await paymentMethodsQuery.refetch()
    },
    onError: () => toast.error('Could not update the default payment method.'),
  })

  const deleteMethodMutation = useMutation({
    mutationFn: billingApi.deletePaymentMethod,
    onSuccess: async () => {
      toast.success('Payment method removed.')
      await paymentMethodsQuery.refetch()
    },
    onError: () => toast.error('Could not remove this payment method.'),
  })

  const cancelMutation = useMutation({
    mutationFn: () => billingApi.cancel(false),
    onSuccess: async () => {
      toast.success('Subscription will cancel at period end.')
      setShowCancelDialog(false)
      await subscriptionQuery.refetch()
    },
    onError: () => toast.error('Could not schedule cancellation.'),
  })

  const subscription = subscriptionQuery.data?.subscription || null
  const usage = subscriptionQuery.data?.usage as BillingUsageSummary | undefined
  const currentPlan = (subscriptionQuery.data?.organization.plan || 'free') as OrgPlan
  const paymentMethods = paymentMethodsQuery.data || []
  const defaultPaymentMethod = paymentMethods.find(method => method.is_default) || paymentMethods[0] || null
  const upcomingInvoice = upcomingInvoiceQuery.data
  const invoices = invoicesQuery.data || []
  const publishableKey = plansQuery.data?.publishable_key || ''
  const plans = plansQuery.data?.plans || []

  const trialDays = subscription?.trial_end ? Math.max(differenceInCalendarDays(new Date(subscription.trial_end), new Date()), 0) : null
  const executionUsage = usage?.executions
  const projectedExecutionUsage = useMemo(() => {
    if (!executionUsage) return null
    const today = new Date()
    const projected = Math.round((Number(executionUsage.used) / Math.max(today.getDate(), 1)) * getDaysInMonth(today))
    return projected
  }, [executionUsage])

  const statusMeta = useMemo(() => {
    if (!subscription) {
      return { label: 'Free plan', tone: 'gray', banner: null as null | { tone: 'amber' | 'red'; text: string; action: string } }
    }
    if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
      return {
        label: 'Payment failed',
        tone: 'red',
        banner: { tone: 'red', text: 'Your last payment failed. Update your payment method.', action: 'Update Payment Method' },
      }
    }
    if (subscription.cancel_at_period_end && subscription.current_period_end) {
      return {
        label: `Cancels on ${formatDate(subscription.current_period_end)}`,
        tone: 'gray',
        banner: null,
      }
    }
    if (subscription.status === 'trialing' && subscription.trial_end) {
      return {
        label: `Trial ends in ${trialDays} day${trialDays === 1 ? '' : 's'}`,
        tone: 'amber',
        banner: { tone: 'amber', text: 'Add payment method to continue after trial.', action: 'Add Payment Method' },
      }
    }
    return { label: 'Active', tone: 'green', banner: null }
  }, [subscription, trialDays])

  const openUpgrade = () => {
    setShowUpgradeFlow(true)
    if (!searchParams.get('plan')) return
    const next = new URLSearchParams(searchParams)
    next.delete('plan')
    setSearchParams(next, { replace: true })
  }

  const usageRows = usage
    ? Object.entries(RESOURCE_LABELS).map(([key, label]) => [label, usage[key as keyof BillingUsageSummary] as PlanUsageItem] as const)
    : []

  return (
    <div className="min-h-full bg-obsidian-950 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-accent-300">Revenue infrastructure</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Billing</h1>
            <p className="mt-2 text-sm text-obsidian-400">
              Plans, payment methods, invoices, and usage for your AI company.
            </p>
          </div>
          <button className="btn-secondary" onClick={openUpgrade}>
            Change Plan
          </button>
        </div>

        {subscriptionQuery.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr]">
            <Skeleton className="h-72 rounded-[28px]" />
            <Skeleton className="h-72 rounded-[28px]" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr]">
            <section className="rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-6 shadow-glow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-obsidian-400">Current plan</p>
                  <div className="mt-2 flex items-center gap-3">
                    <h2 className="text-3xl font-semibold text-white">{PLAN_META[currentPlan]?.label || currentPlan}</h2>
                    <span className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                      statusMeta.tone === 'green' && 'bg-emerald-400/15 text-emerald-200',
                      statusMeta.tone === 'amber' && 'bg-amber-400/15 text-amber-200',
                      statusMeta.tone === 'red' && 'bg-red-400/15 text-red-200',
                      statusMeta.tone === 'gray' && 'bg-white/10 text-obsidian-300',
                    )}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-obsidian-400">
                    {PLAN_META[currentPlan]?.subtitle || 'Your billing configuration lives here.'}
                  </p>
                </div>
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-500/15 text-accent-200">
                  <CreditCard size={20} />
                </div>
              </div>

              {statusMeta.banner && (
                <div className={clsx(
                  'mt-5 rounded-2xl border p-4 text-sm',
                  statusMeta.banner.tone === 'red'
                    ? 'border-red-400/20 bg-red-500/10 text-red-100'
                    : 'border-amber-400/20 bg-amber-500/10 text-amber-100',
                )}>
                  <div className="flex items-start justify-between gap-4">
                    <p>{statusMeta.banner.text}</p>
                    <button className="btn-secondary whitespace-nowrap" onClick={() => setShowPaymentModal(true)}>
                      {statusMeta.banner.action}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
                <button className="text-accent-300 transition hover:text-accent-200" onClick={openUpgrade}>
                  Change Plan
                </button>
                {currentPlan !== 'free' && (
                  <button className="text-obsidian-400 transition hover:text-red-200" onClick={() => setShowCancelDialog(true)}>
                    Cancel Subscription
                  </button>
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                  <Sparkles size={18} />
                </div>
                <div>
                  <p className="text-sm text-obsidian-400">Usage this period</p>
                  <h2 className="text-xl font-semibold text-white">Current runway vs plan limits</h2>
                </div>
              </div>

              {executionUsage && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {Number(executionUsage.used).toLocaleString()} of {Number(executionUsage.limit).toLocaleString()} executions used ({executionUsage.percent}%)
                      </div>
                      <div className="mt-2 text-sm text-obsidian-400">
                        {projectedExecutionUsage && projectedExecutionUsage > executionUsage.limit ? (
                          <span className="text-amber-300">
                            <AlertTriangle className="mr-1 inline" size={14} />
                            At current pace: you&apos;ll exceed your limit by ~{(projectedExecutionUsage - executionUsage.limit).toLocaleString()} executions
                          </span>
                        ) : (
                          `At current pace: you'll use ~${(projectedExecutionUsage || 0).toLocaleString()} this month (within limit)`
                        )}
                      </div>
                    </div>
                    <CalendarClock className="text-cyan-300" size={18} />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-obsidian-800">
                    <div className={clsx('h-full rounded-full', progressTone(executionUsage.percent))} style={{ width: `${Math.min(executionUsage.percent, 100)}%` }} />
                  </div>
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {usageRows.map(([label, item]) => (
                  <UsageRow key={label} label={label} item={item} />
                ))}
              </div>
            </section>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-obsidian-400">Next invoice</p>
                <h2 className="mt-1 text-xl font-semibold text-white">What Stripe expects to charge next</h2>
              </div>
              <ReceiptText className="text-accent-300" size={18} />
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-obsidian-400">Date</span>
                <span className="text-sm text-white">{formatDate(upcomingInvoice?.period_end || subscription?.current_period_end || null)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-obsidian-400">Base subscription</span>
                <span className="text-sm text-white">{formatCurrency(PLAN_META[currentPlan]?.monthlyPrice || 0)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-obsidian-400">Execution overages</span>
                <span className="text-sm text-white">
                  {formatCurrency(
                    Math.max(
                      (upcomingInvoice?.amount_due || 0) - (PLAN_META[currentPlan]?.monthlyPrice || 0),
                      0,
                    ),
                  )}
                </span>
              </div>
              <div className="mt-4 h-px bg-white/10" />
              <div className="mt-4 flex items-center justify-between text-lg font-semibold text-white">
                <span>Total</span>
                <span>{formatCurrency(upcomingInvoice?.amount_due || PLAN_META[currentPlan]?.monthlyPrice || 0)}</span>
              </div>
            </div>

            <button
              className="mt-4 inline-flex items-center gap-2 text-sm text-accent-300 transition hover:text-accent-200"
              onClick={() => setShowInvoiceDetails(value => !value)}
            >
              {showInvoiceDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              View upcoming invoice details
            </button>

            {showInvoiceDetails && (
              <div className="mt-4">
                <InvoiceDetails lineItems={upcomingInvoice?.line_items || []} />
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-obsidian-400">Payment methods</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Saved cards</h2>
              </div>
              <button className="btn-secondary" onClick={() => setShowPaymentModal(true)}>
                Add payment method
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {paymentMethodsQuery.isLoading ? (
                <>
                  <Skeleton className="h-20 rounded-2xl" />
                  <Skeleton className="h-20 rounded-2xl" />
                </>
              ) : paymentMethods.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-obsidian-400">
                  No saved cards yet. Add one before your trial ends to avoid interruption.
                </div>
              ) : (
                paymentMethods.map((method: BillingPaymentMethod) => (
                  <div key={method.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {method.brand || 'Card'} •••• {method.last4 || '0000'}
                        {method.is_default && <span className="badge-purple ml-3">Default</span>}
                      </div>
                      <div className="mt-1 text-xs text-obsidian-400">
                        Expires {method.exp_month || '--'}/{method.exp_year || '--'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!method.is_default && (
                        <button
                          className="btn-secondary h-9 px-3 text-sm"
                          onClick={() => setDefaultMutation.mutate(method.id)}
                          disabled={setDefaultMutation.isPending}
                        >
                          Make default
                        </button>
                      )}
                      <button
                        className="btn-ghost h-9 px-3 text-sm text-red-200 hover:bg-red-500/10 hover:text-red-100"
                        onClick={() => deleteMethodMutation.mutate(method.id)}
                        disabled={deleteMethodMutation.isPending || paymentMethods.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {defaultPaymentMethod && (
              <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={16} />
                  Default card on file
                </div>
                <p className="mt-2 text-emerald-100/85">
                  {defaultPaymentMethod.brand || 'Card'} ending in {defaultPaymentMethod.last4 || '0000'} will be used for renewals and upgrades.
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-obsidian-400">Invoice history</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Previous charges</h2>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-obsidian-400">
                  <th className="pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {invoicesQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="py-5">
                      <Skeleton className="h-16 rounded-2xl" />
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-obsidian-500">
                      No invoices yet.
                    </td>
                  </tr>
                ) : (
                  invoices.map(invoice => (
                    <tr key={invoice.id} className="border-b border-white/[0.06] text-obsidian-200 last:border-b-0">
                      <td className="py-4">{formatDate(invoice.date)}</td>
                      <td className="py-4">{formatCurrency(invoice.amount)}</td>
                      <td className="py-4">
                        <span className={clsx(
                          'rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
                          invoice.status === 'paid' && 'bg-emerald-400/15 text-emerald-200',
                          invoice.status === 'open' && 'bg-amber-400/15 text-amber-200',
                          invoice.status === 'void' && 'bg-white/10 text-obsidian-300',
                        )}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="py-4">
                        {invoice.pdf_url ? (
                          <a className="text-accent-300 transition hover:text-accent-200" href={invoice.pdf_url} target="_blank" rel="noreferrer">
                            Download PDF
                          </a>
                        ) : (
                          <span className="text-obsidian-500">Unavailable</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <PaymentMethodModal
        open={showPaymentModal}
        publishableKey={publishableKey}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={refreshBilling}
      />

      <UpgradeFlow
        open={showUpgradeFlow || Boolean(selectedPlan && selectedPlan !== 'free')}
        currentPlan={currentPlan}
        plans={plans}
        subscription={subscription}
        paymentMethods={paymentMethods}
        publishableKey={publishableKey}
        initialPlan={selectedPlan}
        onClose={() => {
          setShowUpgradeFlow(false)
          const next = new URLSearchParams(searchParams)
          next.delete('plan')
          setSearchParams(next, { replace: true })
        }}
        onRefresh={refreshBilling}
      />

      <ConfirmDialog
        open={showCancelDialog}
        title="Cancel subscription?"
        description="Your plan will remain active until the current billing period ends, then the organization will move to Free."
        confirmLabel="Cancel at period end"
        cancelLabel="Keep plan"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onClose={() => setShowCancelDialog(false)}
      />
    </div>
  )
}

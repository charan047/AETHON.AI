import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CreditCard, Loader2, Sparkles, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useMutation } from '@tanstack/react-query'
import { billingApi } from '../../api/client'
import { toast } from '../../lib/toast'
import type { BillingPaymentMethod, BillingPlan, BillingSubscriptionStatus, OrgPlan } from '../../types'
import { BILLING_PLAN_ORDER, PLAN_META } from './planMeta'
import { PaymentMethodModal } from './PaymentMethodModal'

type UpgradeFlowProps = {
  open: boolean
  currentPlan: OrgPlan
  plans: BillingPlan[]
  subscription: BillingSubscriptionStatus | null
  paymentMethods: BillingPaymentMethod[]
  publishableKey: string
  initialPlan?: OrgPlan | null
  onClose: () => void
  onRefresh: () => Promise<void> | void
}

const STEP_LABELS = ['Select plan', 'Payment', 'Confirmation'] as const

export function UpgradeFlow({
  open,
  currentPlan,
  plans,
  subscription,
  paymentMethods,
  publishableKey,
  initialPlan,
  onClose,
  onRefresh,
}: UpgradeFlowProps) {
  const planMap = useMemo(() => new Map(plans.map(plan => [plan.plan, plan])), [plans])
  const selectablePlans = BILLING_PLAN_ORDER.filter(plan => plan !== 'free')
  const [step, setStep] = useState(0)
  const [selectedPlan, setSelectedPlan] = useState<OrgPlan>(initialPlan && initialPlan !== 'free' ? initialPlan : 'solo')
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string>('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setSelectedPlan(initialPlan && initialPlan !== 'free' ? initialPlan : 'solo')
    setSelectedPaymentMethod(paymentMethods.find(method => method.is_default)?.id || paymentMethods[0]?.id || null)
    setSuccessMessage('')
  }, [open, initialPlan, paymentMethods])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (showPaymentModal) {
          setShowPaymentModal(false)
          return
        }
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, showPaymentModal])

  const mutateUpgrade = useMutation({
    mutationFn: async () => {
      if (currentPlan === 'free') {
        if (!selectedPaymentMethod) throw new Error('Please add a payment method first.')
        return billingApi.subscribe(selectedPlan, selectedPaymentMethod)
      }
      return billingApi.upgrade(selectedPlan)
    },
    onSuccess: async result => {
      const trialEnd = typeof result === 'object' && result && 'trial_end' in result && result.trial_end
        ? new Date(Number(result.trial_end) * 1000).toLocaleDateString()
        : null
      setSuccessMessage(
        currentPlan === 'free'
          ? trialEnd
            ? `You're on ${PLAN_META[selectedPlan].label}. Your trial ends on ${trialEnd}.`
            : `You're on ${PLAN_META[selectedPlan].label}.`
          : `Your organization is moving to ${PLAN_META[selectedPlan].label}.`,
      )
      await onRefresh()
      setStep(2)
    },
    onError: (error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Could not update billing plan.'
      toast.error(detail)
    },
  })

  if (!open) return null

  const currentOrSelected = planMap.get(selectedPlan)
  const defaultMethod = paymentMethods.find(method => method.is_default)

  return (
    <>
      <div className="fixed inset-0 z-[75] grid place-items-center bg-black/75 p-4 backdrop-blur-xl" onClick={onClose}>
        <div
          className="relative w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/10 bg-obsidian-925 shadow-glow-lg"
          onClick={event => event.stopPropagation()}
        >
          <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-accent-500/20 via-cyan-500/10 to-transparent" />
          <button
            type="button"
            className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-black/20 p-2 text-obsidian-300 transition hover:bg-white/10 hover:text-white"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>

          <div className="relative p-6 sm:p-7">
            <div className="mb-6">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Upgrade flow</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Move to the right plan for your AI company</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {STEP_LABELS.map((label, index) => (
                  <div key={label} className={clsx(
                    'rounded-2xl border px-4 py-3 text-sm',
                    index === step
                      ? 'border-accent-400/40 bg-accent-500/10 text-white'
                      : index < step
                        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                        : 'border-white/10 bg-white/[0.03] text-obsidian-400',
                  )}>
                    {index + 1}. {label}
                  </div>
                ))}
              </div>
            </div>

            {step === 0 && (
              <div className="grid gap-4 lg:grid-cols-3">
                {selectablePlans.map(plan => {
                  const meta = PLAN_META[plan]
                  const isCurrent = currentPlan === plan
                  const isSelected = selectedPlan === plan
                  return (
                    <button
                      key={plan}
                      className={clsx(
                        'rounded-[26px] border p-5 text-left transition',
                        meta.highlighted
                          ? 'border-accent-400/35 bg-gradient-to-br from-accent-500/20 via-accent-500/10 to-cyan-500/5'
                          : 'border-white/10 bg-white/[0.03]',
                        isSelected && 'shadow-glow-sm',
                      )}
                      onClick={() => setSelectedPlan(plan)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-white">{meta.label}</div>
                          <div className="mt-1 text-sm text-obsidian-400">{meta.tagline}</div>
                        </div>
                        {isCurrent && <span className="badge-gray">Current</span>}
                      </div>
                      <div className="mt-5 text-3xl font-semibold text-white">${meta.monthlyPrice}</div>
                      <div className="mt-1 text-sm text-obsidian-400">per month</div>
                      <div className="mt-5 space-y-2 text-sm text-obsidian-300">
                        {meta.limits.map(limit => <div key={limit}>{limit}</div>)}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {step === 1 && currentOrSelected && (
              <div className="grid gap-5 lg:grid-cols-[1.15fr,0.85fr]">
                <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center gap-3">
                    <CreditCard className="text-cyan-300" size={18} />
                    <h3 className="text-lg font-semibold text-white">Payment</h3>
                  </div>

                  {paymentMethods.length > 0 ? (
                    <div className="mt-5 space-y-3">
                      {paymentMethods.map(method => (
                        <button
                          key={method.id}
                          className={clsx(
                            'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition',
                            selectedPaymentMethod === method.id
                              ? 'border-accent-400/40 bg-accent-500/10'
                              : 'border-white/10 bg-black/15 hover:bg-white/[0.04]',
                          )}
                          onClick={() => setSelectedPaymentMethod(method.id)}
                        >
                          <div>
                            <div className="text-sm font-medium text-white">
                              {method.brand || 'Card'} •••• {method.last4 || '0000'}
                            </div>
                            <div className="mt-1 text-xs text-obsidian-400">
                              Expires {method.exp_month || '--'}/{method.exp_year || '--'}
                            </div>
                          </div>
                          {method.is_default && <span className="badge-purple">Default</span>}
                        </button>
                      ))}
                      <button className="btn-secondary mt-3" onClick={() => setShowPaymentModal(true)}>
                        Add payment method
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                      <p>No payment method is on file yet.</p>
                      <button className="btn-primary mt-4" onClick={() => setShowPaymentModal(true)}>
                        Add payment method
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-[26px] border border-white/10 bg-black/20 p-5">
                  <div className="text-sm text-obsidian-400">Selected plan</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{PLAN_META[selectedPlan].label}</div>
                  <div className="mt-1 text-sm text-obsidian-400">{PLAN_META[selectedPlan].tagline}</div>
                  <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-obsidian-400">Price</span>
                      <span className="text-lg font-semibold text-white">${PLAN_META[selectedPlan].monthlyPrice}/mo</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm text-obsidian-400">Current plan</span>
                      <span className="capitalize text-obsidian-200">{currentPlan}</span>
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-100">
                    <div className="mb-2 flex items-center gap-2 font-medium">
                      <Sparkles size={16} /> Trial terms
                    </div>
                    {currentPlan === 'free'
                      ? 'You’ll start with a 14-day trial before the first charge.'
                      : 'Plan changes apply immediately and prorations are handled by Stripe.'}
                  </div>

                  <button
                    className="btn-primary mt-5 w-full"
                    disabled={mutateUpgrade.isPending || (currentPlan === 'free' && !selectedPaymentMethod)}
                    onClick={() => mutateUpgrade.mutate()}
                  >
                    {mutateUpgrade.isPending ? <><Loader2 size={16} className="animate-spin" /> Processing...</> : currentPlan === 'free' ? 'Start Trial' : 'Upgrade Now'}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid place-items-center py-10 text-center">
                <div className="grid h-20 w-20 place-items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 text-emerald-200 shadow-glow-sm animate-pulse">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="mt-6 text-3xl font-semibold text-white">You&apos;re on {PLAN_META[selectedPlan].label}!</h3>
                <p className="mt-3 max-w-xl text-sm leading-7 text-obsidian-300">{successMessage}</p>
                <button
                  className="btn-primary mt-7"
                  onClick={() => {
                    onClose()
                  }}
                >
                  Explore your new features
                </button>
              </div>
            )}

            {step < 2 && (
              <div className="mt-6 flex items-center justify-between">
                <button className="btn-ghost" onClick={step === 0 ? onClose : () => setStep(step - 1)}>
                  {step === 0 ? 'Maybe later' : 'Back'}
                </button>
                {step === 0 && (
                  <button className="btn-primary" onClick={() => setStep(1)}>
                    Select {PLAN_META[selectedPlan].label}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <PaymentMethodModal
        open={showPaymentModal}
        publishableKey={publishableKey}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={onRefresh}
      />
    </>
  )
}

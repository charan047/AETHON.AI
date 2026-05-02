import { useEffect, useMemo, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { Loader2, Lock, ShieldCheck, X } from 'lucide-react'
import { billingApi } from '../../api/client'
import { toast } from '../../lib/toast'

type PaymentMethodModalProps = {
  open: boolean
  publishableKey: string
  onClose: () => void
  onSuccess: () => void | Promise<void>
}

function PaymentMethodForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void | Promise<void> }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/settings/billing`,
      },
      redirect: 'if_required',
    })
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error.message || 'Could not save payment method.')
      return
    }

    toast.success('Payment method saved.')
    await onSuccess()
    onClose()
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <PaymentElement />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-obsidian-400">
        {['Visa', 'Mastercard', 'AmEx', 'Apple Pay'].map(label => (
          <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
            {label}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-emerald-300">
        <ShieldCheck size={14} />
        Secured by Stripe. We never see or store your full card number.
      </div>

      <div className="flex items-center justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!stripe || !elements || submitting}>
          {submitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <>Save payment method</>}
        </button>
      </div>
    </form>
  )
}

export function PaymentMethodModal({ open, publishableKey, onClose, onSuccess }: PaymentMethodModalProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  )

  useEffect(() => {
    if (!open || !publishableKey) return
    let active = true
    setLoading(true)
    setClientSecret(null)
    billingApi
      .setupIntent()
      .then(result => {
        if (active) setClientSecret(result.client_secret)
      })
      .catch(() => {
        toast.error('Could not initialize Stripe payment form.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, publishableKey])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4 backdrop-blur-xl"
      onClick={() => onClose()}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-obsidian-925 shadow-glow-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-500/15 via-accent-500/10 to-transparent" />
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

        <div className="relative p-6 pr-16 sm:p-7 sm:pr-16">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-200">
              <Lock size={18} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Add payment method</h2>
              <p className="mt-1 text-sm text-obsidian-400">
                Save a card for billing, upgrades, and uninterrupted renewals.
              </p>
            </div>
          </div>

          {!publishableKey ? (
            <div className="space-y-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm text-amber-100">
              <p>Stripe is not configured for this environment yet, so card collection is unavailable right now.</p>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    onClose()
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : loading || !clientSecret || !stripePromise ? (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-white/10 bg-black/15 text-sm text-obsidian-400">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Loading secure payment form...
              </div>
            </div>
          ) : (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: 'night',
                  variables: {
                    colorPrimary: '#6366f1',
                    colorBackground: '#0f1117',
                    colorText: '#f8fafc',
                    colorDanger: '#ef4444',
                    borderRadius: '16px',
                  },
                },
              }}
            >
              <PaymentMethodForm onClose={onClose} onSuccess={onSuccess} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  )
}

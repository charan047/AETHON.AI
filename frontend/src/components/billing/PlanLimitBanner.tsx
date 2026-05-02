import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { billingApi } from '../../api/client'

const DISMISS_KEY = 'ai-company-os-plan-limit-banner-dismissed-at'
const DAY_MS = 24 * 60 * 60 * 1000

export function PlanLimitBanner() {
  const navigate = useNavigate()
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const { data } = useQuery({
    queryKey: ['billing', 'usage', 'banner'],
    queryFn: billingApi.usage,
    refetchInterval: 30 * 60 * 1000,
  })

  useEffect(() => {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    setDismissedAt(raw ? Number(raw) : null)
  }, [])

  const executionUsage = data?.executions
  const now = Date.now()
  const hideAmber = dismissedAt && now - dismissedAt < DAY_MS

  const banner = useMemo(() => {
    if (!executionUsage) return null
    if (executionUsage.percent > 100) {
      return {
        tone: 'red',
        title: "You've exceeded your execution limit.",
        body: 'New workflows may pause until you upgrade your plan.',
        cta: 'Upgrade Now',
      }
    }
    if (executionUsage.percent >= 80 && !hideAmber) {
      return {
        tone: 'amber',
        title: `You've used ${Math.round(executionUsage.percent)}% of your monthly executions.`,
        body: 'Upgrade now to avoid interruption as your run volume climbs.',
        cta: 'Upgrade Plan',
      }
    }
    return null
  }, [executionUsage, hideAmber])

  if (!banner) return null

  return (
    <div className={banner.tone === 'red'
      ? 'border-b border-red-400/20 bg-red-500/10'
      : 'border-b border-amber-400/20 bg-amber-500/10'}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={banner.tone === 'red' ? 'mt-0.5 text-red-300' : 'mt-0.5 text-amber-300'}>
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <p className={banner.tone === 'red' ? 'text-sm font-medium text-red-100' : 'text-sm font-medium text-amber-100'}>
              {banner.title}
            </p>
            <p className={banner.tone === 'red' ? 'mt-1 text-sm text-red-100/80' : 'mt-1 text-sm text-amber-100/80'}>
              {banner.body}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary h-9 px-3 text-sm" onClick={() => navigate('/settings/billing')}>
            {banner.cta}
            <ArrowRight size={14} />
          </button>
          {banner.tone !== 'red' && (
            <button
              className="text-sm text-amber-100/80 transition hover:text-amber-50"
              onClick={() => {
                const timestamp = Date.now()
                window.localStorage.setItem(DISMISS_KEY, String(timestamp))
                setDismissedAt(timestamp)
              }}
            >
              Dismiss for 24h
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


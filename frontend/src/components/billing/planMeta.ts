import type { OrgPlan } from '../../types'

export type BillingCadence = 'monthly' | 'annual'

export type PlanMeta = {
  plan: OrgPlan
  label: string
  tagline: string
  subtitle: string
  monthlyPrice: number
  annualPrice: number
  cta: string
  badge?: string
  highlighted?: boolean
  limits: string[]
  features: { label: string; included: boolean }[]
}

export const BILLING_PLAN_ORDER: OrgPlan[] = ['free', 'solo', 'team', 'business']

export const PLAN_META: Record<OrgPlan, PlanMeta> = {
  free: {
    plan: 'free',
    label: 'Free',
    tagline: 'Try it out',
    subtitle: 'Kick the tires before you operationalize your AI company.',
    monthlyPrice: 0,
    annualPrice: 0,
    cta: 'Start Free',
    limits: ['3 agents', '5 workflows', '100 runs/month'],
    features: [
      { label: 'Persistent memory', included: false },
      { label: 'Parallel execution', included: false },
      { label: 'Scheduling', included: false },
      { label: 'Webhook triggers', included: false },
      { label: 'Custom tools', included: true },
    ],
  },
  solo: {
    plan: 'solo',
    label: 'Solo',
    tagline: 'Perfect for solo founders',
    subtitle: 'Everything you need to run one AI-native company by yourself.',
    monthlyPrice: 29,
    annualPrice: 23,
    cta: 'Start 14-day trial',
    badge: 'Most popular for solopreneurs',
    limits: ['Unlimited agents', 'Unlimited workflows', '2,000 runs/month'],
    features: [
      { label: 'Persistent memory', included: true },
      { label: 'Parallel execution', included: true },
      { label: 'Scheduling', included: true },
      { label: 'Webhook triggers', included: true },
      { label: 'API keys', included: true },
    ],
  },
  team: {
    plan: 'team',
    label: 'Team',
    tagline: 'For growing teams',
    subtitle: 'Bring real collaborators into the loop without losing AI leverage.',
    monthlyPrice: 99,
    annualPrice: 79,
    cta: 'Start 14-day trial',
    badge: 'Best value',
    highlighted: true,
    limits: ['5 seats', 'Unlimited workflows', '10,000 runs/month'],
    features: [
      { label: 'Everything in Solo', included: true },
      { label: 'Team collaboration', included: true },
      { label: 'Expanded eval capacity', included: true },
      { label: 'Advanced integrations', included: true },
      { label: 'Role-based admin controls', included: true },
    ],
  },
  business: {
    plan: 'business',
    label: 'Business',
    tagline: 'For serious companies',
    subtitle: 'Higher limits, more control, and room to scale AI operations safely.',
    monthlyPrice: 299,
    annualPrice: 239,
    cta: 'Start 14-day trial',
    limits: ['25 seats', '50,000 runs/month', 'Priority-scale limits'],
    features: [
      { label: 'Everything in Team', included: true },
      { label: 'Advanced budget capacity', included: true },
      { label: 'Enterprise-ready throughput', included: true },
      { label: 'Broader admin controls', included: true },
      { label: 'Priority support', included: true },
    ],
  },
  enterprise: {
    plan: 'enterprise',
    label: 'Enterprise',
    tagline: 'For custom deployments',
    subtitle: 'Custom security, compliance, and support.',
    monthlyPrice: 999,
    annualPrice: 799,
    cta: 'Contact sales',
    limits: ['Custom', 'Custom', 'Custom'],
    features: [
      { label: 'Custom contracts', included: true },
      { label: 'Dedicated support', included: true },
      { label: 'Custom security review', included: true },
      { label: 'Custom deployment guidance', included: true },
      { label: 'Custom usage envelope', included: true },
    ],
  },
}

export function planPrice(plan: OrgPlan, cadence: BillingCadence): number {
  const meta = PLAN_META[plan]
  return cadence === 'annual' ? meta.annualPrice : meta.monthlyPrice
}


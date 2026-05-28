import { type ReactNode, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, CheckCircle2, Shield, Zap } from 'lucide-react'
import { BlurText } from './reactbits/BlurText'
import { SplitText } from './reactbits/SplitText'

const BULLETS = [
  'Research briefs in minutes',
  'Client reports that write themselves',
  'You approve before anything goes out',
]

const PRODUCT_STATEMENT = 'Your AI team. Handles the work. You stay in control.'

type ProofItem = {
  stat: string
  label: string
  detail: string
}

type DemoActivityItem = {
  agent: string
  action: string
  time: string
  color: string
  live?: boolean
}

const PROOF_ITEMS: ProofItem[] = [
  {
    stat: '10x',
    label: 'Client work shipped faster',
    detail: 'Repeatable delivery handled by agents instead of late-night manual work.',
  },
  {
    stat: '100%',
    label: 'Oversight on every risky action',
    detail: 'Important sends, approvals, and handoffs wait for you before anything reaches clients.',
  },
  {
    stat: '5 min',
    label: 'To launch your first team member',
    detail: 'Pick a template, give it context, and watch the first run happen live.',
  },
]

const DEMO_ACTIVITY: DemoActivityItem[] = [
  {
    agent: 'Maya',
    action: 'Finished: Competitor pricing brief for Acme Corp',
    time: '2m ago',
    color: '#10B981',
  },
  {
    agent: 'Alex',
    action: 'Waiting for approval: outreach email to TechCrunch',
    time: '5m ago',
    color: '#F59E0B',
  },
  {
    agent: 'Jordan',
    action: 'Running: Q2 market analysis for BuildFast',
    time: 'Now',
    color: '#6366F1',
    live: true,
  },
]

const TRUST_SIGNALS = [
  { icon: Shield, label: 'Approval-first control' },
  { icon: CheckCircle2, label: 'Full audit trails' },
  { icon: BarChart3, label: 'Client-ready reporting' },
] as const

export function AuthShell({
  title,
  subtitle,
  children,
  mode = 'signin',
}: {
  title: string
  subtitle: string
  children: ReactNode
  mode?: 'signin' | 'signup' | 'invite'
}) {
  const [proofIndex, setProofIndex] = useState(0)
  const [activityItems, setActivityItems] = useState(DEMO_ACTIVITY.slice(0, 2))

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProofIndex(index => (index + 1) % PROOF_ITEMS.length)
    }, 3200)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActivityItems(DEMO_ACTIVITY)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="auth-shell">
      <div aria-hidden className="auth-shell__grid" />

      <section className="auth-shell__left">
        <div className="mx-auto flex h-full w-full max-w-[600px] flex-col justify-between px-10 py-16">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mb-10 flex items-center gap-3"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-[0_0_24px_rgba(99,102,241,0.28)]">
              <Zap size={18} className="text-white" />
            </div>
            <div className="text-base font-bold tracking-tight text-white">Aethon</div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
              Agency OS
            </span>
          </motion.div>

          <div className="max-w-[560px]">
            <div style={{ fontSize: 'clamp(40px,5vw,60px)' }}>
              <BlurText
                text="Run your AI agency."
                className="font-extrabold leading-[1.02] tracking-[-0.04em] text-white"
                delay={80}
              />
            </div>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.35 }}
              className="mt-5 max-w-md text-base leading-7 text-[var(--text-2)]"
            >
              {PRODUCT_STATEMENT}
            </motion.p>

            <div className="mt-10 space-y-4">
              {BULLETS.map((bullet, index) => (
                <div key={bullet} className="flex items-start gap-3">
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.28 + index * 0.05, duration: 0.2 }}
                    className="mt-2.5 h-2 w-2 rounded-full bg-indigo-500"
                  />
                  <div className="pt-0.5">
                    <SplitText
                      text={bullet}
                      className="text-base text-white/55"
                      delay={30}
                      animationFrom={{ opacity: 0, transform: 'translateY(12px)' }}
                      animationTo={{ opacity: 1, transform: 'translateY(0)' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.35 }}
              className="mt-10"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={proofIndex}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.28 }}
                  className="auth-proof-card"
                >
                  <div className="min-w-[86px] text-[40px] font-extrabold leading-none tracking-[-0.05em] text-white">
                    {PROOF_ITEMS[proofIndex].stat}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">
                      {PROOF_ITEMS[proofIndex].label}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--text-2)]">
                      {PROOF_ITEMS[proofIndex].detail}
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-3 flex gap-1.5 pl-1">
                {PROOF_ITEMS.map((_, index) => (
                  <span
                    key={index}
                    className="auth-proof-progress"
                    style={{
                      width: index === proofIndex ? 22 : 6,
                      background: index === proofIndex ? 'rgba(99,102,241,0.92)' : 'rgba(255,255,255,0.15)',
                    }}
                  />
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.4 }}
              className="auth-activity-card mt-8"
            >
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                <span className="dot-live" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-2)]">
                  Live agency activity
                </span>
              </div>
              <div className="divide-y divide-white/[0.05]">
                <AnimatePresence>
                  {activityItems.map((item, index) => (
                    <motion.div
                      key={`${item.agent}-${index}`}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: index * 0.08 }}
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <div
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white"
                        style={{
                          background: `${item.color}28`,
                          border: `1px solid ${item.color}45`,
                        }}
                      >
                        {item.agent.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          <span className="text-[var(--text-2)]">{item.agent}:</span> {item.action}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-3)]">
                          {item.live ? (
                            <span className="flex items-center gap-1.5 text-emerald-400">
                              <span className="dot-live" />
                              Working now
                            </span>
                          ) : (
                            item.time
                          )}
                        </p>
                      </div>
                      {item.live ? (
                        <div className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                          Live
                        </div>
                      ) : null}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.35 }}
            className="mt-10 flex flex-wrap items-center gap-5 text-xs text-[var(--text-3)]"
          >
            {TRUST_SIGNALS.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2">
                <Icon size={13} className="text-indigo-400/85" />
                <span>{label}</span>
              </div>
            ))}
          </motion.div>
          </div>
      </section>

      <section className="auth-shell__right" data-auth-mode={mode}>
        <div className="auth-shell__form-wrap">
          <div className="mb-8">
            <h1 className="text-xl font-bold tracking-tight text-white auth-shell__title">{title}</h1>
            <p className="mt-1.5 text-sm text-[var(--text-3)] auth-shell__subtitle">{subtitle}</p>
          </div>

          <div className="auth-shell__form-card">{children}</div>
        </div>
      </section>
    </div>
  )
}

export function FloatingField({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
  disabled,
}: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const lifted = focused || value.length > 0

  return (
    <label className="relative block">
      <input
        type={type}
        autoComplete={autoComplete}
        value={value}
        required={required}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="auth-floating-input"
      />
      <span
        className="pointer-events-none absolute left-3.5 transition-all duration-200"
        style={{
          top: lifted ? '7px' : '50%',
          transform: lifted ? 'none' : 'translateY(-50%)',
          fontSize: lifted ? '10px' : '13px',
          letterSpacing: lifted ? '0.10em' : 'normal',
          textTransform: lifted ? 'uppercase' : 'none',
          color: focused ? 'var(--auth-label-active)' : 'var(--auth-label-idle)',
        }}
      >
        {label}
      </span>
    </label>
  )
}

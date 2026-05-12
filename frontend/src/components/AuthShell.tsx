import { type ReactNode, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  Briefcase,
  CheckCircle2,
  Shield,
} from 'lucide-react'

const PROOF_ITEMS = [
  {
    stat: '10x',
    label: 'Client work shipped faster',
    detail: 'AI agents running 24/7 across your client accounts',
  },
  {
    stat: '100%',
    label: 'Full oversight of every action',
    detail: 'Every tool call logged, every risky action needs your OK',
  },
  {
    stat: '5 min',
    label: 'To deploy your first agent',
    detail: 'Choose a template, set a goal, watch it work',
  },
]

const DEMO_ACTIVITY = [
  {
    agent: 'Maya',
    action: 'Finished: Competitor pricing report for Acme Corp',
    time: '2m ago',
    color: '#10B981',
  },
  {
    agent: 'Alex',
    action: 'Waiting for approval: send outreach@techcrunch.com',
    time: '5m ago',
    color: '#F59E0B',
  },
  {
    agent: 'Jordan',
    action: 'Running: Q2 market analysis for BuildFast',
    time: 'Now',
    color: '#3B82F6',
    live: true,
  },
]

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
    }, 3000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActivityItems(DEMO_ACTIVITY)
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#050914]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -left-1/4 -top-1/4 h-[140%] w-[70%] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, rgba(37,99,235,0.6) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
          animate={{ x: [0, 40, 0], y: [0, -20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-1/4 -right-1/4 h-[120%] w-[60%] rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, rgba(16,185,129,0.5) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
          animate={{ x: [0, -30, 0], y: [0, 20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      <div className="relative hidden flex-col justify-between p-12 lg:flex lg:w-[55%] xl:p-16">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-3"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.5)]">
            <Briefcase size={18} className="text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">Aethon</span>
          <span className="rounded-full bg-blue-600/15 px-2 py-0.5 text-[11px] font-semibold text-blue-400">
            Agency OS
          </span>
        </motion.div>

        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            <h1 className="text-5xl font-extrabold leading-[1.05] tracking-[-0.04em] text-white xl:text-6xl">
              Run your AI agency
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                without the chaos.
              </span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-[#8B9DBE]">
              Deploy AI agents for each client. Stay in control of everything they do.
              Share a portal so clients see results in real time.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-8"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={proofIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35 }}
                className="inline-flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 backdrop-blur-sm"
              >
                <span className="text-4xl font-extrabold text-white">
                  {PROOF_ITEMS[proofIndex].stat}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {PROOF_ITEMS[proofIndex].label}
                  </p>
                  <p className="mt-0.5 text-xs text-[#8B9DBE]">
                    {PROOF_ITEMS[proofIndex].detail}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="mt-3 flex gap-1.5 pl-1">
              {PROOF_ITEMS.map((_, index) => (
                <div
                  key={index}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: index === proofIndex ? 20 : 6,
                    background: index === proofIndex ? '#2563EB' : 'rgba(255,255,255,0.15)',
                  }}
                />
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-8 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080D1A]/80 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-xs font-semibold text-[#8B9DBE]">Live agent activity</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              <AnimatePresence>
                {activityItems.map((item, index) => (
                  <motion.div
                    key={`${item.agent}${index}`}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="flex items-start gap-3 px-4 py-3"
                  >
                    <div
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                      style={{
                        background: `${item.color}30`,
                        border: `1px solid ${item.color}40`,
                      }}
                    >
                      {item.agent.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#F0F6FF]">
                        <span className="text-[#8B9DBE]">{item.agent}:</span> {item.action}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#4B5A73]">
                        {item.live ? (
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Working now
                          </span>
                        ) : (
                          item.time
                        )}
                      </p>
                    </div>
                    {item.live && (
                      <div className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        LIVE
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="flex items-center gap-6 text-xs text-[#4B5A73]"
        >
          {[
            { icon: Shield, label: 'Open source, MIT license' },
            { icon: CheckCircle2, label: 'Self-hostable in minutes' },
            { icon: BarChart3, label: 'Full audit logs' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <Icon size={13} className="text-blue-500/70" />
              {label}
            </div>
          ))}
        </motion.div>
      </div>

      <div className="relative flex w-full items-center justify-center p-6 lg:w-[45%] lg:p-12">
        <div className="absolute left-6 top-6 flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <Briefcase size={16} className="text-white" />
          </div>
          <span className="text-sm font-bold text-white">Aethon</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-sm"
          data-auth-mode={mode}
        >
          <div className="mb-7">
            <h2 className="text-2xl font-extrabold tracking-tight text-white">
              {title}
            </h2>
            <p className="mt-1.5 text-sm text-[#8B9DBE]">{subtitle}</p>
          </div>

          <div
            className="rounded-2xl p-6"
            style={{
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 48px rgba(0,0,0,0.30)',
            }}
          >
            {children}
          </div>
        </motion.div>
      </div>
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
}: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const hasValue = value.length > 0
  const isLifted = focused || hasValue

  return (
    <label className="group relative block">
      <input
        className="peer h-[52px] w-full rounded-xl border bg-white/[0.04] px-3.5 pb-1.5 pt-5 text-sm text-white transition-all duration-150 outline-none placeholder:text-transparent"
        style={{
          borderColor: focused ? 'rgba(37,99,235,0.70)' : 'rgba(255,255,255,0.09)',
          boxShadow: focused
            ? '0 0 0 3px rgba(37,99,235,0.13), 0 0 16px rgba(37,99,235,0.10)'
            : 'none',
        }}
        type={type}
        placeholder={label}
        autoComplete={autoComplete}
        value={value}
        required={required}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <span
        className="pointer-events-none absolute left-3.5 font-medium text-[#4B5A73] transition-all duration-200"
        style={{
          top: isLifted ? '6px' : '50%',
          transform: isLifted ? 'none' : 'translateY(-50%)',
          fontSize: isLifted ? '10px' : '13px',
          letterSpacing: isLifted ? '0.1em' : 'normal',
          textTransform: isLifted ? 'uppercase' : 'none',
          color: focused ? 'rgba(96,165,250,0.9)' : undefined,
        }}
      >
        {label}
      </span>
    </label>
  )
}

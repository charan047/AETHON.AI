import { type ReactNode, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, CheckCircle2, Shield, Zap } from 'lucide-react'

const STATS = [
  { value: '10x', label: 'Faster client delivery' },
  { value: '100%', label: 'Action audit trail' },
  { value: '5 min', label: 'To deploy first agent' },
]

const ACTIVITY = [
  { agent: 'Maya', action: 'Completed competitor research for Acme Corp', time: '2m ago', live: false },
  { agent: 'Jordan', action: 'Waiting for approval: outreach@acme.com', time: '4m ago', live: false },
  { agent: 'Alex', action: 'Running: Q2 market analysis for BuildFast', time: 'now', live: true },
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
  const [statIdx, setStatIdx] = useState(0)
  const [activity, setActivity] = useState(ACTIVITY.slice(0, 2))

  useEffect(() => {
    const timer = window.setInterval(() => setStatIdx(index => (index + 1) % STATS.length), 3000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setActivity(ACTIVITY), 2000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="relative flex min-h-screen overflow-hidden" style={{ background: '#050914' }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute rounded-full"
          style={{
            width: '55%',
            height: '80%',
            left: '-10%',
            top: '-15%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.28) 0%, transparent 70%)',
            filter: 'blur(70px)',
          }}
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{
            width: '45%',
            height: '70%',
            right: '-5%',
            bottom: '-10%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.20) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
          animate={{ x: [0, -20, 0], y: [0, 15, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{
            width: '30%',
            height: '40%',
            left: '30%',
            top: '40%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
          animate={{ x: [0, 15, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      <div className="relative hidden flex-col justify-between p-16 lg:flex lg:w-[55%]">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-3"
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              boxShadow: '0 0 20px rgba(99,102,241,0.5)',
            }}
          >
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-base font-bold text-white">Aethon</span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: 'rgba(99,102,241,0.15)',
              color: '#a5b4fc',
              border: '1px solid rgba(99,102,241,0.25)',
            }}
          >
            Agency OS
          </span>
        </motion.div>

        <div>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            <h1
              className="font-extrabold leading-[1.05] tracking-[-0.04em] text-white"
              style={{ fontSize: 'clamp(42px, 5vw, 64px)' }}
            >
              Run your AI
              <br />
              <span
                style={{
                  background: 'linear-gradient(135deg, #a5b4fc 0%, #6ee7b7 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                agency.
              </span>
            </h1>
            <p className="mt-5 max-w-sm text-base leading-7" style={{ color: 'rgba(255,255,255,0.50)' }}>
              Deploy AI agents for clients. Stay in control of every action. Show clients exactly what was done.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-10"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={statIdx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="inline-flex items-center gap-5 rounded-2xl px-6 py-4"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <span className="text-4xl font-extrabold text-white">{STATS[statIdx].value}</span>
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {STATS[statIdx].label}
                </span>
              </motion.div>
            </AnimatePresence>
            <div className="mt-3 flex gap-1.5 pl-1">
              {STATS.map((_, index) => (
                <motion.div
                  key={index}
                  animate={{ width: index === statIdx ? 20 : 6 }}
                  className="h-1 rounded-full"
                  style={{ background: index === statIdx ? '#6366f1' : 'rgba(255,255,255,0.15)' }}
                />
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="mt-8 overflow-hidden rounded-2xl"
            style={{
              background: 'rgba(8,13,26,0.70)',
              border: '1px solid rgba(255,255,255,0.07)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: '#10b981' }} />
              <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.40)' }}>
                Live agent activity
              </span>
            </div>
            <AnimatePresence>
              {activity.map((item, index) => (
                <motion.div
                  key={item.agent}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.12 }}
                  className="flex items-start gap-3 px-4 py-3"
                  style={{ borderBottom: index < activity.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                >
                  <div
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                    style={{
                      background: item.live ? 'rgba(16,185,129,0.20)' : 'rgba(99,102,241,0.20)',
                      border: `1px solid ${item.live ? 'rgba(16,185,129,0.30)' : 'rgba(99,102,241,0.30)'}`,
                    }}
                  >
                    {item.agent.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white">
                      <span style={{ color: 'rgba(255,255,255,0.45)' }}>{item.agent}:</span> {item.action}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {item.live ? (
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Working now
                        </span>
                      ) : item.time}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75 }}
            className="mt-7 flex items-center gap-5 text-xs"
            style={{ color: 'rgba(255,255,255,0.25)' }}
          >
            {[
              { icon: Shield, label: 'MIT licensed' },
              { icon: CheckCircle2, label: 'Self-hostable' },
              { icon: BarChart3, label: 'Full audit logs' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <Icon size={12} style={{ color: 'rgba(99,102,241,0.70)' }} />
                {label}
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      <div className="relative flex w-full items-center justify-center p-6 lg:w-[45%] lg:p-14">
        <div className="absolute left-6 top-6 flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            <Zap size={15} className="text-white" />
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
            <h2 className="text-2xl font-extrabold tracking-tight text-white">{title}</h2>
            <p className="mt-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{subtitle}</p>
          </div>

          <div
            className="glass-elevated rounded-2xl p-6"
            style={{
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.40)',
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
    <label className="group relative block">
      <input
        type={type}
        autoComplete={autoComplete}
        value={value}
        required={required}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="peer h-[52px] w-full rounded-xl px-3.5 pb-1.5 pt-5 text-sm text-white outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${focused ? 'rgba(99,102,241,0.70)' : 'rgba(255,255,255,0.09)'}`,
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.13)' : 'none',
        }}
      />
      <span
        className="pointer-events-none absolute left-3.5 font-medium transition-all duration-200"
        style={{
          top: lifted ? '7px' : '50%',
          transform: lifted ? 'none' : 'translateY(-50%)',
          fontSize: lifted ? '10px' : '13px',
          letterSpacing: lifted ? '0.10em' : 'normal',
          textTransform: lifted ? 'uppercase' : 'none',
          color: focused ? 'rgba(165,180,252,0.90)' : 'rgba(255,255,255,0.30)',
        }}
      >
        {label}
      </span>
    </label>
  )
}

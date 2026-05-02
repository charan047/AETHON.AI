import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { executionsApi, onboardingApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { OnboardingStatus } from '../types'

type Screen = 'welcome' | 'company_identity' | 'hire_agent' | 'connect_tools' | 'first_run'

interface WizardState {
  companyName: string
  companyDescription: string
  primaryChallenge: string
  competitors: string
  deliveryMethod: string
  installedAgentId: string | null
  installedWorkflowId: string | null
  firstExecutionId: string | null
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
    scale: 0.98,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -60 : 60,
    opacity: 0,
    scale: 0.98,
  }),
}

const transition = {
  type: 'spring' as const,
  stiffness: 280,
  damping: 30,
}

const SCREENS: Screen[] = ['welcome', 'company_identity', 'hire_agent', 'connect_tools', 'first_run']

const CHALLENGES = [
  { value: 'growing_revenue', label: 'Growing revenue' },
  { value: 'saving_time', label: 'Saving time' },
  { value: 'understanding_market', label: 'Understanding market' },
  { value: 'managing_customers', label: 'Managing customers' },
  { value: 'building_product', label: 'Building product' },
]

function mapBackendStep(step: string | undefined): Screen {
  if (step === 'hire_agent') return 'hire_agent'
  if (step === 'connect_tools') return 'connect_tools'
  if (step === 'first_run') return 'first_run'
  return 'welcome'
}

function ProgressDots({ current }: { current: Screen }) {
  const currentIndex = SCREENS.indexOf(current)
  return (
    <div className="flex items-center gap-2">
      {SCREENS.map((screen, index) => (
        <div
          key={screen}
          className="rounded-full transition-all duration-300"
          style={{
            width: index === currentIndex ? 20 : 6,
            height: 6,
            backgroundColor: index <= currentIndex ? '#6366F1' : 'rgba(255,255,255,0.1)',
          }}
        />
      ))}
    </div>
  )
}

function WizardInput({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  autoFocus = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  autoFocus?: boolean
}) {
  const baseClass = [
    'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90',
    'placeholder:text-white/25 focus:border-accent-400/60 focus:bg-white/[0.07]',
    'focus:outline-none transition-all duration-150',
  ].join(' ')

  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wider text-white/40">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={3}
          className={`${baseClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={baseClass}
        />
      )}
    </div>
  )
}

function PrimaryButton({
  onClick,
  disabled = false,
  loading = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-accent-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading ? (
        <>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span>Working…</span>
        </>
      ) : children}
    </button>
  )
}

function WelcomeScreen({
  onNext,
  onUseDifferentAccount,
}: {
  onNext: () => void
  onUseDifferentAccount: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.18) 0%, transparent 60%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.6 }}
        className="relative z-10 max-w-md space-y-6"
      >
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-cyan-500 shadow-glow-md">
            <span className="font-mono text-base font-bold text-white">A</span>
          </div>
          <span className="text-xl font-bold tracking-wide text-white">AETHON</span>
        </div>

        <h1 className="text-4xl font-bold leading-tight text-white">
          Your AI company
          <br />
          starts now.
        </h1>

        <p className="text-lg leading-relaxed text-white/50">
          You're the CEO.
          <br />
          We'll help you hire your first agents.
        </p>

        <div className="pt-4">
          <PrimaryButton onClick={onNext}>Found my company →</PrimaryButton>
        </div>

        <button
          onClick={onUseDifferentAccount}
          className="w-full text-sm text-white/35 transition-colors hover:text-white/60"
        >
          Using the wrong account? Sign out and sign in
        </button>

        <p className="text-xs text-white/20">Takes 3 minutes. No credit card required.</p>
      </motion.div>
    </div>
  )
}

function CompanyIdentityScreen({
  state,
  onChange,
  onNext,
  loading,
}: {
  state: WizardState
  onChange: (key: keyof WizardState, value: string) => void
  onNext: () => void
  loading: boolean
}) {
  const isValid = state.companyName.trim().length > 0 && state.companyDescription.trim().length > 0

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <h2 className="mb-1 text-2xl font-bold text-white">What are you building?</h2>
        <p className="text-sm text-white/40">Your agents will use this to stay aligned with your goals.</p>
      </div>

      <WizardInput
        label="Company name"
        value={state.companyName}
        onChange={value => onChange('companyName', value)}
        placeholder="Acme Inc."
        autoFocus
      />

      <WizardInput
        label="What do you sell or build?"
        value={state.companyDescription}
        onChange={value => onChange('companyDescription', value)}
        placeholder="We build project management tools for remote engineering teams"
        multiline
      />

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-white/40">Biggest challenge right now</label>
        <div className="flex flex-wrap gap-2">
          {CHALLENGES.map(challenge => (
            <button
              key={challenge.value}
              onClick={() => onChange('primaryChallenge', challenge.value)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150"
              style={{
                background: state.primaryChallenge === challenge.value ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                border: state.primaryChallenge === challenge.value ? '1px solid rgba(99,102,241,0.6)' : '1px solid rgba(255,255,255,0.08)',
                color: state.primaryChallenge === challenge.value ? '#A5B4FC' : '#6B7280',
              }}
            >
              {challenge.label}
            </button>
          ))}
        </div>
      </div>

      <PrimaryButton onClick={onNext} disabled={!isValid} loading={loading}>
        Continue →
      </PrimaryButton>
    </div>
  )
}

function HireAgentScreen({
  state,
  onChange,
  onNext,
  loading,
}: {
  state: WizardState
  onChange: (key: keyof WizardState, value: string) => void
  onNext: () => void
  loading: boolean
}) {
  const isValid = state.competitors.trim().length > 0

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <h2 className="mb-1 text-2xl font-bold text-white">Hire your first employee.</h2>
        <p className="text-sm text-white/40">
          Every company needs eyes on the market. Meet your Market Researcher.
        </p>
      </div>

      <div
        className="space-y-4 rounded-xl p-5"
        style={{
          background: 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.2)',
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-accent-300">Open Position</div>
            <div className="text-lg font-semibold text-white">Market Researcher</div>
            <div className="mt-0.5 text-xs text-white/40">Research Department · Junior · Semi-Autonomous</div>
          </div>
          <span className="text-2xl">🔍</span>
        </div>

        <div className="space-y-1.5">
          {[
            'Monitors your competitors weekly',
            'Finds industry news automatically',
            'Reports directly to you',
            'Starts supervised, earns autonomy over time',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-sm">
              <span className="text-emerald-400 text-xs">✓</span>
              <span className="text-white/60">{item}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <div className="rounded px-2 py-1 text-xs" style={{ background: 'rgba(255,184,0,0.12)', color: '#FFB800' }}>
            Starting trust: 55%
          </div>
          <div className="rounded px-2 py-1 text-xs" style={{ background: 'rgba(99,102,241,0.15)', color: '#A5B4FC' }}>
            Supervised
          </div>
        </div>
      </div>

      <WizardInput
        label="Who should they monitor? (competitors)"
        value={state.competitors}
        onChange={value => onChange('competitors', value)}
        placeholder="Linear, Notion, Asana"
        autoFocus
      />

      <p className="-mt-2 text-xs text-white/25">Separate names with commas. You can change this later.</p>

      <PrimaryButton onClick={onNext} disabled={!isValid} loading={loading}>
        Hire Market Researcher →
      </PrimaryButton>
    </div>
  )
}

function ConnectToolsScreen({
  onNext,
  onSkip,
}: {
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <h2 className="mb-1 text-2xl font-bold text-white">Give them a voice.</h2>
        <p className="text-sm text-white/40">Connect a channel so your agent can reach you with findings.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          {
            name: 'Slack',
            icon: '💬',
            description: 'Weekly reports in your team channel',
          },
          {
            name: 'Gmail',
            icon: '📧',
            description: 'Reports sent to your inbox',
          },
        ].map(tool => (
          <div
            key={tool.name}
            className="rounded-xl border border-white/8 bg-white/[0.03] p-4 text-center transition-all duration-150"
          >
            <div className="text-2xl">{tool.icon}</div>
            <div className="mt-2 text-sm font-medium text-white/80">{tool.name}</div>
            <div className="mt-1 text-xs leading-snug text-white/35">{tool.description}</div>
            <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-white/20">Connect later in Integrations</div>
          </div>
        ))}
      </div>

      <PrimaryButton onClick={onNext}>Continue →</PrimaryButton>

      <button onClick={onSkip} className="w-full py-1 text-center text-xs text-white/25 transition-colors hover:text-white/40">
        Skip for now — I'll connect tools later
      </button>
    </div>
  )
}

function FirstRunScreen({
  executionId,
  onComplete,
  onStartRun,
  onRunFinished,
  runStarted,
  runFinished,
  loading,
}: {
  executionId: string | null
  onComplete: () => void
  onStartRun: () => void
  onRunFinished: () => void
  runStarted: boolean
  runFinished: boolean
  loading: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="text-center">
        <h2 className="mb-1 text-2xl font-bold text-white">Watch them work.</h2>
        <p className="text-sm text-white/40">Your Market Researcher is running their first analysis — live.</p>
      </div>

      {!runStarted ? (
        <div className="space-y-4 py-8 text-center">
          <div className="text-5xl">🔍</div>
          <p className="text-white/50">Ready to research your competitors</p>
          <div className="mx-auto max-w-xs">
            <PrimaryButton onClick={onStartRun} loading={loading}>Start first run →</PrimaryButton>
          </div>
        </div>
      ) : executionId ? (
        <>
          <ExecutionLiveView
            executionId={executionId}
            agentName="Market Researcher"
            maxHeight="400px"
            onComplete={onRunFinished}
            onError={onRunFinished}
          />

          <div className="space-y-1 text-center">
            <p className="text-xs text-white/30">Your first agent is live. You can refine its scope anytime.</p>
            <p className="text-xs text-white/20">As trust grows, this role can take on more autonomy.</p>
          </div>

          {runFinished ? (
            <PrimaryButton onClick={onComplete}>Explore your company →</PrimaryButton>
          ) : (
            <div className="text-center text-xs text-white/30">
              Waiting for the first run to finish before opening your company dashboard.
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent-400" />
        </div>
      )}
    </div>
  )
}

function OnboardingLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-obsidian-950 text-slate-300">
      <div className="rounded-2xl border border-white/10 bg-obsidian-900 px-6 py-5 text-center shadow-glow-sm">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Loading company OS</p>
      </div>
    </div>
  )
}

export function OnboardingWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const [screen, setScreen] = useState<Screen>('welcome')
  const [direction, setDirection] = useState(1)
  const [loading, setLoading] = useState(false)
  const [runStarted, setRunStarted] = useState(false)
  const [runFinished, setRunFinished] = useState(false)
  const [hasHydrated, setHasHydrated] = useState(false)
  const [state, setState] = useState<WizardState>({
    companyName: '',
    companyDescription: '',
    primaryChallenge: '',
    competitors: '',
    deliveryMethod: 'Show me the report here',
    installedAgentId: null,
    installedWorkflowId: null,
    firstExecutionId: null,
  })

  const statusQuery = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: onboardingApi.status,
    staleTime: 5_000,
  })

  useEffect(() => {
    if (!statusQuery.data || hasHydrated) return
    setState(prev => ({
      ...prev,
      companyName: statusQuery.data.company_name && statusQuery.data.company_name !== 'My Company'
        ? statusQuery.data.company_name
        : prev.companyName,
    }))
    setScreen(mapBackendStep(statusQuery.data.current_step))
    setHasHydrated(true)
  }, [statusQuery.data, hasHydrated])

  const onChange = useCallback((key: keyof WizardState, value: string) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  const goTo = useCallback((next: Screen) => {
    const currentIdx = SCREENS.indexOf(screen)
    const nextIdx = SCREENS.indexOf(next)
    setDirection(nextIdx > currentIdx ? 1 : -1)
    setScreen(next)
  }, [screen])

  const handleCompanySubmit = async () => {
    setLoading(true)
    try {
      await onboardingApi.saveCompany({
        company_name: state.companyName,
        company_description: state.companyDescription,
        primary_challenge: state.primaryChallenge || 'building_product',
      })
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      goTo('hire_agent')
    } finally {
      setLoading(false)
    }
  }

  const handleHireAgent = async () => {
    setLoading(true)
    try {
      const result = await onboardingApi.hireFirstAgent({
        listing_slug: 'market-researcher',
        competitors: state.competitors,
        delivery_method: state.deliveryMethod,
      })
      setState(prev => ({
        ...prev,
        installedAgentId: result.agent_id,
        installedWorkflowId: result.workflow_id,
      }))
      await queryClient.invalidateQueries({ queryKey: ['agents'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      goTo('connect_tools')
    } finally {
      setLoading(false)
    }
  }

  const handleStartRun = async () => {
    if (!state.installedWorkflowId) return
    setLoading(true)
    setRunStarted(true)
    setRunFinished(false)
    try {
      const result = await executionsApi.run(
        state.installedWorkflowId,
        `Research the competitive landscape for ${state.companyName || 'our company'}.\n\nCompetitors: ${state.competitors}.\n\nFocus on pricing changes, new features, job postings, and customer sentiment. Show me the report here.`,
      )
      toast.info('Run started')
      setState(prev => ({ ...prev, firstExecutionId: result.execution_id }))
      await queryClient.invalidateQueries({ queryKey: ['executions'] })
    } finally {
      setLoading(false)
    }
  }

  const completeFlow = async (skip = false) => {
    setLoading(true)
    try {
      if (skip) {
        await onboardingApi.skip()
      } else {
        await onboardingApi.complete()
      }
      queryClient.setQueryData(['onboarding-status'], (current: OnboardingStatus | undefined) => ({
        onboarding_completed: true,
        onboarding_complete: true,
        current_step: 'complete',
        company_name: current?.company_name || state.companyName,
        has_agents: true,
        has_integrations: current?.has_integrations || false,
      }))
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['agents'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      navigate('/dashboard', { replace: true })
    } finally {
      setLoading(false)
    }
  }

  const currentIndex = useMemo(() => SCREENS.indexOf(screen), [screen])

  if (statusQuery.isLoading && !hasHydrated) {
    return <OnboardingLoader />
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#06080F]">
      {screen !== 'welcome' && (
        <div className="flex items-center justify-between px-6 pt-6">
          <button
            onClick={() => {
              if (currentIndex > 0) goTo(SCREENS[currentIndex - 1])
            }}
            className="text-sm text-white/25 transition-colors hover:text-white/50"
          >
            ← Back
          </button>
          <ProgressDots current={screen} />
          <button
            onClick={() => void completeFlow(true)}
            className="text-xs text-white/20 transition-colors hover:text-white/40"
          >
            Skip all
          </button>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={screen}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="w-full"
          >
            {screen === 'welcome' && (
              <WelcomeScreen
                onNext={() => goTo('company_identity')}
                onUseDifferentAccount={() => {
                  auth.logout()
                  navigate('/login', { replace: true })
                }}
              />
            )}
            {screen === 'company_identity' && (
              <CompanyIdentityScreen state={state} onChange={onChange} onNext={handleCompanySubmit} loading={loading} />
            )}
            {screen === 'hire_agent' && (
              <HireAgentScreen state={state} onChange={onChange} onNext={handleHireAgent} loading={loading} />
            )}
            {screen === 'connect_tools' && (
              <ConnectToolsScreen onNext={() => goTo('first_run')} onSkip={() => goTo('first_run')} />
            )}
            {screen === 'first_run' && (
              <FirstRunScreen
                executionId={state.firstExecutionId}
                onComplete={() => void completeFlow(false)}
                onStartRun={handleStartRun}
                onRunFinished={() => setRunFinished(true)}
                runStarted={runStarted}
                runFinished={runFinished}
                loading={loading}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Briefcase,
  CheckCircle2,
  Eye,
  Headset,
  Loader2,
  PenSquare,
  Search,
  Send,
  Shield,
  Sparkles,
} from 'lucide-react'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { executionsApi, extractApiError, onboardingApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { OnboardingStatus } from '../types'

type Screen = 'welcome' | 'agency_setup' | 'first_agent' | 'first_run'

interface WizardState {
  agencyName: string
  whatYouDo: string
  howManyClients: string
  biggestTimeSink: string
  competitors: string
  personaName: string
  installedAgentId: string | null
  installedWorkflowId: string | null
  firstExecutionId: string | null
}

const SCREENS: Screen[] = ['welcome', 'agency_setup', 'first_agent', 'first_run']
const TERMINAL_ONBOARDING_RUN_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'rejected',
])

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 36 : -36,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -28 : 28,
    opacity: 0,
  }),
}

const transition = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 28,
}

const CLIENT_COUNTS = ['Just starting', '1–5 clients', '6–20 clients', '20+ clients']
const TIME_SINKS = ['Research', 'Content Creation', 'Outreach', 'Reporting', 'Client Support', 'Other']

const AGENT_RECOMMENDATIONS = {
  Research: {
    listingSlug: 'market-researcher',
    name: 'Market Researcher',
    role: 'Research Agent',
    defaultName: 'Maya',
    description:
      'Tracks competitors, pricing shifts, and market movement for your client accounts.',
    setupTime: '2 minutes',
    icon: Search,
    competitorsPlaceholder: 'Acme, Notion, Linear',
  },
  'Content Creation': {
    listingSlug: 'content-writer',
    name: 'Content Writer',
    role: 'Content Strategist',
    defaultName: 'Alex',
    description:
      'Drafts client-ready content, campaign angles, and structured deliverables from your service brief.',
    setupTime: '3 minutes',
    icon: PenSquare,
    competitorsPlaceholder: 'HubSpot, Ahrefs, Semrush',
  },
  Outreach: {
    listingSlug: 'lead-qualifier',
    name: 'Lead Qualifier',
    role: 'Outreach Operator',
    defaultName: 'Jordan',
    description:
      'Prepares outreach research, lead notes, and qualification signals for your client pipelines.',
    setupTime: '2 minutes',
    icon: Send,
    competitorsPlaceholder: 'Apollo, Clay, Instantly',
  },
  Reporting: {
    listingSlug: 'market-researcher',
    name: 'Reporting Analyst',
    role: 'Reporting Agent',
    defaultName: 'Harper',
    description:
      'Turns scattered updates into clean, client-friendly summaries your team can send with confidence.',
    setupTime: '2 minutes',
    icon: BarChart3,
    competitorsPlaceholder: 'Databox, DashThis, Looker Studio',
  },
  'Client Support': {
    listingSlug: 'support-triage',
    name: 'Support Triage',
    role: 'Support Analyst',
    defaultName: 'Noa',
    description:
      'Sorts urgent issues, drafts replies, and helps your team stay responsive to client needs.',
    setupTime: '2 minutes',
    icon: Headset,
    competitorsPlaceholder: 'Zendesk, Intercom, Help Scout',
  },
  Other: {
    listingSlug: 'market-researcher',
    name: 'Market Researcher',
    role: 'Research Agent',
    defaultName: 'Maya',
    description:
      'Gives your agency a dependable first operator for research, monitoring, and weekly insight.',
    setupTime: '2 minutes',
    icon: Bot,
    competitorsPlaceholder: 'Linear, Notion, Asana',
  },
} as const

function mapBackendStep(step: string | undefined): Screen {
  if (step === 'hire_agent') return 'first_agent'
  if (step === 'connect_tools' || step === 'first_run') return 'first_run'
  return 'welcome'
}

function OnboardingLoader() {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#050914] text-slate-300">
      <AuroraBackdrop />
      <div className="relative z-10 rounded-3xl border border-white/[0.08] bg-white/[0.04] px-6 py-5 text-center backdrop-blur-xl">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#8B9DBE]">
          Loading agency setup
        </p>
      </div>
    </div>
  )
}

function AuroraBackdrop() {
  return (
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
  )
}

function StepFrame({ children }: { children: ReactNode }) {
  return <div className="w-full">{children}</div>
}

function SectionCard({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.09] bg-white/[0.04] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  )
}

function PillButton({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      style={{
        borderColor: selected ? 'rgba(37,99,235,0.6)' : 'rgba(255,255,255,0.09)',
        background: selected ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.03)',
        color: selected ? '#93C5FD' : '#8B9DBE',
      }}
    >
      {label}
    </button>
  )
}

function WelcomeStep({
  onNext,
  onUseDifferentAccount,
}: {
  onNext: () => void
  onUseDifferentAccount: () => void
}) {
  const values = [
    { icon: Briefcase, text: 'Client workspaces' },
    { icon: Shield, text: 'Agent oversight' },
    { icon: BarChart3, text: 'Client portals' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="mx-auto max-w-2xl text-center"
    >
      <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-[0_0_40px_rgba(37,99,235,0.5)]">
        <Briefcase size={32} className="text-white" />
      </div>

      <h1 className="text-5xl font-extrabold tracking-tight text-white md:text-6xl">
        Your AI agency
        <br />
        <span className="bg-gradient-to-r from-blue-400 via-blue-300 to-emerald-400 bg-clip-text text-transparent">
          starts right here.
        </span>
      </h1>

      <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-[#8B9DBE]">
        Deploy AI agents for your clients. Keep full control. Share transparent
        reports. All in one place.
      </p>

      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        {values.map(({ icon: Icon, text }, index) => (
          <motion.div
            key={text}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 + index * 0.12 }}
            className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-[#F0F6FF]"
          >
            <Icon size={15} className="text-blue-400" />
            {text}
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="mt-10 space-y-3"
      >
        <button type="button" onClick={onNext} className="btn-primary h-14 px-10 text-base">
          Set up my agency
          <ArrowRight size={18} />
        </button>
        <div>
          <button
            type="button"
            onClick={onUseDifferentAccount}
            className="cursor-pointer rounded-xl px-4 py-2 text-sm text-[#8B9DBE] transition-colors duration-150 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            Using the wrong account? Sign out
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function AgencySetupStep({
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
  const canProceed = state.agencyName.trim().length > 0 && state.whatYouDo.trim().length > 0

  return (
    <motion.div className="grid w-full max-w-4xl gap-8 lg:grid-cols-2">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Tell us about
          <br />
          your agency
        </h2>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          This shapes how your workspace is configured.
        </p>

        <div className="mt-8 space-y-5">
          <div>
            <label className="label">Agency Name</label>
            <input
              className="input"
              placeholder="Maya's AI Agency"
              value={state.agencyName}
              onChange={event => onChange('agencyName', event.target.value)}
            />
          </div>

          <div>
            <label className="label">What services do you provide?</label>
            <textarea
              className="input min-h-[80px] resize-none"
              placeholder="Content marketing for SaaS companies..."
              value={state.whatYouDo}
              onChange={event => onChange('whatYouDo', event.target.value)}
            />
          </div>

          <div>
            <label className="label">How many clients right now?</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CLIENT_COUNTS.map(option => (
                <PillButton
                  key={option}
                  label={option}
                  selected={state.howManyClients === option}
                  onClick={() => onChange('howManyClients', option)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="label">What takes the most time?</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIME_SINKS.map(option => (
                <PillButton
                  key={option}
                  label={option === 'Content Creation' ? 'Content' : option === 'Client Support' ? 'Support' : option}
                  selected={state.biggestTimeSink === option}
                  onClick={() => onChange('biggestTimeSink', option)}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            className="btn-primary mt-2 h-12 w-full"
            onClick={onNext}
            disabled={!canProceed || loading}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Continue
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>

      <div className="hidden lg:block">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#4B5A73]">
          Preview — Client Portal
        </p>
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <SectionCard className="overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#4B5A73]">Managed by</p>
                  <p className="text-sm font-bold text-white">
                    {state.agencyName || 'Your Agency'}
                  </p>
                </div>
                <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              </div>
            </div>
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#4B5A73]">
                Recent Work
              </p>
              <div className="mt-3 space-y-3">
                {[
                  'Research competitor landscape',
                  'Draft Q2 content strategy',
                  'Analyze engagement metrics',
                ].map((task, index) => (
                  <div key={task} className="flex items-center gap-3">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        background:
                          index === 0 ? '#10B981' : index === 1 ? '#3B82F6' : '#F59E0B',
                      }}
                    />
                    <div
                      className="h-3 rounded-full bg-white/[0.06]"
                      style={{ width: `${80 - index * 12}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </motion.div>
        <p className="mt-3 text-center text-xs text-[#4B5A73]">
          Your clients see a portal like this — no login required.
        </p>
      </div>
    </motion.div>
  )
}

function FirstAgentStep({
  state,
  onChange,
  onDeploy,
  loading,
}: {
  state: WizardState
  onChange: (key: keyof WizardState, value: string) => void
  onDeploy: () => void
  loading: boolean
}) {
  const recommendedAgent =
    AGENT_RECOMMENDATIONS[state.biggestTimeSink as keyof typeof AGENT_RECOMMENDATIONS] ||
    AGENT_RECOMMENDATIONS.Other
  const Icon = recommendedAgent.icon

  return (
    <div className="mx-auto w-full max-w-lg text-center">
      <h2 className="text-3xl font-extrabold tracking-tight text-white">
        Deploy your first AI agent
      </h2>
      <p className="mt-2 text-sm text-[#8B9DBE]">
        Based on your biggest time sink, we recommend:
      </p>

      <motion.div
        whileHover={{ scale: 1.02 }}
        className="mt-8 overflow-hidden rounded-2xl text-left"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(37,99,235,0.25)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 0 40px rgba(37,99,235,0.12)',
        }}
      >
        <div className="bg-gradient-to-r from-blue-600/20 to-emerald-600/10 px-6 pb-4 pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-blue-300">
              <Icon size={28} />
            </div>
            <div>
              <p className="text-xl font-extrabold text-white">{recommendedAgent.name}</p>
              <p className="text-sm text-blue-400">{recommendedAgent.role}</p>
            </div>
            <div className="ml-auto rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
              Recommended
            </div>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm leading-6 text-[#8B9DBE]">{recommendedAgent.description}</p>
          <div className="mt-4 flex items-center gap-2 text-xs text-[#4B5A73]">
            <CheckCircle2 size={13} className="text-emerald-500" />
            Setup time: {recommendedAgent.setupTime}
          </div>
        </div>
      </motion.div>

      <div className="mt-5">
        <label className="label text-left">Give it a name (optional)</label>
        <input
          className="input text-center"
          placeholder={recommendedAgent.defaultName}
          value={state.personaName}
          onChange={event => onChange('personaName', event.target.value)}
        />
      </div>

      <div className="mt-4">
        <label className="label text-left">What should it focus on first?</label>
        <input
          className="input text-center"
          placeholder={recommendedAgent.competitorsPlaceholder}
          value={state.competitors}
          onChange={event => onChange('competitors', event.target.value)}
        />
      </div>

      <button
        type="button"
        className="btn-primary mt-6 h-12 w-full"
        onClick={onDeploy}
        disabled={!state.competitors.trim() || loading}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Deploying...
          </>
        ) : (
          <>
            Deploy {state.personaName.trim() || recommendedAgent.defaultName}
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </div>
  )
}

function FirstRunStep({
  executionId,
  loading,
  runFinished,
  onComplete,
  onRunFinished,
}: {
  executionId: string | null
  loading: boolean
  runFinished: boolean
  onComplete: () => void
  onRunFinished: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600/20 ring-1 ring-emerald-500/30">
          <Sparkles size={24} className="text-emerald-400" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Your agent is working
        </h2>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          Watch your first AI agent run. This is exactly what happens when it works
          for your clients.
        </p>
      </div>

      {executionId ? (
        <ExecutionLiveView
          executionId={executionId}
          onComplete={onRunFinished}
          onError={onRunFinished}
        />
      ) : (
        <SectionCard className="p-6">
          <div className="flex min-h-[280px] items-center justify-center">
            <div className="flex items-center gap-3 text-sm text-[#8B9DBE]">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-blue-500" />
              {loading ? 'Starting your first run...' : 'Preparing your first run...'}
            </div>
          </div>
        </SectionCard>
      )}

      {runFinished && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-6 overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06]"
        >
          <div className="flex items-center gap-3 px-5 py-4">
            <CheckCircle2 size={20} className="text-emerald-400" />
            <p className="font-semibold text-white">First run complete!</p>
          </div>
          <div className="px-5 pb-4">
            <p className="text-sm text-[#8B9DBE]">
              Your AI agency is ready. Let&apos;s build it out.
            </p>
            <button type="button" className="btn-primary mt-4 h-12 w-full" onClick={onComplete}>
              Open my agency dashboard
              <ArrowRight size={16} />
            </button>
          </div>
        </motion.div>
      )}
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
  const [runFinished, setRunFinished] = useState(false)
  const [hasHydrated, setHasHydrated] = useState(false)
  const [state, setState] = useState<WizardState>({
    agencyName: '',
    whatYouDo: '',
    howManyClients: 'Just starting',
    biggestTimeSink: 'Research',
    competitors: '',
    personaName: '',
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
      agencyName:
        statusQuery.data.company_name && statusQuery.data.company_name !== 'My Company'
          ? statusQuery.data.company_name
          : prev.agencyName,
      installedAgentId: statusQuery.data.latest_agent_id || prev.installedAgentId,
      installedWorkflowId: statusQuery.data.latest_workflow_id || prev.installedWorkflowId,
      firstExecutionId: statusQuery.data.latest_execution_id || prev.firstExecutionId,
    }))

    if (statusQuery.data.current_step && statusQuery.data.current_step !== 'company_identity') {
      setScreen(mapBackendStep(statusQuery.data.current_step))
    }

    if (
      statusQuery.data.latest_execution_status &&
      TERMINAL_ONBOARDING_RUN_STATUSES.has(statusQuery.data.latest_execution_status)
    ) {
      setRunFinished(true)
    }

    setHasHydrated(true)
  }, [statusQuery.data, hasHydrated])

  const goTo = useCallback(
    (next: Screen) => {
      const currentIndex = SCREENS.indexOf(screen)
      const nextIndex = SCREENS.indexOf(next)
      setDirection(nextIndex >= currentIndex ? 1 : -1)
      setScreen(next)
    },
    [screen],
  )

  const onChange = useCallback((key: keyof WizardState, value: string) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  const recommendation = useMemo(
    () =>
      AGENT_RECOMMENDATIONS[state.biggestTimeSink as keyof typeof AGENT_RECOMMENDATIONS] ||
      AGENT_RECOMMENDATIONS.Other,
    [state.biggestTimeSink],
  )

  const runInput = useMemo(() => {
    const company = state.agencyName || 'our agency'
    const targets = state.competitors || 'the key accounts and competitors we should monitor'
    return [
      `This is the onboarding kickoff run for ${company}.`,
      '',
      `Client focus: ${targets}.`,
      `Services: ${state.whatYouDo}.`,
      '',
      'For this onboarding preview, do not use any external tools or live searches.',
      'Instead, produce a polished client-facing kickoff update that shows how you would approach the work.',
      '',
      'Format the response with these headings:',
      'Accomplished',
      'In Progress',
      'Next Steps',
      '',
      'Keep it concise, professional, and ready to show in a client portal.',
    ].join('\n')
  }, [state.agencyName, state.competitors, state.whatYouDo])

  const handleAgencySubmit = async () => {
    setLoading(true)
    try {
      await onboardingApi.saveCompany({
        agency_name: state.agencyName,
        what_you_do: state.whatYouDo,
        how_many_clients: state.howManyClients,
        biggest_time_sink: state.biggestTimeSink,
      })
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      goTo('first_agent')
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setLoading(false)
    }
  }

  const handleDeployAgent = async () => {
    setLoading(true)
    try {
      const result = await onboardingApi.hireFirstAgent({
        listing_slug: recommendation.listingSlug,
        competitors: state.competitors,
        delivery_method: 'Show me the report here',
        persona_name: state.personaName.trim() || null,
      })
      setState(prev => ({
        ...prev,
        installedAgentId: result.agent_id,
        installedWorkflowId: result.workflow_id,
      }))
      await queryClient.invalidateQueries({ queryKey: ['agents'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      goTo('first_run')
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (screen !== 'first_run' || !state.installedWorkflowId || state.firstExecutionId || loading) {
      return
    }

    let cancelled = false

    const startRun = async () => {
      setLoading(true)
      try {
        const result = await executionsApi.run(state.installedWorkflowId!, runInput)
        if (!cancelled) {
          setState(prev => ({ ...prev, firstExecutionId: result.execution_id }))
          await queryClient.invalidateQueries({ queryKey: ['executions'] })
          await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(extractApiError(error))
          setRunFinished(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void startRun()

    return () => {
      cancelled = true
    }
  }, [screen, state.installedWorkflowId, state.firstExecutionId, loading, runInput, queryClient])

  const completeFlow = async (skip = false) => {
    setLoading(true)
    try {
      if (skip) {
        await onboardingApi.skip()
      } else {
        await onboardingApi.complete()
      }
      queryClient.setQueryData(
        ['onboarding-status'],
        (current: OnboardingStatus | undefined) => ({
          onboarding_completed: true,
          onboarding_complete: true,
          current_step: 'complete',
          company_name: current?.company_name || state.agencyName,
          has_agents: true,
          has_integrations: current?.has_integrations || false,
        }),
      )
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      await queryClient.invalidateQueries({ queryKey: ['agency-overview'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['agents'] })
      await queryClient.invalidateQueries({ queryKey: ['workflows'] })
      navigate('/', { replace: true })
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setLoading(false)
    }
  }

  const currentIndex = SCREENS.indexOf(screen)
  const progressPercent = ((currentIndex + 1) / SCREENS.length) * 100

  if (statusQuery.isLoading && !hasHydrated) {
    return <OnboardingLoader />
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050914]">
      <AuroraBackdrop />

      <motion.div
        className="fixed left-0 top-0 z-50 h-[2px] bg-gradient-to-r from-blue-600 to-emerald-500"
        animate={{ width: `${progressPercent}%` }}
        transition={{ duration: 0.4 }}
      />

      {screen !== 'welcome' && (
        <div className="relative z-20 flex items-center justify-between px-6 pt-6 sm:px-8">
          {screen === 'agency_setup' || screen === 'first_agent' ? (
            <button
              type="button"
              onClick={() => currentIndex > 0 && goTo(SCREENS[currentIndex - 1])}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#8B9DBE] transition-colors duration-150 hover:bg-white/[0.04] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <ArrowLeft size={14} />
              Back
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => void completeFlow(true)}
            className="cursor-pointer rounded-xl px-3 py-2 text-xs uppercase tracking-[0.18em] text-[#4B5A73] transition-colors duration-150 hover:text-[#8B9DBE] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            Skip
          </button>
        </div>
      )}

      <div className="relative flex min-h-screen flex-col items-center justify-center px-6 py-20">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={screen}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="relative z-10 w-full"
          >
            <StepFrame>
              {screen === 'welcome' && (
                <WelcomeStep
                  onNext={() => goTo('agency_setup')}
                  onUseDifferentAccount={() => {
                    auth.logout()
                    navigate('/login', { replace: true })
                  }}
                />
              )}

              {screen === 'agency_setup' && (
                <AgencySetupStep
                  state={state}
                  onChange={onChange}
                  onNext={handleAgencySubmit}
                  loading={loading}
                />
              )}

              {screen === 'first_agent' && (
                <FirstAgentStep
                  state={state}
                  onChange={onChange}
                  onDeploy={handleDeployAgent}
                  loading={loading}
                />
              )}

              {screen === 'first_run' && (
                <FirstRunStep
                  executionId={state.firstExecutionId}
                  loading={loading}
                  runFinished={runFinished}
                  onComplete={() => void completeFlow(false)}
                  onRunFinished={() => setRunFinished(true)}
                />
              )}
            </StepFrame>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

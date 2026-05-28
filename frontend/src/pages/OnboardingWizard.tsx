import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Headset,
  Loader2,
  PenSquare,
  Search,
  Send,
  Sparkles,
  Zap,
} from 'lucide-react'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { FloatingField } from '../components/AuthShell'
import { MarkdownContent } from '../components/ui/MarkdownContent'
import { ShimmerButton } from '../components/ui/magicui/ShimmerButton'
import { agentsApi, executionsApi, extractApiError, onboardingApi, workflowsApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { Execution, OnboardingStatus } from '../types'

type Screen = 'intro' | 'demo' | 'agency' | 'team' | 'ready'
type WorkType = 'Research' | 'Content Creation' | 'Outreach' | 'Reporting' | 'Client Support' | 'Other'

interface WizardState {
  agencyName: string
  whatYouDo: string
  howManyClients: string
  selectedWorkType: WorkType
  selectedListingSlug: string
  demoTopic: string
  demoAgentId: string | null
  demoWorkflowId: string | null
  demoExecutionId: string | null
  demoCompleted: boolean
  installedAgentId: string | null
  installedWorkflowId: string | null
}

interface PersistedWizardState {
  screen: Screen
  state: WizardState
}

const PRODUCT_STATEMENT = 'Your AI agency team. Handles the repeatable work. You approve before anything reaches clients.'
const STORAGE_PREFIX = 'aethon-onboarding-state'
const DEMO_LISTING_SLUG = 'market-researcher'
const SCREENS: Screen[] = ['intro', 'demo', 'agency', 'team', 'ready']
const TERMINAL_DEMO_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'rejected', 'pending_review'])
const SUCCESSFUL_DEMO_STATUSES = new Set(['completed', 'pending_review'])
const DEMO_PRESETS = ['OpenAI', 'Shopify', 'My competitor', 'Custom...'] as const
const WORK_TYPE_OPTIONS: WorkType[] = ['Research', 'Content Creation', 'Outreach', 'Reporting', 'Client Support']

const slideVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 56 : -56,
    scale: 0.98,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -40 : 40,
    scale: 0.98,
  }),
}

const transition = {
  type: 'spring' as const,
  stiffness: 240,
  damping: 28,
}

const PANEL_MAX_WIDTHS: Record<Screen, string> = {
  intro: 'max-w-5xl',
  demo: 'max-w-5xl',
  agency: 'max-w-2xl',
  team: 'max-w-4xl',
  ready: 'max-w-3xl',
}

const DEFAULT_STATE: WizardState = {
  agencyName: '',
  whatYouDo: '',
  howManyClients: 'Just starting',
  selectedWorkType: 'Research',
  selectedListingSlug: DEMO_LISTING_SLUG,
  demoTopic: 'OpenAI',
  demoAgentId: null,
  demoWorkflowId: null,
  demoExecutionId: null,
  demoCompleted: false,
  installedAgentId: null,
  installedWorkflowId: null,
}

const AGENT_RECOMMENDATIONS: Record<
  WorkType,
  {
    listingSlug: string
    name: string
    role: string
    defaultName: string
    description: string
    setupTime: string
    icon: typeof Search
    accent: {
      border: string
      glow: string
      gradient: string
      iconBg: string
      iconColor: string
    }
  }
> = {
  Research: {
    listingSlug: 'market-researcher',
    name: 'Market Researcher',
    role: 'Research Agent',
    defaultName: 'Maya',
    description: 'Tracks competitors, pricing shifts, and market movement for your client accounts.',
    setupTime: '2 minutes',
    icon: Search,
    accent: {
      border: 'rgba(99,102,241,0.35)',
      glow: '0 0 36px rgba(99,102,241,0.14)',
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.08))',
      iconBg: 'rgba(99,102,241,0.16)',
      iconColor: '#A5B4FC',
    },
  },
  'Content Creation': {
    listingSlug: 'content-writer',
    name: 'Content Writer',
    role: 'Content Strategist',
    defaultName: 'Alex',
    description: 'Drafts client-ready content, campaign angles, and structured deliverables from your service brief.',
    setupTime: '3 minutes',
    icon: PenSquare,
    accent: {
      border: 'rgba(139,92,246,0.35)',
      glow: '0 0 36px rgba(139,92,246,0.14)',
      gradient: 'linear-gradient(135deg, rgba(139,92,246,0.20), rgba(99,102,241,0.08))',
      iconBg: 'rgba(139,92,246,0.16)',
      iconColor: '#C4B5FD',
    },
  },
  Outreach: {
    listingSlug: 'lead-qualifier',
    name: 'Lead Qualifier',
    role: 'Outreach Operator',
    defaultName: 'Jordan',
    description: 'Prepares outreach research, lead notes, and qualification signals for your client pipelines.',
    setupTime: '2 minutes',
    icon: Send,
    accent: {
      border: 'rgba(16,185,129,0.35)',
      glow: '0 0 36px rgba(16,185,129,0.14)',
      gradient: 'linear-gradient(135deg, rgba(16,185,129,0.22), rgba(99,102,241,0.08))',
      iconBg: 'rgba(16,185,129,0.16)',
      iconColor: '#6EE7B7',
    },
  },
  Reporting: {
    listingSlug: 'market-researcher',
    name: 'Reporting Analyst',
    role: 'Reporting Agent',
    defaultName: 'Harper',
    description: 'Turns scattered updates into clean, client-friendly summaries your team can send with confidence.',
    setupTime: '2 minutes',
    icon: BarChart3,
    accent: {
      border: 'rgba(245,158,11,0.35)',
      glow: '0 0 36px rgba(245,158,11,0.12)',
      gradient: 'linear-gradient(135deg, rgba(245,158,11,0.20), rgba(99,102,241,0.08))',
      iconBg: 'rgba(245,158,11,0.16)',
      iconColor: '#FBBF24',
    },
  },
  'Client Support': {
    listingSlug: 'support-triage',
    name: 'Support Triage',
    role: 'Support Analyst',
    defaultName: 'Noa',
    description: 'Sorts urgent issues, drafts replies, and helps your team stay responsive to client needs.',
    setupTime: '2 minutes',
    icon: Headset,
    accent: {
      border: 'rgba(59,130,246,0.35)',
      glow: '0 0 36px rgba(59,130,246,0.12)',
      gradient: 'linear-gradient(135deg, rgba(59,130,246,0.20), rgba(99,102,241,0.08))',
      iconBg: 'rgba(59,130,246,0.16)',
      iconColor: '#93C5FD',
    },
  },
  Other: {
    listingSlug: 'market-researcher',
    name: 'Market Researcher',
    role: 'Research Agent',
    defaultName: 'Maya',
    description: 'Gives your agency a dependable first operator for research, monitoring, and weekly insight.',
    setupTime: '2 minutes',
    icon: Bot,
    accent: {
      border: 'rgba(99,102,241,0.35)',
      glow: '0 0 36px rgba(99,102,241,0.14)',
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.08))',
      iconBg: 'rgba(99,102,241,0.16)',
      iconColor: '#A5B4FC',
    },
  },
}

function stepIndex(screen: Screen) {
  return SCREENS.indexOf(screen)
}

function mapBackendStep(status: OnboardingStatus): Screen {
  if (status.onboarding_completed) return 'ready'
  if (status.current_step === 'hire_agent') return 'team'
  if (status.current_step === 'first_run' || status.current_step === 'connect_tools') return 'ready'
  return 'intro'
}

function readPersistedState(storageKey: string): PersistedWizardState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    return JSON.parse(raw) as PersistedWizardState
  } catch {
    return null
  }
}

function writePersistedState(storageKey: string, value: PersistedWizardState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(value))
}

function clearPersistedState(storageKey: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(storageKey)
}

function meaningfulCompanyName(value?: string | null) {
  return Boolean(value && value.trim() && value.trim() !== 'My Company')
}

function inferWorkType(value: string): WorkType {
  const text = value.toLowerCase()
  if (/(content|copy|blog|newsletter|social|writer|creative)/.test(text)) return 'Content Creation'
  if (/(outreach|lead|sales|prospect|pipeline)/.test(text)) return 'Outreach'
  if (/(report|reporting|dashboard|analytics|metric)/.test(text)) return 'Reporting'
  if (/(support|success|help desk|customer service|inbox)/.test(text)) return 'Client Support'
  if (/(research|competitive|market|insight|analysis)/.test(text)) return 'Research'
  return 'Other'
}

function extractExecutionOutput(execution: Execution | undefined) {
  if (!execution) return ''
  if (execution.output && execution.output.trim()) return execution.output
  if (execution.output_message && execution.output_message.trim()) return execution.output_message
  const finalStep = execution.steps
    ?.filter(step => step.step_type === 'final_answer')
    .sort((a, b) => b.step_index - a.step_index)[0]
  return finalStep?.content || ''
}

function isDemoSuccessful(status?: string | null) {
  return Boolean(status && SUCCESSFUL_DEMO_STATUSES.has(status))
}

function buildDemoPrompt(topic: string) {
  return [
    `Research the company or topic: ${topic}.`,
    '',
    'Prepare a concise research brief for an agency CEO.',
    'Use current information when available.',
    '',
    'Format the response with these headings:',
    '## What they do',
    '## Recent signals',
    '## Opportunities to act',
    '',
    'Keep it direct, useful, and client-ready.',
  ].join('\n')
}

function buildDemoInputValues(topic: string) {
  const cleanTopic = topic.trim()
  return {
    company_name: 'Aethon Demo Agency',
    company_description: buildDemoPrompt(cleanTopic),
    competitors: cleanTopic,
    delivery_method: 'save the report and summarise it here',
  }
}

function FloatingTextareaField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
}) {
  const [focused, setFocused] = useState(false)
  const lifted = focused || value.length > 0

  return (
    <label className="group relative block">
      <textarea
        rows={rows}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-3.5 pb-3 pt-6 text-sm text-white outline-none transition-all duration-150"
        style={{
          minHeight: '116px',
          resize: 'none',
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${focused ? 'rgba(99,102,241,0.70)' : 'rgba(255,255,255,0.09)'}`,
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.13)' : 'none',
        }}
      />
      <span
        className="pointer-events-none absolute left-3.5 font-medium transition-all duration-200"
        style={{
          top: lifted ? '8px' : '18px',
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

function StepPill({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1, scale: 1.01 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      onClick={onClick}
      className="rounded-full border px-4 py-2 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
      style={{
        borderColor: selected ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.10)',
        background: selected ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.04)',
        color: selected ? '#C7D2FE' : '#8B9DBE',
        boxShadow: selected ? '0 0 0 1px rgba(99,102,241,0.12), 0 0 20px rgba(99,102,241,0.08)' : 'none',
      }}
    >
      {label}
    </motion.button>
  )
}

function StepShell({
  screen,
  children,
}: {
  screen: Screen
  children: ReactNode
}) {
  if (screen === 'intro') {
    return <div className={`mx-auto w-full ${PANEL_MAX_WIDTHS[screen]}`}>{children}</div>
  }

  return (
    <div className={`card mx-auto w-full rounded-[28px] p-5 sm:p-8 lg:p-10 ${PANEL_MAX_WIDTHS[screen]}`}>
      {children}
    </div>
  )
}

function IntroStep({
  onNext,
}: {
  onNext: () => void
}) {
  return (
    <div className="mx-auto max-w-4xl text-center">
      <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-[22px] border border-indigo-500/30 bg-indigo-500/12 shadow-[0_0_30px_rgba(99,102,241,0.20)]">
        <Zap size={30} className="text-indigo-300" />
      </div>

      <h1
        className="font-extrabold leading-[1.02] tracking-[-0.05em] text-white"
        style={{ fontSize: 'clamp(40px, 6vw, 52px)' }}
      >
        Your AI agency team.
      </h1>

      <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#AAB5C8] sm:text-lg">
        Handles the repeatable work. You approve before anything reaches clients.
      </p>

      <div className="mx-auto mt-10 max-w-xl space-y-4 text-left">
        {[
          'Research briefs ready in minutes',
          'Client reports that write themselves',
          'You approve before anything goes out',
        ].map(line => (
          <div key={line} className="flex items-center gap-3 text-base text-white/88">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />
            <span>{line}</span>
          </div>
        ))}
      </div>

      <button type="button" onClick={onNext} className="btn-runner btn-primary btn-lg mt-12 px-8">
        See it in action
        <ArrowRight size={18} />
      </button>
    </div>
  )
}

function DemoStep({
  topic,
  onTopicChange,
  onPickPreset,
  onStart,
  submitting,
  executionId,
  execution,
  demoResult,
  onExecutionComplete,
  onExecutionError,
  onContinue,
}: {
  topic: string
  onTopicChange: (value: string) => void
  onPickPreset: (value: string) => void
  onStart: () => void
  submitting: boolean
  executionId: string | null
  execution?: Execution
  demoResult: string
  onExecutionComplete: (result: string) => void
  onExecutionError: () => void
  onContinue: () => void
}) {
  const output = extractExecutionOutput(execution) || demoResult
  const status = execution?.status
  const isComplete = isDemoSuccessful(status)
  const isFailed = Boolean(status && ['failed', 'cancelled', 'timed_out', 'rejected'].includes(status))

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/14 ring-1 ring-indigo-500/25">
          <Sparkles size={24} className="text-indigo-300" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Watch your first agent work</h2>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          Pick a topic. We&apos;ll research it right now.
        </p>
      </div>

      <div className="mt-8 rounded-[26px] border border-white/[0.08] bg-white/[0.03] p-5">
        <FloatingField
          label="Research topic or company name..."
          type="text"
          value={topic}
          onChange={onTopicChange}
        />

        <div className="mt-4 flex flex-wrap gap-2.5">
          {DEMO_PRESETS.map(preset => (
            <StepPill
              key={preset}
              label={preset}
              selected={preset !== 'Custom...' && topic.trim().toLowerCase() === preset.toLowerCase()}
              onClick={() => onPickPreset(preset)}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ShimmerButton
            type="button"
            onClick={onStart}
            disabled={!topic.trim() || submitting}
            className="h-12 rounded-xl bg-indigo-600 px-6 text-sm font-semibold"
            background="rgba(79,70,229,1)"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Start research
            <ArrowRight size={16} />
          </ShimmerButton>
          <span className="text-xs text-[#6D7891]">This uses a real research run and streams live in the page.</span>
        </div>
      </div>

      {executionId ? (
        <div className="mt-6 space-y-5">
          <div className="card overflow-hidden rounded-[24px] p-3 sm:p-4">
            <ExecutionLiveView
              executionId={executionId}
              onComplete={onExecutionComplete}
              onError={onExecutionError}
            />
          </div>

          {isComplete && output.trim() ? (
            <div className="card rounded-[24px] border border-emerald-500/18 bg-emerald-500/[0.06] p-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={18} className="text-emerald-400" />
                <p className="font-semibold text-white">Your first research brief is ready.</p>
              </div>
              <div className="mt-4 border-t border-white/[0.08] pt-4">
                <MarkdownContent content={output} className="text-sm" />
              </div>
              <button type="button" className="btn-primary btn-lg mt-5" onClick={onContinue}>
                Continue setup
                <ArrowRight size={16} />
              </button>
            </div>
          ) : null}

          {isFailed ? (
            <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">
              The research run stopped before finishing. Update the topic and try again.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AgencyStep({
  state,
  onChange,
  onContinue,
  loading,
}: {
  state: WizardState
  onChange: (key: keyof WizardState, value: string) => void
  onContinue: () => void
  loading: boolean
}) {
  const canContinue = state.agencyName.trim().length > 0 && state.whatYouDo.trim().length > 0

  return (
    <div className="mx-auto w-full max-w-xl text-center">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#4B5A73]">Step 3</p>
      <h2 className="text-3xl font-extrabold tracking-tight text-white">Name your agency</h2>
      <p className="mt-2 text-sm text-[#8B9DBE]">
        We&apos;ll use this to personalize the rest of your workspace.
      </p>

      <div className="mt-8 space-y-5 text-left">
        <FloatingField
          label="Your agency name"
          type="text"
          value={state.agencyName}
          onChange={value => onChange('agencyName', value)}
        />
        <FloatingTextareaField
          label="What kind of work do you do?"
          value={state.whatYouDo}
          onChange={value => onChange('whatYouDo', value)}
        />
      </div>

      <button
        type="button"
        className="btn-primary btn-lg mt-8 w-full justify-center"
        onClick={onContinue}
        disabled={!canContinue || loading}
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
  )
}

function TeamStep({
  selectedWorkType,
  onSelectWorkType,
  onDeploy,
  loading,
  demoReady,
}: {
  selectedWorkType: WorkType
  onSelectWorkType: (workType: WorkType) => void
  onDeploy: () => void
  loading: boolean
  demoReady: boolean
}) {
  const recommendation = AGENT_RECOMMENDATIONS[selectedWorkType]
  const Icon = recommendation.icon
  const isReuse = demoReady && recommendation.listingSlug === DEMO_LISTING_SLUG

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="text-center">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#4B5A73]">Step 4</p>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Your first team member</h2>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          We matched a template to the kind of work you do. You can change it before deploying.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {WORK_TYPE_OPTIONS.map(option => (
          <StepPill
            key={option}
            label={option === 'Content Creation' ? 'Content' : option === 'Client Support' ? 'Support' : option}
            selected={selectedWorkType === option}
            onClick={() => onSelectWorkType(option)}
          />
        ))}
      </div>

      <motion.div
        whileHover={{ y: -2, scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="mt-8 overflow-hidden rounded-[26px] border bg-white/[0.03] backdrop-blur-xl"
        style={{
          borderColor: recommendation.accent.border,
          boxShadow: recommendation.accent.glow,
        }}
      >
        <div className="px-6 pb-5 pt-6" style={{ background: recommendation.accent.gradient }}>
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08]"
              style={{
                background: recommendation.accent.iconBg,
                color: recommendation.accent.iconColor,
              }}
            >
              <Icon size={28} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl font-extrabold tracking-tight text-white">{recommendation.name}</p>
                <span className="badge-emerald">Recommended</span>
                {isReuse ? <span className="badge badge-indigo">Already running from demo</span> : null}
              </div>
              <p className="mt-1 text-sm" style={{ color: recommendation.accent.iconColor }}>
                {recommendation.role}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-sm leading-7 text-[#8B9DBE]">{recommendation.description}</p>
          <div className="flex items-center gap-2 text-xs text-[#8B9DBE]">
            <CheckCircle2 size={13} className="text-emerald-400" />
            Setup time: {recommendation.setupTime}
          </div>

          <button
            type="button"
            className="btn-primary btn-lg w-full justify-center"
            onClick={onDeploy}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                {isReuse ? 'Use this agent' : 'Deploy this agent'}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function ReadyStep({
  onOpenDashboard,
  onExploreProcesses,
  loading,
}: {
  onOpenDashboard: () => void
  onExploreProcesses: () => void
  loading: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-3xl text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.84, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 20 }}
        className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[22px] bg-emerald-500/14 ring-1 ring-emerald-500/26"
      >
        <CheckCircle2 size={30} className="text-emerald-400" />
      </motion.div>

      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#4B5A73]">Step 5</p>
      <h2 className="text-3xl font-extrabold tracking-tight text-white">Your agency is running.</h2>
      <p className="mt-2 text-sm text-[#8B9DBE]">
        You&apos;ve seen the result, named the agency, and deployed the first teammate.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={onOpenDashboard}
          disabled={loading}
          className="card rounded-[24px] p-5 text-left transition-all duration-150 hover:border-indigo-500/20 hover:bg-indigo-500/[0.05]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-300">
              <Zap size={20} />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">Open dashboard</div>
              <div className="mt-1 text-sm text-[#8B9DBE]">Jump into Agency OS and start operating.</div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onExploreProcesses}
          disabled={loading}
          className="card rounded-[24px] p-5 text-left transition-all duration-150 hover:border-indigo-500/20 hover:bg-indigo-500/[0.05]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-300">
              <Search size={20} />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">Explore processes</div>
              <div className="mt-1 text-sm text-[#8B9DBE]">See how repeatable work gets automated next.</div>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

export function OnboardingWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}:${auth.activeOrg?.id || auth.email || 'default'}`,
    [auth.activeOrg?.id, auth.email],
  )
  const [screen, setScreen] = useState<Screen>('intro')
  const [direction, setDirection] = useState(1)
  const [state, setState] = useState<WizardState>(DEFAULT_STATE)
  const [localHydrated, setLocalHydrated] = useState(false)
  const [statusHydrated, setStatusHydrated] = useState(false)
  const [savingAgency, setSavingAgency] = useState(false)
  const [startingDemo, setStartingDemo] = useState(false)
  const [deployingAgent, setDeployingAgent] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [demoResult, setDemoResult] = useState('')

  const statusQuery = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: onboardingApi.status,
    staleTime: 5_000,
  })

  useEffect(() => {
    const persisted = readPersistedState(storageKey)
    if (persisted) {
      setScreen(persisted.screen)
      setState(prev => ({ ...prev, ...persisted.state }))
    }
    setLocalHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!localHydrated) return
    writePersistedState(storageKey, { screen, state })
  }, [localHydrated, screen, state, storageKey])

  useEffect(() => {
    if (!statusQuery.data || !localHydrated || statusHydrated) return

    const persisted = readPersistedState(storageKey)
    const nextScreen = persisted?.screen || mapBackendStep(statusQuery.data)
    setScreen(nextScreen)
    setState(prev => ({
      ...prev,
      ...(persisted?.state || {}),
      agencyName:
        prev.agencyName ||
        persisted?.state?.agencyName ||
        (meaningfulCompanyName(statusQuery.data.company_name) ? statusQuery.data.company_name : ''),
      demoAgentId:
        persisted?.state?.demoAgentId ||
        prev.demoAgentId ||
        statusQuery.data.latest_agent_id ||
        null,
      demoWorkflowId:
        persisted?.state?.demoWorkflowId ||
        prev.demoWorkflowId ||
        statusQuery.data.latest_workflow_id ||
        null,
      demoExecutionId:
        persisted?.state?.demoExecutionId ||
        prev.demoExecutionId ||
        statusQuery.data.latest_execution_id ||
        null,
      demoCompleted:
        persisted?.state?.demoCompleted ||
        prev.demoCompleted ||
        Boolean(statusQuery.data.latest_execution_status && TERMINAL_DEMO_STATUSES.has(statusQuery.data.latest_execution_status)),
      installedAgentId:
        persisted?.state?.installedAgentId ||
        prev.installedAgentId ||
        (nextScreen === 'ready' ? statusQuery.data.latest_agent_id : null) ||
        null,
      installedWorkflowId:
        persisted?.state?.installedWorkflowId ||
        prev.installedWorkflowId ||
        (nextScreen === 'ready' ? statusQuery.data.latest_workflow_id : null) ||
        null,
    }))

    setStatusHydrated(true)
  }, [localHydrated, statusHydrated, statusQuery.data, storageKey])

  const demoExecutionId = state.demoExecutionId
  const demoExecutionQuery = useQuery({
    queryKey: ['onboarding-demo-execution', demoExecutionId],
    queryFn: () => executionsApi.get(demoExecutionId!),
    enabled: Boolean(demoExecutionId),
    refetchInterval: query => {
      const execution = query.state.data as Execution | undefined
      if (!execution?.status) return 2500
      if (TERMINAL_DEMO_STATUSES.has(execution.status)) return false
      return 2500
    },
  })

  useEffect(() => {
    const nextOutput = extractExecutionOutput(demoExecutionQuery.data)
    if (nextOutput && nextOutput !== demoResult) {
      setDemoResult(nextOutput)
    }
    if (isDemoSuccessful(demoExecutionQuery.data?.status) && !state.demoCompleted) {
      setState(prev => ({ ...prev, demoCompleted: true }))
    }
  }, [demoExecutionQuery.data, demoResult, state.demoCompleted])

  const goTo = useCallback(
    (next: Screen) => {
      const currentIndex = stepIndex(screen)
      const nextIndex = stepIndex(next)
      setDirection(nextIndex >= currentIndex ? 1 : -1)
      setScreen(next)
    },
    [screen],
  )

  const onChange = useCallback((key: keyof WizardState, value: string) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  const selectedRecommendation = useMemo(
    () => AGENT_RECOMMENDATIONS[state.selectedWorkType] || AGENT_RECOMMENDATIONS.Research,
    [state.selectedWorkType],
  )

  const handleUseDifferentAccount = useCallback(() => {
    clearPersistedState(storageKey)
    auth.logout()
    navigate('/login', { replace: true })
  }, [auth, navigate, storageKey])

  const startDemoRun = useCallback(async () => {
    const topic = state.demoTopic.trim()
    if (!topic) {
      toast.error('Add a topic before starting the research run')
      return
    }

    setStartingDemo(true)
    try {
      let demoAgentId = state.demoAgentId
      let demoWorkflowId = state.demoWorkflowId

      if (!demoAgentId || !demoWorkflowId) {
        const install = await onboardingApi.hireFirstAgent({
          listing_slug: DEMO_LISTING_SLUG,
          competitors: topic,
          delivery_method: 'Show me the report here',
          persona_name: AGENT_RECOMMENDATIONS.Research.defaultName,
        })
        demoAgentId = install.agent_id
        demoWorkflowId = install.workflow_id
        setState(prev => ({
          ...prev,
          demoAgentId: install.agent_id,
          demoWorkflowId: install.workflow_id,
        }))
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['agents'] }),
          queryClient.invalidateQueries({ queryKey: ['workflows'] }),
          queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }),
        ])
      }

      const execution = await workflowsApi.run(demoWorkflowId, buildDemoInputValues(topic))
      setState(prev => ({
        ...prev,
        demoAgentId,
        demoWorkflowId,
        demoExecutionId: execution.execution_id,
        demoCompleted: false,
      }))
      setDemoResult('')
      await queryClient.invalidateQueries({ queryKey: ['executions'] })
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setStartingDemo(false)
    }
  }, [queryClient, state.demoAgentId, state.demoTopic, state.demoWorkflowId])

  const handleAgencyContinue = useCallback(async () => {
    if (!state.agencyName.trim() || !state.whatYouDo.trim()) {
      toast.error('Add your agency name and the kind of work you do first')
      return
    }

    const inferredWorkType = inferWorkType(state.whatYouDo)
    setSavingAgency(true)
    try {
      await onboardingApi.saveCompany({
        agency_name: state.agencyName.trim(),
        what_you_do: state.whatYouDo.trim(),
        how_many_clients: state.howManyClients,
        biggest_time_sink: inferredWorkType,
      })
      setState(prev => ({
        ...prev,
        selectedWorkType: inferredWorkType,
        selectedListingSlug: AGENT_RECOMMENDATIONS[inferredWorkType].listingSlug,
      }))
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      goTo('team')
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setSavingAgency(false)
    }
  }, [goTo, queryClient, state.agencyName, state.howManyClients, state.whatYouDo])

  const cleanupDemoArtifacts = useCallback(
    async (keepAgentId: string, keepWorkflowId: string) => {
      const workflowToDelete =
        state.demoWorkflowId && state.demoWorkflowId !== keepWorkflowId ? state.demoWorkflowId : null
      const agentToDelete =
        state.demoAgentId && state.demoAgentId !== keepAgentId ? state.demoAgentId : null

      if (workflowToDelete) {
        await workflowsApi.delete(workflowToDelete)
      }
      if (agentToDelete) {
        await agentsApi.delete(agentToDelete)
      }
    },
    [state.demoAgentId, state.demoWorkflowId],
  )

  const handleDeployAgent = useCallback(async () => {
    setDeployingAgent(true)
    try {
      if (state.demoAgentId && state.demoWorkflowId && selectedRecommendation.listingSlug === DEMO_LISTING_SLUG) {
        setState(prev => ({
          ...prev,
          installedAgentId: prev.demoAgentId,
          installedWorkflowId: prev.demoWorkflowId,
        }))
        await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
        goTo('ready')
        return
      }

      const install = await onboardingApi.hireFirstAgent({
        listing_slug: selectedRecommendation.listingSlug,
        competitors: state.demoTopic.trim() || state.whatYouDo.trim() || state.agencyName.trim(),
        delivery_method: 'Show me the report here',
        persona_name: selectedRecommendation.defaultName,
      })

      await cleanupDemoArtifacts(install.agent_id, install.workflow_id)
      setState(prev => ({
        ...prev,
        installedAgentId: install.agent_id,
        installedWorkflowId: install.workflow_id,
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }),
      ])
      goTo('ready')
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      setDeployingAgent(false)
    }
  }, [
    cleanupDemoArtifacts,
    goTo,
    queryClient,
    selectedRecommendation.defaultName,
    selectedRecommendation.listingSlug,
    state.agencyName,
    state.demoAgentId,
    state.demoTopic,
    state.demoWorkflowId,
    state.whatYouDo,
  ])

  const finishOnboarding = useCallback(
    async (target: '/' | '/workflows') => {
      setFinishing(true)
      try {
        await onboardingApi.complete()
        queryClient.setQueryData(
          ['onboarding-status'],
          (current: OnboardingStatus | undefined) => ({
            onboarding_completed: true,
            onboarding_complete: true,
            current_step: 'complete',
            company_name: current?.company_name || state.agencyName,
            has_agents: true,
            has_integrations: current?.has_integrations || false,
            latest_agent_id: state.installedAgentId || state.demoAgentId,
            latest_workflow_id: state.installedWorkflowId || state.demoWorkflowId,
            latest_execution_id: state.demoExecutionId,
            latest_execution_status: demoExecutionQuery.data?.status || 'completed',
          }),
        )
        clearPersistedState(storageKey)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }),
          queryClient.invalidateQueries({ queryKey: ['agency-overview'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
          queryClient.invalidateQueries({ queryKey: ['agents'] }),
          queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        ])
        navigate(target, { replace: true })
      } catch (error) {
        toast.error(extractApiError(error))
      } finally {
        setFinishing(false)
      }
    },
    [
      demoExecutionQuery.data?.status,
      navigate,
      queryClient,
      state.agencyName,
      state.demoAgentId,
      state.demoExecutionId,
      state.demoWorkflowId,
      state.installedAgentId,
      state.installedWorkflowId,
      storageKey,
    ],
  )

  const showBack = screen === 'agency' || screen === 'team' || screen === 'ready'
  const canContinueFromDemo = state.demoCompleted || isDemoSuccessful(demoExecutionQuery.data?.status)

  if (statusQuery.isLoading && !localHydrated) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-slate-300">
        <div className="text-center">
          <Loader2 size={22} className="mx-auto animate-spin text-indigo-300" />
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.24em] text-[#8B9DBE]">Loading agency setup</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between py-3">
        <div className="flex items-center gap-2">
          {SCREENS.map((item, index) => {
            const active = stepIndex(screen) === index
            const complete = stepIndex(screen) > index
            return (
              <span
                key={item}
                className={[
                  'h-2.5 rounded-full transition-all duration-300',
                  active ? 'w-8 bg-indigo-400' : complete ? 'w-2.5 bg-indigo-300' : 'w-2.5 bg-white/15',
                ].join(' ')}
              />
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          {showBack ? (
            <button
              type="button"
              onClick={() => {
                const previous = SCREENS[Math.max(stepIndex(screen) - 1, 0)]
                goTo(previous)
              }}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#8B9DBE] transition-colors duration-150 hover:bg-white/[0.04] hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <ArrowLeft size={14} />
              Back
            </button>
          ) : null}
          {screen !== 'intro' ? (
            <button
              type="button"
              onClick={handleUseDifferentAccount}
              className="rounded-xl px-3 py-2 text-sm text-[#8B9DBE] transition-colors duration-150 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-[calc(100vh-88px)] items-center justify-center">
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
            <StepShell screen={screen}>
              {screen === 'intro' ? (
                <IntroStep onNext={() => goTo('demo')} />
              ) : null}

              {screen === 'demo' ? (
                <DemoStep
                  topic={state.demoTopic}
                  onTopicChange={value => onChange('demoTopic', value)}
                  onPickPreset={value => onChange('demoTopic', value === 'Custom...' ? '' : value)}
                  onStart={() => void startDemoRun()}
                  submitting={startingDemo}
                  executionId={state.demoExecutionId}
                  execution={demoExecutionQuery.data}
                  demoResult={demoResult}
                  onExecutionComplete={result => {
                    setDemoResult(result)
                    setState(prev => ({ ...prev, demoCompleted: true }))
                  }}
                  onExecutionError={() => setState(prev => ({ ...prev, demoCompleted: false }))}
                  onContinue={() => {
                    if (canContinueFromDemo) goTo('agency')
                  }}
                />
              ) : null}

              {screen === 'agency' ? (
                <AgencyStep
                  state={state}
                  onChange={onChange}
                  onContinue={() => void handleAgencyContinue()}
                  loading={savingAgency}
                />
              ) : null}

              {screen === 'team' ? (
                <TeamStep
                  selectedWorkType={state.selectedWorkType}
                  onSelectWorkType={workType =>
                    setState(prev => ({
                      ...prev,
                      selectedWorkType: workType,
                      selectedListingSlug: AGENT_RECOMMENDATIONS[workType].listingSlug,
                    }))
                  }
                  onDeploy={() => void handleDeployAgent()}
                  loading={deployingAgent}
                  demoReady={Boolean(state.demoAgentId && state.demoWorkflowId)}
                />
              ) : null}

              {screen === 'ready' ? (
                <ReadyStep
                  onOpenDashboard={() => void finishOnboarding('/')}
                  onExploreProcesses={() => void finishOnboarding('/workflows')}
                  loading={finishing}
                />
              ) : null}
            </StepShell>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

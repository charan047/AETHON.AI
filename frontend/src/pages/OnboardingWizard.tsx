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
  Headset,
  Loader2,
  PenSquare,
  Search,
  Send,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react'
import { ExecutionLiveView } from '../components/execution/ExecutionLiveView'
import { FloatingField } from '../components/AuthShell'
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
    opacity: 0,
    scale: 0.96,
    y: direction > 0 ? 24 : -24,
  }),
  center: {
    opacity: 1,
    scale: 1,
    y: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    scale: 0.98,
    y: direction > 0 ? -18 : 18,
  }),
}

const transition = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 28,
}

const CLIENT_COUNTS = ['Just starting', '1–5 clients', '6–20 clients', '20+ clients']
const TIME_SINKS = ['Research', 'Content Creation', 'Outreach', 'Reporting', 'Client Support', 'Other']
const WELCOME_FEATURES = ['Client workspaces', 'Approval controls', 'Transparent reporting']

const PANEL_MAX_WIDTHS: Record<Screen, string> = {
  welcome: 'max-w-3xl',
  agency_setup: 'max-w-6xl',
  first_agent: 'max-w-3xl',
  first_run: 'max-w-5xl',
}

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
    description:
      'Drafts client-ready content, campaign angles, and structured deliverables from your service brief.',
    setupTime: '3 minutes',
    icon: PenSquare,
    competitorsPlaceholder: 'HubSpot, Ahrefs, Semrush',
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
    description:
      'Prepares outreach research, lead notes, and qualification signals for your client pipelines.',
    setupTime: '2 minutes',
    icon: Send,
    competitorsPlaceholder: 'Apollo, Clay, Instantly',
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
    description:
      'Turns scattered updates into clean, client-friendly summaries your team can send with confidence.',
    setupTime: '2 minutes',
    icon: BarChart3,
    competitorsPlaceholder: 'Databox, DashThis, Looker Studio',
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
    description:
      'Sorts urgent issues, drafts replies, and helps your team stay responsive to client needs.',
    setupTime: '2 minutes',
    icon: Headset,
    competitorsPlaceholder: 'Zendesk, Intercom, Help Scout',
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
    description:
      'Gives your agency a dependable first operator for research, monitoring, and weekly insight.',
    setupTime: '2 minutes',
    icon: Bot,
    competitorsPlaceholder: 'Linear, Notion, Asana',
    accent: {
      border: 'rgba(99,102,241,0.35)',
      glow: '0 0 36px rgba(99,102,241,0.14)',
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.08))',
      iconBg: 'rgba(99,102,241,0.16)',
      iconColor: '#A5B4FC',
    },
  },
} as const

function mapBackendStep(step: string | undefined): Screen {
  if (step === 'hire_agent') return 'first_agent'
  if (step === 'connect_tools' || step === 'first_run') return 'first_run'
  return 'welcome'
}

function AuroraBackdrop() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
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
    </>
  )
}

function OnboardingLoader() {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#050914] px-4 text-slate-300">
      <AuroraBackdrop />
      <div className="glass-elevated relative z-10 w-full max-w-sm rounded-3xl px-6 py-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-[0_0_28px_rgba(99,102,241,0.35)]">
          <Loader2 size={22} className="animate-spin text-white" />
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#8B9DBE]">
          Loading agency setup
        </p>
      </div>
    </div>
  )
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
          transform: 'none',
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
  children,
  screen,
}: {
  children: ReactNode
  screen: Screen
}) {
  return (
    <div className={`glass-elevated mx-auto w-full rounded-[28px] p-5 sm:p-8 lg:p-10 ${PANEL_MAX_WIDTHS[screen]}`}>
      {children}
    </div>
  )
}

function WelcomeStep({
  onNext,
  onUseDifferentAccount,
}: {
  onNext: () => void
  onUseDifferentAccount: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 260, damping: 20 }}
        className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-indigo-500 via-indigo-500 to-violet-500 shadow-[0_0_42px_rgba(99,102,241,0.38)]"
      >
        <Zap size={30} className="text-white" />
      </motion.div>

      <h1
        className="font-extrabold leading-[1.04] tracking-[-0.04em] text-white"
        style={{ fontSize: 'clamp(36px, 6vw, 52px)' }}
      >
        Your AI agency starts here.
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[#8B9DBE] sm:text-base">
        Stand up your workspace, deploy your first operator, and watch your first client-ready run happen in real time.
      </p>

      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        {WELCOME_FEATURES.map((text, index) => (
          <motion.div
            key={text}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.12 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white"
          >
            <span className="h-2 w-2 rounded-full bg-indigo-400" />
            {text}
          </motion.div>
        ))}
      </div>

      <div className="mt-10 space-y-3">
        <button type="button" onClick={onNext} className="btn-runner btn-primary btn-lg animate-d-4 px-8">
          Set up my agency
          <ArrowRight size={18} />
        </button>
        <div>
          <button
            type="button"
            onClick={onUseDifferentAccount}
            className="rounded-xl px-4 py-2 text-sm text-[#8B9DBE] transition-colors duration-150 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            Using the wrong account? Sign out
          </button>
        </div>
      </div>
    </div>
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
    <div className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
      <div>
        <div className="mb-6">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#4B5A73]">Step 2</p>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">Shape your agency workspace</h2>
          <p className="mt-2 text-sm text-[#8B9DBE]">
            A few details now make the rest of the setup feel custom from the start.
          </p>
        </div>

        <div className="space-y-5">
          <FloatingField
            label="Agency name"
            type="text"
            value={state.agencyName}
            onChange={value => onChange('agencyName', value)}
          />

          <FloatingTextareaField
            label="What do you do?"
            value={state.whatYouDo}
            onChange={value => onChange('whatYouDo', value)}
          />

          <div>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4B5A73]">Client count</p>
            <div className="flex flex-wrap gap-2.5">
              {CLIENT_COUNTS.map(option => (
                <StepPill
                  key={option}
                  label={option}
                  selected={state.howManyClients === option}
                  onClick={() => onChange('howManyClients', option)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4B5A73]">Biggest time sink</p>
            <div className="flex flex-wrap gap-2.5">
              {TIME_SINKS.map(option => (
                <StepPill
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
            className="btn-primary btn-lg w-full justify-center"
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

      <div className="lg:pl-2">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#4B5A73]">
          Preview — Client Portal
        </p>
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
          className="glass-card overflow-hidden rounded-[24px]"
        >
          <div className="border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#4B5A73]">Managed by</p>
                <p className="mt-2 text-lg font-bold tracking-tight text-white">
                  {state.agencyName || 'Your Agency'}
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </div>
            </div>
          </div>

          <div className="space-y-5 px-5 py-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#4B5A73]">Recent work</p>
              <div className="mt-4 space-y-3">
                {[
                  'Research competitor landscape',
                  'Draft Q2 content strategy',
                  'Analyze engagement metrics',
                ].map((task, index) => (
                  <div key={task} className="flex items-center gap-3">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        background:
                          index === 0 ? '#10B981' : index === 1 ? '#6366F1' : '#F59E0B',
                      }}
                    />
                    <div className="flex-1">
                      <div
                        className="h-3 rounded-full bg-white/[0.06]"
                        style={{ width: `${86 - index * 13}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-black/10 px-4 py-3">
              <p className="text-sm font-medium text-white">
                {state.agencyName || 'Your Agency'} portal preview
              </p>
              <p className="mt-1 text-xs leading-6 text-[#8B9DBE]">
                Clients see work updates, deliverables, and approvals in a calm branded space like this.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
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
    <div className="mx-auto w-full max-w-2xl">
      <div className="text-center">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#4B5A73]">Step 3</p>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Deploy your first agent</h2>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          Based on your biggest time sink, this is the strongest first operator for the job.
        </p>
      </div>

      <motion.div
        whileHover={{ y: -2, scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="mt-8 overflow-hidden rounded-[26px] border bg-white/[0.03] backdrop-blur-xl"
        style={{
          borderColor: recommendedAgent.accent.border,
          boxShadow: recommendedAgent.accent.glow,
        }}
      >
        <div className="px-6 pb-5 pt-6" style={{ background: recommendedAgent.accent.gradient }}>
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08]"
              style={{
                background: recommendedAgent.accent.iconBg,
                color: recommendedAgent.accent.iconColor,
              }}
            >
              <Icon size={28} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl font-extrabold tracking-tight text-white">{recommendedAgent.name}</p>
                <span className="badge-emerald">Recommended</span>
              </div>
              <p className="mt-1 text-sm" style={{ color: recommendedAgent.accent.iconColor }}>
                {recommendedAgent.role}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-sm leading-7 text-[#8B9DBE]">{recommendedAgent.description}</p>
          <div className="flex items-center gap-2 text-xs text-[#8B9DBE]">
            <CheckCircle2 size={13} className="text-emerald-400" />
            Setup time: {recommendedAgent.setupTime}
          </div>

          <FloatingField
            label="Custom name"
            type="text"
            value={state.personaName}
            onChange={value => onChange('personaName', value)}
          />

          <FloatingField
            label="What should it focus on first?"
            type="text"
            value={state.competitors}
            onChange={value => onChange('competitors', value)}
          />

          <p className="text-xs text-[#4B5A73]">
            Try: {recommendedAgent.competitorsPlaceholder}
          </p>

          <button
            type="button"
            className="btn-primary btn-lg w-full justify-center"
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
      </motion.div>
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
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600/15 ring-1 ring-emerald-500/30">
          <Sparkles size={24} className="text-emerald-400" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Your agent is working</h2>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          Watch your first real execution. This is the same live run view you will use with client work.
        </p>
      </div>

      {executionId ? (
        <div className="glass-card overflow-hidden rounded-[24px] p-3 sm:p-4">
          <ExecutionLiveView executionId={executionId} onComplete={onRunFinished} onError={onRunFinished} />
        </div>
      ) : (
        <div className="glass-card flex min-h-[320px] items-center justify-center rounded-[24px] p-6">
          <div className="flex items-center gap-3 text-sm text-[#8B9DBE]">
            <Loader2 size={18} className="animate-spin text-indigo-300" />
            {loading ? 'Starting your first run...' : 'Preparing your first run...'}
          </div>
        </div>
      )}

      {runFinished && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          className="mt-6 rounded-[24px] border border-emerald-500/20 bg-emerald-500/[0.08] p-5"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className="text-emerald-400" />
            <p className="font-semibold text-white">First run complete</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#A7F3D0]">
            Your first agent is live and your agency workspace is ready to use.
          </p>
          <button type="button" className="btn-primary btn-lg mt-4 w-full justify-center" onClick={onComplete}>
            Open dashboard
            <ArrowRight size={16} />
          </button>
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

      <div className="absolute left-0 right-0 top-0 z-30 h-[3px] bg-white/[0.05]">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400 transition-[width] duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {screen !== 'welcome' && (
        <div className="relative z-20 flex items-center justify-between px-4 pt-5 sm:px-8">
          {screen === 'agency_setup' || screen === 'first_agent' ? (
            <button
              type="button"
              onClick={() => currentIndex > 0 && goTo(SCREENS[currentIndex - 1])}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#8B9DBE] transition-colors duration-150 hover:bg-white/[0.04] hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
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
            className="rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4B5A73] transition-colors duration-150 hover:text-[#8B9DBE] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            Skip
          </button>
        </div>
      )}

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={screen}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="w-full animate-spring-in"
          >
            <StepShell screen={screen}>
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
            </StepShell>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  Code2,
  DollarSign,
  Headphones,
  Megaphone,
  Scale,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Users,
} from 'lucide-react'
import { onboardingApi } from '../api/client'
import type { Agent, CompanyProfile, CompanyProfileInput } from '../types'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { GlowCard } from '../components/ui/GlowCard'

const revenueOptions = [
  { label: '$0', value: 0 },
  { label: '<$1k', value: 500 },
  { label: '$1k-10k', value: 5000 },
  { label: '$10k-50k', value: 25000 },
  { label: '$50k+', value: 50000 },
]

const stageOptions = [
  { id: 'idea', label: 'Just starting out', description: 'Still shaping the first version.' },
  { id: 'pre-revenue', label: 'Pre-revenue', description: 'Building and validating demand.' },
  { id: 'growth', label: 'Making money', description: 'Revenue exists and workflows matter.' },
  { id: 'scale', label: 'Scaling', description: 'Systems, delegation, and consistency.' },
]

const industryOptions = ['Software', 'E-commerce', 'Content', 'Services', 'Education', 'Healthcare', 'Finance', 'Other']

const roleCards = [
  {
    name: 'CTO/Lead Developer',
    description: 'Architecture, code reviews, technical decisions.',
    icon: Code2,
    recommended: true,
  },
  {
    name: 'Customer Support',
    description: 'Answers customers and escalates product issues.',
    icon: Headphones,
    recommended: true,
  },
  {
    name: 'Growth/Marketing',
    description: 'Content, SEO, campaigns, competitor research.',
    icon: Megaphone,
    recommended: true,
  },
  {
    name: 'Product Manager',
    description: 'Roadmaps, user stories, prioritization.',
    icon: BriefcaseBusiness,
    recommended: false,
  },
  {
    name: 'QA Engineer',
    description: 'Adversarial testing and regression protection.',
    icon: TestTube2,
    recommended: false,
  },
  {
    name: 'CFO/Finance',
    description: 'Runway, pricing, burn, and financial models.',
    icon: DollarSign,
    recommended: false,
  },
  {
    name: 'Sales',
    description: 'Outreach, proposals, objections, follow-ups.',
    icon: Users,
    recommended: false,
  },
  {
    name: 'Data Analyst',
    description: 'Metrics, SQL-style analysis, reporting.',
    icon: BarChart3,
    recommended: false,
  },
  {
    name: 'Legal/Compliance',
    description: 'Contract and policy risk spotting.',
    icon: Scale,
    recommended: false,
  },
  {
    name: 'HR/Recruiting',
    description: 'Hiring plans, rubrics, onboarding, policies.',
    icon: ShieldCheck,
    recommended: false,
  },
]

function FieldShell({ label, children, delay = 0 }: { label: string; children: ReactNode; delay?: number }) {
  return (
    <label className="block animate-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function currencyLabel(value: number) {
  return revenueOptions.find(option => option.value === value)?.label ?? '$0'
}

export function Onboarding() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [generatedAgents, setGeneratedAgents] = useState<Agent[]>([])
  const [form, setForm] = useState<CompanyProfileInput>({
    company_name: '',
    mission: '',
    industry: 'Software',
    stage: 'idea',
    monthly_revenue: 0,
    team_size_goal: 3,
    primary_tools: [],
  })
  const [toolInput, setToolInput] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<string[]>([
    'CTO/Lead Developer',
    'Customer Support',
    'Growth/Marketing',
  ])

  const saveProfile = useMutation({
    mutationFn: onboardingApi.saveCompanyProfile,
    onSuccess: data => {
      setProfile(data)
      setStep(2)
    },
  })

  const generateTeam = useMutation({
    mutationFn: () => onboardingApi.generateTeam(profile!.id, selectedRoles),
    onSuccess: agents => {
      setGeneratedAgents(agents)
      setStep(3)
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
    },
  })

  const complete = useMutation({
    mutationFn: onboardingApi.complete,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
      navigate('/')
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    if (step !== 3) return
    confetti({
      particleCount: 140,
      spread: 72,
      origin: { y: 0.72 },
      colors: ['#6366f1', '#06b6d4', '#ffffff', '#f59e0b'],
    })
  }, [step])

  const selectedRoleDetails = useMemo(
    () => roleCards.filter(role => selectedRoles.includes(role.name)),
    [selectedRoles],
  )

  const toggleRole = (role: string) => {
    setSelectedRoles(current =>
      current.includes(role) ? current.filter(item => item !== role) : [...current, role],
    )
  }

  const saveStepOne = (event: FormEvent) => {
    event.preventDefault()
    const primaryTools = toolInput
      .split(',')
      .map(tool => tool.trim())
      .filter(Boolean)
    saveProfile.mutate({ ...form, primary_tools: primaryTools })
  }

  return (
    <div ref={scrollRef} className="relative h-screen overflow-y-auto overflow-x-hidden bg-obsidian-950 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.2),transparent_28%),radial-gradient(circle_at_78%_18%,rgba(6,182,212,0.13),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_32%)]" />
      <div className="absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full bg-accent-500/10 blur-3xl" />

      <main className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-center justify-between sm:mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-accent-500 to-cyan-500 shadow-glow-md">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Company OS</p>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">First run setup</p>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 font-mono text-xs text-slate-400">
            Step {step} of 3
          </div>
        </div>

        <div className="mb-8 h-1 overflow-hidden rounded-full bg-white/[0.06] sm:mb-10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400 shadow-glow-cyan transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {step === 1 && (
          <form onSubmit={saveStepOne} className="mx-auto grid w-full max-w-4xl gap-6 pb-10 sm:gap-7">
            <div className="text-center">
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">Tell us about your company</p>
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl md:text-6xl">
                Build the brain your agents will share.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-400">
                A few details turn generic assistants into a company-aware team that understands your mission, stage, and constraints.
              </p>
            </div>

            <GlowCard glowColor="cyan" active className="grid gap-6 p-6 md:p-8">
              <FieldShell label="Company name">
                <input
                  className="w-full rounded-xl border border-white/10 bg-obsidian-950 px-5 py-4 text-2xl font-semibold text-white outline-none transition focus:border-accent-400 focus:shadow-glow-sm"
                  value={form.company_name}
                  onChange={event => setForm(current => ({ ...current, company_name: event.target.value }))}
                  placeholder="Acme Intelligence"
                  required
                />
              </FieldShell>

              <FieldShell label="One-line mission" delay={60}>
                <input
                  className="w-full rounded-lg border border-white/10 bg-obsidian-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent-400 focus:shadow-glow-sm"
                  value={form.mission}
                  onChange={event => setForm(current => ({ ...current, mission: event.target.value }))}
                  placeholder="What are you building?"
                />
              </FieldShell>

              <div className="grid gap-5 md:grid-cols-2">
                <FieldShell label="Industry" delay={120}>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-obsidian-950 px-4 py-3 text-sm text-white outline-none transition focus:border-accent-400 focus:shadow-glow-sm"
                    value={form.industry}
                    onChange={event => setForm(current => ({ ...current, industry: event.target.value }))}
                  >
                    {industryOptions.map(industry => (
                      <option key={industry}>{industry}</option>
                    ))}
                  </select>
                </FieldShell>

                <FieldShell label="Primary tools or stack" delay={160}>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-obsidian-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent-400 focus:shadow-glow-sm"
                    value={toolInput}
                    onChange={event => setToolInput(event.target.value)}
                    placeholder="React, FastAPI, Stripe, HubSpot"
                  />
                </FieldShell>
              </div>

              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Stage</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {stageOptions.map(stage => (
                    <button
                      type="button"
                      key={stage.id}
                      onClick={() => setForm(current => ({ ...current, stage: stage.id }))}
                      className={`rounded-xl border p-4 text-left transition duration-150 ${
                        form.stage === stage.id
                          ? 'border-accent-400 bg-accent-500/10 shadow-glow-sm'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-white">{stage.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{stage.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-[1fr_180px] md:items-end">
                <FieldShell label="Monthly revenue">
                  <input
                    type="range"
                    min={0}
                    max={revenueOptions.length - 1}
                    step={1}
                    value={revenueOptions.findIndex(option => option.value === form.monthly_revenue)}
                    onChange={event => {
                      const option = revenueOptions[Number(event.target.value)]
                      setForm(current => ({ ...current, monthly_revenue: option.value }))
                    }}
                    className="w-full accent-accent-500"
                  />
                  <div className="mt-3 flex justify-between font-mono text-[11px] text-slate-500">
                    {revenueOptions.map(option => (
                      <span key={option.label}>{option.label}</span>
                    ))}
                  </div>
                </FieldShell>

                <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-200">Current MRR</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{currencyLabel(form.monthly_revenue)}</p>
                </div>
              </div>
            </GlowCard>

            <div className="sticky bottom-0 -mx-4 border-t border-white/10 bg-obsidian-950/90 px-4 py-4 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
              <button
                type="submit"
                disabled={saveProfile.isPending}
                className="group ml-auto flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent-500 to-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-glow-md transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex sm:w-auto"
              >
                {saveProfile.isPending ? 'Saving company brain...' : 'Continue to team setup'}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <section className="mx-auto w-full max-w-6xl pb-10">
            <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="mb-3 font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">Build your team</p>
                <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">Who do you need first?</h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
                  Select the AI employees you want. We’ll configure prompts, models, tools, and memory around your company.
                </p>
              </div>
              <div className="rounded-full border border-accent-400/20 bg-accent-500/10 px-4 py-2 font-mono text-xs text-accent-200">
                {selectedRoles.length} team members selected
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {roleCards.map(role => {
                const Icon = role.icon
                const selected = selectedRoles.includes(role.name)
                return (
                  <button
                    key={role.name}
                    type="button"
                    onClick={() => toggleRole(role.name)}
                    className={`group rounded-2xl border p-5 text-left transition duration-150 hover:-translate-y-1 ${
                      selected
                        ? 'border-accent-400 bg-accent-500/10 shadow-glow-md'
                        : 'border-white/10 bg-obsidian-900 hover:border-white/20 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-cyan-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full border ${selected ? 'border-accent-300 bg-accent-500 text-white' : 'border-white/15'}`}>
                        {selected && <Check className="h-3.5 w-3.5" />}
                      </div>
                    </div>
                    <div className="mt-5 flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-white">{role.name}</h3>
                      {role.recommended && (
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{role.description}</p>
                  </button>
                )
              })}
            </div>

            {generateTeam.isPending && (
              <GlowCard glowColor="indigo" active className="mt-8 p-6">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent-200">Building your team...</p>
                <div className="mt-5 flex flex-wrap gap-4">
                  {selectedRoleDetails.map((role, index) => (
                    <div
                      key={role.name}
                      className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 animate-fade-in"
                      style={{ animationDelay: `${index * 120}ms` }}
                    >
                      <AgentAvatar name={role.name} size="sm" running />
                      <span className="text-sm text-white">{role.name}</span>
                    </div>
                  ))}
                </div>
              </GlowCard>
            )}

            <div className="sticky bottom-0 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-white/10 bg-obsidian-950/90 px-4 py-4 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-white/10 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.04]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!selectedRoles.length || generateTeam.isPending || !profile}
                onClick={() => generateTeam.mutate()}
                className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent-500 to-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-glow-md transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generateTeam.isPending ? 'Building your team...' : 'Generate My Team'}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center py-8">
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200 shadow-glow-cyan">
                <Sparkles className="h-8 w-8" />
              </div>
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">Your team is ready</p>
              <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
                Your AI company has a pulse.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-400">
                These agents now share your company context and can start helping with real workflows.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {generatedAgents.map((agent, index) => (
                <GlowCard
                  key={agent.id}
                  glowColor={index % 2 ? 'cyan' : 'indigo'}
                  hoverable
                  className="animate-fade-in p-5 text-center"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <AgentAvatar name={agent.name} size="xl" className="mx-auto" />
                  <h3 className="mt-4 text-xl font-semibold text-white">{agent.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{agent.role}</p>
                  <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">What they can do</p>
                    <p className="text-sm leading-6 text-slate-300">{agent.description}</p>
                    <p className="mt-3 font-mono text-xs text-cyan-300">{agent.tools.join(' / ') || 'company context'}</p>
                  </div>
                </GlowCard>
              ))}
            </div>

            <button
              type="button"
              disabled={complete.isPending}
              onClick={() => complete.mutate()}
              className="mx-auto mt-10 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent-500 to-cyan-500 px-7 py-4 text-sm font-semibold text-white shadow-glow-md transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {complete.isPending ? 'Opening Command Center...' : 'Go to Command Center'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Brain, Rocket, Target, Sparkles } from 'lucide-react'

export function AuthShell({ eyebrow, title, subtitle, children }: {
  eyebrow: string
  title: string
  subtitle: string
  children: ReactNode
}) {
  const features = [
    { icon: Brain, text: 'Persistent memory — agents learn your company over time' },
    { icon: Rocket, text: 'Real actions — code deploys, emails send, posts publish' },
    { icon: Target, text: 'Business-aware — every agent knows your MRR and goals' },
  ]

  return (
    <div className="min-h-screen overflow-hidden bg-obsidian-950 text-white lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(420px,0.75fr)]">
      <section className="relative flex min-h-[48vh] items-center px-6 py-16 lg:min-h-screen lg:px-16">
        <div className="absolute inset-0 animate-mesh bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.28),transparent_28%),radial-gradient(circle_at_70%_35%,rgba(6,182,212,0.18),transparent_24%),radial-gradient(circle_at_45%_80%,rgba(99,102,241,0.14),transparent_28%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />
        <div className="relative max-w-2xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-200">
            <Sparkles size={14} /> {eyebrow}
          </div>
          <h1 className="text-5xl font-semibold tracking-[-0.05em] text-white md:text-7xl">
            Your AI Company
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-obsidian-300">
            One founder. An entire AI team. Running 24/7.
          </p>
          <div className="mt-10 space-y-4">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-sm text-obsidian-200">
                <div className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
                  <Icon size={17} />
                </div>
                {text}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex min-h-[52vh] items-center justify-center bg-obsidian-900 px-6 py-12 lg:min-h-screen">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-300">{eyebrow}</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">{title}</h2>
            <p className="mt-2 text-sm text-obsidian-400">{subtitle}</p>
          </div>
          {children}
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
}: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
}) {
  return (
    <label className="group relative block">
      <input
        className="peer h-14 w-full rounded-md border border-white/[0.08] bg-obsidian-950 px-3 pt-5 text-sm text-white outline-none transition-all placeholder:text-transparent focus:border-accent-400/70 focus:shadow-glow-sm"
        type={type}
        placeholder={label}
        autoComplete={autoComplete}
        value={value}
        onChange={event => onChange(event.target.value)}
        required={required}
      />
      <span className="pointer-events-none absolute left-3 top-2 text-[11px] font-medium uppercase tracking-[0.16em] text-obsidian-500 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-2 peer-focus:text-[11px] peer-focus:uppercase peer-focus:tracking-[0.16em] peer-focus:text-accent-300">
        {label}
      </span>
    </label>
  )
}

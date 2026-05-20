import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brain } from 'lucide-react'
import { agentsApi } from '../api/client'
import { AgentMemoryPanel } from '../components/agents/AgentMemoryPanel'
import { Skeleton } from '../components/ui/Skeleton'
import type { Agent } from '../types'
import { clsx } from 'clsx'

function roleAccent(roleSlug?: string | null) {
  switch (roleSlug) {
    case 'customer_support':
      return { bg: 'rgba(16,185,129,0.22)' }
    case 'documentation_agent':
      return { bg: 'rgba(139,92,246,0.22)' }
    case 'product_manager':
    case 'chief_of_staff':
      return { bg: 'rgba(245,158,11,0.22)' }
    default:
      return { bg: 'rgba(99,102,241,0.22)' }
  }
}

export function Memory() {
  const [selected, setSelected] = useState<Agent | null>(null)
  const { data: agents = [], isLoading, isError } = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
    refetchOnMount: 'always',
  })

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-40" />
      </div>
    )
  }

  if (isError) {
    return <div className="p-6 text-center text-white/40">Could not load agents.</div>
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div>
        <h1 className="page-title">Memory</h1>
        <p className="page-subtitle">Inspect and tune the long-term memory your AI team builds over time.</p>
      </div>

      {!agents.length ? (
        <div className="surface-card py-20 text-center text-[var(--t3)]">No agents available yet.</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
          <section className="surface-card overflow-hidden">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <div className="section-title mb-0">AI TEAM</div>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
              {agents.map(agent => {
                const accent = roleAccent(agent.role_slug)
                const isActive = selected?.id === agent.id
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelected(agent)}
                    className={clsx(
                      'data-row w-full text-left',
                      isActive ? 'border-l-2 border-l-indigo-500 bg-indigo-500/[0.08]' : '',
                    )}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-semibold text-white"
                      style={{ background: accent.bg }}
                    >
                      {(agent.persona_name || agent.name).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--t1)]">{agent.persona_name || agent.name}</div>
                      <div className="truncate text-xs text-[var(--t2)]">{agent.role || agent.role_slug}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            {selected ? (
              <AgentMemoryPanel agent={selected} />
            ) : (
              <div className="surface-card flex min-h-[520px] items-center justify-center">
                <div className="glass-card max-w-md px-6 py-12 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                    <Brain size={24} />
                  </div>
                  <div className="text-lg font-semibold text-white">Select an agent</div>
                  <div className="mt-2 text-sm text-[var(--t2)]">Choose a teammate from the left to inspect memories, preferences, and learning status inline.</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brain } from 'lucide-react'
import { agentsApi } from '../api/client'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { GlowCard } from '../components/ui/GlowCard'
import { AgentMemoryPanel } from '../components/agents/AgentMemoryPanel'
import type { Agent } from '../types'

export function Memory() {
  const [selected, setSelected] = useState<Agent | null>(null)
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div>
        <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Memory</h1>
        <p className="mt-2 text-sm text-obsidian-400">Inspect and tune the long-term memory your AI team builds over time.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map(agent => (
          <GlowCard key={agent.id} glowColor="cyan" className="p-5">
            <div className="flex items-center gap-3">
              <AgentAvatar name={agent.name} size="lg" />
              <div className="min-w-0">
                <div className="truncate font-semibold text-white">{agent.name}</div>
                <div className="text-sm text-obsidian-500">{agent.role}</div>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm text-cyan-200"><Brain size={15} /> Persistent memory</div>
              <p className="mt-2 text-xs leading-5 text-obsidian-500">Configure retrieval windows, clear stale context, and inspect recent memories.</p>
            </div>
            <button className="btn-primary mt-4 w-full" onClick={() => setSelected(agent)}>Open memory panel</button>
          </GlowCard>
        ))}
      </div>

      {!agents.length && (
        <GlowCard className="py-20 text-center text-obsidian-500">No agents available yet.</GlowCard>
      )}

      {selected && <AgentMemoryPanel agent={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

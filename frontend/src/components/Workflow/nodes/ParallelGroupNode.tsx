import { Handle, Position, type NodeProps } from 'reactflow'
import { GitCompareArrows, X } from 'lucide-react'
import { clsx } from 'clsx'

export interface ParallelGroupNodeData {
  label?: string
  agent_ids?: string[]
  merge_strategy?: 'concatenate' | 'summarize' | 'first_success'
  merge_separator?: string
  agents?: { id: string; name: string; role: string }[]
  onRemove?: (id: string) => void
  onUpdate?: (id: string, data: Partial<ParallelGroupNodeData>) => void
}

export function ParallelGroupNode({ id, data, selected }: NodeProps<ParallelGroupNodeData>) {
  const selectedAgentIds = data.agent_ids ?? []
  const agents = data.agents ?? []
  const update = (patch: Partial<ParallelGroupNodeData>) => data.onUpdate?.(id, patch)
  const toggleAgent = (agentId: string) => {
    update({
      agent_ids: selectedAgentIds.includes(agentId)
        ? selectedAgentIds.filter(id => id !== agentId)
        : [...selectedAgentIds, agentId],
    })
  }

  return (
    <div className={clsx(
      'w-80 rounded-2xl border-2 bg-fuchsia-950/75 shadow-xl shadow-fuchsia-950/30 backdrop-blur transition-all',
      selected ? 'border-fuchsia-300' : 'border-fuchsia-700/70 hover:border-fuchsia-500'
    )}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-slate-950 !bg-fuchsia-400" />

      <div className="border-b border-fuchsia-800/60 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-400/15 text-fuchsia-300">
            <GitCompareArrows size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-300">Parallel group</div>
            <input
              className="nodrag mt-1 w-full bg-transparent text-sm font-semibold text-fuchsia-50 outline-none placeholder:text-fuchsia-700"
              value={data.label ?? ''}
              placeholder="Research phase"
              onChange={event => update({ label: event.target.value })}
            />
          </div>
          {data.onRemove && (
            <button
              className="nodrag rounded-lg p-1 text-fuchsia-700 transition-colors hover:bg-red-950/40 hover:text-red-300"
              onClick={event => { event.stopPropagation(); data.onRemove?.(id) }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fuchsia-400/80">
          Merge strategy
          <select
            className="nodrag mt-1 w-full rounded-lg border border-fuchsia-800/60 bg-slate-950/70 px-2 py-1.5 text-xs text-fuchsia-100 outline-none focus:border-fuchsia-500"
            value={data.merge_strategy ?? 'concatenate'}
            onChange={event => update({ merge_strategy: event.target.value as ParallelGroupNodeData['merge_strategy'] })}
          >
            <option value="concatenate">Concatenate outputs</option>
            <option value="summarize">Summarize outputs</option>
            <option value="first_success">First success</option>
          </select>
        </label>

        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fuchsia-400/80">Connected agents</div>
          <div className="nodrag max-h-32 space-y-1 overflow-y-auto rounded-xl border border-fuchsia-800/60 bg-slate-950/40 p-2">
            {!agents.length && <div className="text-xs text-fuchsia-700">Create agents first.</div>}
            {agents.map(agent => (
              <label key={agent.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fuchsia-100 hover:bg-fuchsia-900/30">
                <input
                  type="checkbox"
                  className="accent-fuchsia-400"
                  checked={selectedAgentIds.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                />
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                <span className="rounded-full bg-fuchsia-900/40 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{agent.role}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {selectedAgentIds.map(agentId => {
            const agent = agents.find(item => item.id === agentId)
            return (
              <span key={agentId} className="rounded-full border border-fuchsia-700/70 bg-fuchsia-900/30 px-2 py-0.5 text-[11px] text-fuchsia-200">
                {agent?.name ?? agentId.slice(0, 8)}
              </span>
            )
          })}
          {!selectedAgentIds.length && <span className="text-xs text-fuchsia-700">No agents selected.</span>}
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-slate-950 !bg-fuchsia-400" />
    </div>
  )
}

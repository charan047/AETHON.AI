import { Handle, Position, type NodeProps } from 'reactflow'
import { Bot, X } from 'lucide-react'
import { clsx } from 'clsx'
import { AgentAvatar } from '../ui/AgentAvatar'

export interface AgentNodeData {
  label: string
  agent_id?: string
  agentName?: string
  role?: string
  running?: boolean
  onRemove?: (id: string) => void
}

export function AgentNode({ id, data, selected }: NodeProps<AgentNodeData>) {
  const displayName = data.agentName || data.label || 'Unassigned agent'
  return (
    <div className={clsx(
      'min-w-[190px] rounded-xl border bg-base-surface transition-all duration-150',
      selected ? 'border-indigo-400 shadow-glow-md' : 'border-white/[0.10] hover:border-white/[0.16]',
      data.running && 'animate-border-glow'
    )}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-obsidian-950 !bg-indigo-400" />
      <div className="p-3">
        <div className="mb-3 flex items-center justify-between">
          <AgentAvatar name={displayName} size="sm" running={data.running} />
          {data.onRemove && (
            <button
              onClick={(event) => { event.stopPropagation(); data.onRemove?.(id) }}
              className="nodrag rounded-md p-1 text-ink-faint transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="text-sm font-semibold text-white">{data.label}</div>
        {data.agentName && data.agentName !== data.label && <div className="mt-1 text-xs text-ink-faint">{data.agentName}</div>}
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2 py-0.5 text-[11px] text-indigo-200">
            {data.role || (data.agent_id ? 'agent' : 'unassigned')}
          </span>
          {!data.agent_id && <Bot size={12} className="text-obsidian-600" />}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-obsidian-950 !bg-indigo-400" />
    </div>
  )
}

import { Handle, Position, NodeProps } from 'reactflow'
import { Bot, X } from 'lucide-react'
import { clsx } from 'clsx'

export interface AgentNodeData {
  label: string
  agent_id?: string
  agentName?: string
  role?: string
  onRemove?: (id: string) => void
}

export function AgentNode({ id, data, selected }: NodeProps<AgentNodeData>) {
  return (
    <div className={clsx(
      'min-w-[160px] bg-slate-900 border-2 rounded-xl shadow-xl transition-all',
      selected ? 'border-violet-500 shadow-violet-900/40' : 'border-slate-700 hover:border-slate-600',
      data.agent_id ? 'border-opacity-100' : 'border-dashed border-slate-600'
    )}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-slate-900" />

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="w-7 h-7 rounded-lg bg-violet-900/50 flex items-center justify-center">
            <Bot size={14} className="text-violet-400" />
          </div>
          {data.onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); data.onRemove!(id) }}
              className="w-5 h-5 rounded flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="text-sm font-semibold text-slate-200 leading-none">{data.label}</div>
        {data.agentName && data.agentName !== data.label && (
          <div className="text-xs text-slate-500 mt-0.5 truncate">{data.agentName}</div>
        )}
        {data.role && (
          <div className="mt-1.5">
            <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-violet-900/30 text-violet-400 border border-violet-900/50">
              {data.role}
            </span>
          </div>
        )}
        {!data.agent_id && (
          <div className="text-xs text-slate-600 mt-1">Click to assign agent</div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-slate-900" />
    </div>
  )
}

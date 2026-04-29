import { Handle, Position, type NodeProps } from 'reactflow'
import { GitBranch, Plus, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'

type ConditionMode = 'llm' | 'contains' | 'regex'

export interface ConditionRule {
  id: string
  label: string
  mode: ConditionMode
  prompt?: string
  value?: string
  pattern?: string
  target_node_id?: string
}

export interface ConditionNodeData {
  label?: string
  evaluation_mode?: ConditionMode
  conditions?: ConditionRule[]
  default_target_node_id?: string
  availableNodes?: { id: string; label: string }[]
  onRemove?: (id: string) => void
  onUpdate?: (id: string, data: Partial<ConditionNodeData>) => void
}

const modes: ConditionMode[] = ['llm', 'contains', 'regex']

export function ConditionNode({ id, data, selected }: NodeProps<ConditionNodeData>) {
  const conditions = data.conditions ?? []
  const availableTargets = (data.availableNodes ?? []).filter(node => node.id !== id)
  const update = (patch: Partial<ConditionNodeData>) => data.onUpdate?.(id, patch)
  const updateCondition = (conditionId: string, patch: Partial<ConditionRule>) => {
    update({ conditions: conditions.map(condition => condition.id === conditionId ? { ...condition, ...patch } : condition) })
  }
  const addCondition = () => {
    update({
      conditions: [
        ...conditions,
        {
          id: `cond_${Date.now()}`,
          label: `Branch ${conditions.length + 1}`,
          mode: data.evaluation_mode ?? 'contains',
          value: '',
          target_node_id: availableTargets[0]?.id,
        },
      ],
    })
  }

  return (
    <div className={clsx(
      'w-80 rounded-2xl border-2 bg-indigo-950/75 shadow-xl shadow-indigo-950/30 backdrop-blur transition-all',
      selected ? 'border-indigo-300' : 'border-indigo-700/70 hover:border-indigo-500'
    )}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-slate-950 !bg-indigo-400" />

      <div className="border-b border-indigo-800/60 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 rotate-45 items-center justify-center rounded-xl bg-indigo-400/15 text-indigo-300">
            <GitBranch size={17} className="-rotate-45" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300">Conditional branch</div>
            <input
              className="nodrag mt-1 w-full bg-transparent text-sm font-semibold text-indigo-50 outline-none placeholder:text-indigo-700"
              value={data.label ?? ''}
              placeholder="Check condition"
              onChange={event => update({ label: event.target.value })}
            />
          </div>
          {data.onRemove && (
            <button
              className="nodrag rounded-lg p-1 text-indigo-700 transition-colors hover:bg-red-950/40 hover:text-red-300"
              onClick={event => { event.stopPropagation(); data.onRemove?.(id) }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 p-3">
        {conditions.map(condition => (
          <div key={condition.id} className="rounded-xl border border-indigo-800/60 bg-slate-950/40 p-2">
            <div className="mb-2 flex items-center gap-2">
              <input
                className="nodrag min-w-0 flex-1 bg-transparent text-xs font-semibold text-indigo-100 outline-none placeholder:text-indigo-700"
                value={condition.label}
                placeholder="Condition label"
                onChange={event => updateCondition(condition.id, { label: event.target.value })}
              />
              <select
                className="nodrag rounded-md border border-indigo-800/60 bg-slate-950 px-1.5 py-1 text-[11px] text-indigo-200 outline-none"
                value={condition.mode}
                onChange={event => updateCondition(condition.id, { mode: event.target.value as ConditionMode })}
              >
                {modes.map(mode => <option key={mode} value={mode}>{mode}</option>)}
              </select>
              <button
                className="nodrag rounded-md p-1 text-indigo-700 hover:bg-red-950/40 hover:text-red-300"
                onClick={() => update({ conditions: conditions.filter(item => item.id !== condition.id) })}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              className="nodrag mb-2 w-full rounded-lg border border-indigo-800/60 bg-slate-950/70 px-2 py-1.5 text-xs text-indigo-50 outline-none placeholder:text-indigo-700 focus:border-indigo-500"
              value={condition.mode === 'regex' ? condition.pattern ?? '' : condition.mode === 'llm' ? condition.prompt ?? '' : condition.value ?? ''}
              placeholder={condition.mode === 'llm' ? 'LLM prompt...' : condition.mode === 'regex' ? 'Regex pattern...' : 'Text to find...'}
              onChange={event => {
                const key = condition.mode === 'regex' ? 'pattern' : condition.mode === 'llm' ? 'prompt' : 'value'
                updateCondition(condition.id, { [key]: event.target.value })
              }}
            />
            <select
              className="nodrag w-full rounded-lg border border-indigo-800/60 bg-slate-950/70 px-2 py-1.5 text-xs text-indigo-100 outline-none focus:border-indigo-500"
              value={condition.target_node_id ?? ''}
              onChange={event => updateCondition(condition.id, { target_node_id: event.target.value })}
            >
              <option value="">Target connection...</option>
              {availableTargets.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </div>
        ))}

        <button className="nodrag flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-indigo-700 py-2 text-xs font-medium text-indigo-300 hover:bg-indigo-900/30" onClick={addCondition}>
          <Plus size={13} /> Add condition
        </button>

        <label className="block text-[11px] font-medium uppercase tracking-wide text-indigo-400/80">
          Default target
          <select
            className="nodrag mt-1 w-full rounded-lg border border-indigo-800/60 bg-slate-950/70 px-2 py-1.5 text-xs text-indigo-100 outline-none focus:border-indigo-500"
            value={data.default_target_node_id ?? ''}
            onChange={event => update({ default_target_node_id: event.target.value })}
          >
            <option value="">Follow edge / stop</option>
            {availableTargets.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
        </label>
      </div>

      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-slate-950 !bg-indigo-400" />
    </div>
  )
}

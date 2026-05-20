import { Handle, Position, type NodeProps } from 'reactflow'
import { Hand, PauseCircle, X } from 'lucide-react'
import { clsx } from 'clsx'

export interface ApprovalNodeData {
  title?: string
  label?: string
  description?: string
  timeout_hours?: number
  auto_approve_on_timeout?: boolean
  onRemove?: (id: string) => void
  onUpdate?: (id: string, data: Partial<ApprovalNodeData>) => void
}

export function ApprovalNode({ id, data, selected }: NodeProps<ApprovalNodeData>) {
  const update = (patch: Partial<ApprovalNodeData>) => data.onUpdate?.(id, patch)

  return (
    <div className={clsx(
      'w-72 rounded-2xl border-2 bg-amber-950/70 shadow-xl shadow-amber-950/30 backdrop-blur transition-all',
      selected ? 'border-amber-300' : 'border-amber-700/70 hover:border-amber-500'
    )}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-slate-950 !bg-amber-400" />

      <div className="border-b border-amber-800/60 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
            <Hand size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              <PauseCircle size={12} /> Human approval
            </div>
            <input
              className="nodrag mt-1 w-full bg-transparent text-sm font-semibold text-amber-50 outline-none placeholder:text-amber-700"
              value={data.title ?? data.label ?? ''}
              placeholder="Review required"
              onChange={event => update({ title: event.target.value, label: event.target.value })}
            />
          </div>
          {data.onRemove && (
            <button
              className="nodrag rounded-lg p-1 text-amber-700 transition-colors hover:bg-red-950/40 hover:text-red-300"
              onClick={event => { event.stopPropagation(); data.onRemove?.(id) }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <textarea
          className="nodrag min-h-[68px] w-full resize-none rounded-xl border border-amber-800/60 bg-slate-950/50 px-3 py-2 text-xs text-amber-50 outline-none placeholder:text-amber-700 focus:border-amber-500"
          value={data.description ?? ''}
          placeholder="Tell the reviewer what they should check..."
          onChange={event => update({ description: event.target.value })}
        />
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <label className="text-[11px] font-medium uppercase tracking-wide text-amber-400/80">
            Timeout hours
            <input
              type="number"
              min={1}
              className="nodrag mt-1 w-full rounded-lg border border-amber-800/60 bg-slate-950/50 px-2 py-1.5 text-xs text-amber-50 outline-none focus:border-amber-500"
              value={data.timeout_hours ?? 24}
              onChange={event => update({ timeout_hours: parseInt(event.target.value || '24', 10) })}
            />
          </label>
          <label className="nodrag flex cursor-pointer items-center gap-2 rounded-lg border border-amber-800/60 bg-slate-950/40 px-2 py-1.5 text-xs text-amber-200">
            <input
              type="checkbox"
              className="indigo-amber-400"
              checked={Boolean(data.auto_approve_on_timeout)}
              onChange={event => update({ auto_approve_on_timeout: event.target.checked })}
            />
            Auto-approve
          </label>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-slate-950 !bg-amber-400" />
    </div>
  )
}

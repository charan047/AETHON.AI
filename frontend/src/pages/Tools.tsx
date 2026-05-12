import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customToolsApi, extractApiError, type ToolParam } from '../api/client'
import {
  Plus, Trash2, Play, Save, X, Wrench, CheckCircle2,
  AlertCircle, ChevronRight, Code2, FlaskConical, RefreshCw,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { CustomTool } from '../types'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { toast } from '../lib/toast'

// ─── helpers ──────────────────────────────────────────────────────────────────

function typeDefault(type: string): unknown {
  const t = type.toLowerCase()
  if (t === 'int' || t === 'integer' || t === 'float' || t === 'number') return 0
  if (t === 'bool' || t === 'boolean') return false
  if (t === 'list' || t === 'array') return []
  if (t === 'dict' || t === 'object') return {}
  return ''
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    str: 'text', string: 'text', text: 'text',
    int: 'integer', integer: 'integer',
    float: 'decimal', number: 'decimal',
    bool: 'boolean', boolean: 'boolean',
    list: 'list (JSON)', array: 'list (JSON)',
    dict: 'dict (JSON)', object: 'dict (JSON)',
  }
  return map[type.toLowerCase()] ?? type
}

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: ToolParam
  value: unknown
  onChange: (v: unknown) => void
}) {
  const t = param.type.toLowerCase()
  const base = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-600/60 transition-colors font-mono'

  if (t === 'bool' || t === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <div
          onClick={() => onChange(!value)}
          className={clsx(
            'w-9 h-5 rounded-full transition-colors flex items-center',
            value ? 'bg-violet-600' : 'bg-slate-700'
          )}
        >
          <div className={clsx(
            'w-4 h-4 rounded-full bg-white shadow mx-0.5 transition-transform',
            value ? 'translate-x-4' : 'translate-x-0'
          )} />
        </div>
        <span className="text-xs text-slate-400">{value ? 'true' : 'false'}</span>
      </label>
    )
  }

  if (t === 'list' || t === 'array' || t === 'dict' || t === 'object') {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return (
      <textarea
        className={clsx(base, 'resize-none min-h-[60px]')}
        value={raw}
        onChange={e => {
          try { onChange(JSON.parse(e.target.value)) } catch { onChange(e.target.value) }
        }}
        placeholder={t === 'list' || t === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
      />
    )
  }

  if (t === 'int' || t === 'integer') {
    return (
      <input
        type="number"
        step="1"
        className={base}
        value={value as number}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
      />
    )
  }

  if (t === 'float' || t === 'number' || t === 'double') {
    return (
      <input
        type="number"
        step="any"
        className={base}
        value={value as number}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
    )
  }

  return (
    <input
      type="text"
      className={base}
      value={(value as string) ?? ''}
      onChange={e => onChange(e.target.value)}
    />
  )
}

// ─── editor ───────────────────────────────────────────────────────────────────

function ToolEditor({
  tool,
  onClose,
}: {
  tool: Partial<CustomTool> | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isNew = !tool?.id

  const [name, setName] = useState(tool?.name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [code, setCode] = useState(tool?.code ?? '')

  // Param state
  const [params, setParams] = useState<ToolParam[]>([])
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({})
  const [parsingParams, setParsingParams] = useState(false)

  // Test state
  const [testOutput, setTestOutput] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  // Parse params from code (debounced 600 ms)
  const refreshParams = useCallback(async (src: string) => {
    if (!src.trim()) return
    setParsingParams(true)
    try {
      const res = await customToolsApi.parseParams(src)
      const newParams: ToolParam[] = res.params
      setParams(newParams)
      setParamValues(prev => {
        const next: Record<string, unknown> = {}
        for (const p of newParams) {
          next[p.name] = p.name in prev ? prev[p.name] : (p.default ?? typeDefault(p.type))
        }
        return next
      })
    } catch {}
    finally { setParsingParams(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => refreshParams(code), 600)
    return () => clearTimeout(t)
  }, [code, refreshParams])

  // Initial parse on mount
  useEffect(() => { refreshParams(code) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createMut = useMutation({
    mutationFn: () => customToolsApi.create({ name, description, code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-tools'] })
      qc.invalidateQueries({ queryKey: ['agent-tools'] })
      toast.success('Tool created!')
      onClose()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const updateMut = useMutation({
    mutationFn: () => customToolsApi.update(tool!.id!, { name, description, code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-tools'] })
      qc.invalidateQueries({ queryKey: ['agent-tools'] })
      toast.success('Tool saved!')
      onClose()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const handleSave = () => {
    if (!name.trim()) { toast.error('Tool name is required'); return }
    if (!description.trim()) { toast.error('Description is required'); return }
    isNew ? createMut.mutate() : updateMut.mutate()
  }

  const runTest = async () => {
    if (!tool?.id) { toast.error('Save the tool first, then test it'); return }
    setTesting(true)
    setTestOutput(null)
    setTestError(null)
    try {
      // Save latest edits before testing
      await customToolsApi.update(tool.id, { code, description, name })
      const result = await customToolsApi.test(tool.id, paramValues)
      if (result.error) setTestError(result.error)
      else setTestOutput(result.output)
    } catch (e) {
      setTestError(extractApiError(e))
    } finally {
      setTesting(false)
    }
  }

  const isBusy = createMut.isPending || updateMut.isPending || testing

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors">
          <X size={17} />
        </button>
        <span className="text-sm font-medium text-slate-300">{isNew ? 'New Tool' : `Edit: ${tool?.name}`}</span>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={isBusy} className="btn-primary text-xs">
          <Save size={13} /> {isNew ? 'Create Tool' : 'Save Changes'}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: metadata + code */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-5 gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1 block">
                Tool Name <span className="text-slate-700 normal-case font-normal">(snake_case — LLM uses this)</span>
              </label>
              <input
                className="input w-full font-mono"
                placeholder="e.g. weather_lookup"
                value={name}
                onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1 block">
                Description <span className="text-slate-700 normal-case font-normal">(LLM reads this to decide when to call the tool)</span>
              </label>
              <input
                className="input w-full"
                placeholder="e.g. Look up current weather for a city"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* Signature hint */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-3 text-xs text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-300 mb-1">
              <Code2 size={12} /> How to define parameters
            </div>
            <div>Add typed arguments to <code className="text-violet-400">run()</code> — the LLM will fill them automatically:</div>
            <pre className="text-slate-300 font-mono mt-1">{`def run(city: str, days: int = 3, celsius: bool = True) -> str:`}</pre>
            <div className="text-slate-600 pt-0.5">Supported types: <span className="text-slate-500">str · int · float · bool · list · dict</span></div>
          </div>

          {/* Code editor */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Code2 size={13} className="text-slate-500" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Python Code</span>
              <span className="text-xs text-slate-700 ml-auto">
                Allowed: json · math · re · datetime · httpx · hashlib · base64 · random · urllib …
              </span>
            </div>
            <textarea
              className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm font-mono text-slate-200 outline-none resize-none focus:border-violet-600/60 transition-colors leading-relaxed min-h-[300px]"
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Right: test panel */}
        <div className="w-80 flex-shrink-0 border-l border-slate-800 flex flex-col bg-slate-900/40">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
            <FlaskConical size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Test Panel</span>
            {parsingParams && (
              <RefreshCw size={11} className="animate-spin text-slate-600 ml-auto" />
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Dynamic param fields */}
            {params.length > 0 ? (
              <div className="space-y-3">
                {params.map(p => (
                  <div key={p.name}>
                    <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                      <span className="font-mono text-violet-400">{p.name}</span>
                      <span className="text-slate-600">: {typeLabel(p.type)}</span>
                      {!p.required && <span className="text-slate-700 text-[10px]">(optional)</span>}
                      {p.required && <span className="text-red-600 text-[10px]">*</span>}
                    </label>
                    <ParamInput
                      param={p}
                      value={paramValues[p.name] ?? typeDefault(p.type)}
                      onChange={v => setParamValues(prev => ({ ...prev, [p.name]: v }))}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600 text-center py-2">
                Parsing parameters from code…
              </div>
            )}

            <button
              onClick={runTest}
              disabled={isBusy || isNew}
              className={clsx(
                'w-full btn-secondary text-xs justify-center',
                (isBusy || isNew) && 'opacity-50 cursor-not-allowed'
              )}
              title={isNew ? 'Save the tool first' : 'Run test with current values'}
            >
              {testing
                ? <><div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" /> Running…</>
                : <><Play size={12} /> Run Test</>}
            </button>

            {isNew && (
              <p className="text-xs text-slate-600 text-center">Save the tool first to enable testing</p>
            )}

            {testOutput !== null && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 mb-1">
                  <CheckCircle2 size={12} /> Output
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                  {testOutput}
                </div>
              </div>
            )}

            {testError !== null && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-red-400 mb-1">
                  <AlertCircle size={12} /> Error
                </div>
                <div className="bg-red-900/20 border border-red-900/60 rounded-lg p-3 text-xs font-mono text-red-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                  {testError}
                </div>
              </div>
            )}

            {testOutput === null && testError === null && !isNew && params.length > 0 && (
              <div className="text-xs text-slate-700 text-center pt-2">
                Fill values above and click Run Test
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── list page ────────────────────────────────────────────────────────────────

export function Tools() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<CustomTool> | null | false>(false)
  const [toolToDelete, setToolToDelete] = useState<CustomTool | null>(null)

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ['custom-tools'],
    queryFn: customToolsApi.list,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => customToolsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-tools'] })
      qc.invalidateQueries({ queryKey: ['agent-tools'] })
      setToolToDelete(null)
      toast.success('Tool deleted')
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      customToolsApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-tools'] }),
  })

  if (editing !== false) {
    return <ToolEditor tool={editing} onClose={() => setEditing(false)} />
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Custom Tools</h1>
          <p className="text-slate-400 text-sm mt-1">
            Write Python functions with typed parameters that agents call during workflows
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(null)}>
          <Plus size={16} /> New Tool
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => <div key={i} className="card h-20 animate-pulse bg-slate-800/50" />)}
        </div>
      ) : !tools.length ? (
        <div className="text-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-violet-900/20 border border-violet-900/40 flex items-center justify-center mx-auto mb-4">
            <Wrench size={28} className="text-violet-500" />
          </div>
          <div className="text-slate-300 font-medium text-lg mb-1">No custom tools yet</div>
          <div className="text-slate-600 text-sm mb-5 max-w-sm mx-auto">
            Create Python tools with multiple typed parameters — fetch weather, query APIs, process data, and more.
          </div>
          <button className="btn-primary" onClick={() => setEditing(null)}>
            <Plus size={15} /> Create your first tool
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {tools.map((t: CustomTool) => (
            <ToolRow
              key={t.id}
              tool={t}
              onEdit={() => setEditing(t)}
              onDelete={() => setToolToDelete(t)}
              onToggle={() => toggleMut.mutate({ id: t.id, is_active: !t.is_active })}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(toolToDelete)}
        title={`Delete ${toolToDelete?.name || 'tool'}?`}
        description="Agents using this custom tool will no longer be able to call it. This action cannot be undone."
        confirmLabel="Delete tool"
        loading={deleteMut.isPending}
        onClose={() => setToolToDelete(null)}
        onConfirm={() => toolToDelete && deleteMut.mutate(toolToDelete.id)}
      />
    </div>
  )
}

function ToolRow({
  tool,
  onEdit,
  onDelete,
  onToggle,
}: {
  tool: CustomTool
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const [params, setParams] = useState<ToolParam[]>([])
  useEffect(() => {
    customToolsApi.parseParams(tool.code).then(r => setParams(r.params)).catch(() => {})
  }, [tool.code])

  return (
    <div className="card p-4 flex items-center gap-4 hover:border-slate-600 transition-colors">
      <div className={clsx(
        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
        tool.is_active ? 'bg-violet-900/40 text-violet-400' : 'bg-slate-800 text-slate-600'
      )}>
        <Code2 size={16} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-semibold text-slate-100 text-sm">{tool.name}</span>
          {/* Param badges */}
          {params.map(p => (
            <span key={p.name} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-slate-500">
              {p.name}: {p.type}{!p.required && '?'}
            </span>
          ))}
          {!tool.is_active && <span className="badge-gray text-[10px]">disabled</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{tool.description}</div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onToggle}
          className={clsx(
            'text-xs px-2.5 py-1 rounded-lg border transition-colors',
            tool.is_active
              ? 'border-emerald-900/60 text-emerald-400 hover:bg-emerald-900/20'
              : 'border-slate-700 text-slate-500 hover:bg-slate-800'
          )}
        >
          {tool.is_active ? 'Active' : 'Disabled'}
        </button>
        <button className="btn-secondary text-xs px-3" onClick={onEdit}>
          <ChevronRight size={13} /> Edit
        </button>
        <button className="btn-danger text-xs px-3" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { customToolsApi, extractApiError, toolsApi, type ToolParam } from '../api/client'
import {
  Plus, Play, Save, X, Wrench, CheckCircle2,
  AlertCircle, ChevronRight, Code2, FlaskConical, RefreshCw,
  Search, Mail, Slack, Github, FileText, Table2,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { CustomTool } from '../types'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { toast } from '../lib/toast'

// ─── helpers ──────────────────────────────────────────────────────────────────

const STARTER_TOOLS_SEED_KEY = 'aethon-custom-tools-starter-pack-seeded'

const BLANK_TOOL_TEMPLATE = {
  name: 'utility_helper',
  description: 'Custom helper that returns a formatted string for agents to use in workflows.',
  code: `def run(query: str, max_results: int = 3) -> str:
    """Describe what this tool does — the LLM reads this to decide when to call it."""
    results = [f"Result {i + 1} for '{query}'" for i in range(max_results)]
    return "\\n".join(results)
`,
}

const STARTER_TOOL_TEMPLATES = [
  {
    name: 'client_summary_builder',
    description: 'Build a client-ready weekly summary from accomplishments, blockers, and next steps.',
    code: `def run(client_name: str, accomplishments: list, blockers: list = None, next_steps: list = None) -> str:
    blockers = blockers or []
    next_steps = next_steps or []

    def bullets(items: list) -> str:
        if not items:
            return "- None"
        return "\\n".join(f"- {item}" for item in items)

    return (
        f"# {client_name} Weekly Update\\n\\n"
        f"## Accomplished\\n{bullets(accomplishments)}\\n\\n"
        f"## Blockers\\n{bullets(blockers)}\\n\\n"
        f"## Next Steps\\n{bullets(next_steps)}"
    )
`,
  },
  {
    name: 'lead_csv_formatter',
    description: 'Convert lead records into a clean CSV preview or email-ready table snippet.',
    code: `def run(rows: list, include_header: bool = True) -> str:
    if not rows:
        return "name,email,company"

    normalized = []
    for row in rows:
        normalized.append(
            {
                "name": str(row.get("name", "")).strip(),
                "email": str(row.get("email", "")).strip(),
                "company": str(row.get("company", "")).strip(),
            }
        )

    lines = []
    if include_header:
        lines.append("name,email,company")

    for row in normalized:
        lines.append(f"{row['name']},{row['email']},{row['company']}")

    return "\\n".join(lines)
`,
  },
] as const

function makeToolDraft(template = BLANK_TOOL_TEMPLATE): Partial<CustomTool> {
  return {
    name: template.name,
    description: template.description,
    code: template.code,
    is_active: true,
  }
}

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
  const draft = tool ?? makeToolDraft()
  const isNew = !tool?.id

  const [name, setName] = useState(draft.name ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [code, setCode] = useState(draft.code ?? BLANK_TOOL_TEMPLATE.code)

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
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Partial<CustomTool> | null | false>(false)
  const [toolToDelete, setToolToDelete] = useState<CustomTool | null>(null)
  const [selectedBuiltIn, setSelectedBuiltIn] = useState<any | null>(null)
  const builtInDetailsRef = useRef<HTMLDivElement | null>(null)

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ['custom-tools'],
    queryFn: customToolsApi.list,
  })

  const { data: catalog = [] } = useQuery({
    queryKey: ['tools', 'catalog'],
    queryFn: toolsApi.catalog,
  })

  const { data: providerHealth = {} } = useQuery({
    queryKey: ['tools', 'provider-health'],
    queryFn: toolsApi.providerHealth,
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
  const starterPackMut = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        STARTER_TOOL_TEMPLATES.map(template => customToolsApi.create({ ...template })),
      )

      let created = 0
      let duplicate = 0
      let failed = 0
      let firstError = ''

      for (const result of results) {
        if (result.status === 'fulfilled') {
          created += 1
          continue
        }

        const message = extractApiError(result.reason)
        if (message.toLowerCase().includes('already exists')) {
          duplicate += 1
        } else {
          failed += 1
          firstError ||= message
        }
      }

      if (!created && failed) {
        throw new Error(firstError || 'Failed to add starter tools')
      }

      return { created, duplicate }
    },
    onSuccess: async ({ created, duplicate }) => {
      window.localStorage.setItem(STARTER_TOOLS_SEED_KEY, '1')
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['custom-tools'] }),
        qc.invalidateQueries({ queryKey: ['agent-tools'] }),
      ])
      if (created > 0) {
        toast.success(`Added ${created} starter custom tools`)
      } else if (duplicate > 0) {
        toast.info('Starter tools already exist')
      }
    },
    onError: error => toast.error(extractApiError(error)),
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isLoading || tools.length > 0 || starterPackMut.isPending) return
    if (window.localStorage.getItem(STARTER_TOOLS_SEED_KEY) === '1') return
    starterPackMut.mutate()
  }, [isLoading, starterPackMut, tools.length])

  useEffect(() => {
    if (!selectedBuiltIn || !builtInDetailsRef.current) return
    builtInDetailsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedBuiltIn])

  if (editing !== false) {
    return <ToolEditor tool={editing} onClose={() => setEditing(false)} />
  }

  const builtIns = catalog.filter((tool: any) => tool.category !== 'custom')

  const iconForTool = (name: string) => {
    const value = name.toLowerCase()
    if (value.includes('search') || value.includes('brave') || value.includes('serper')) return Search
    if (value.includes('gmail') || value.includes('email')) return Mail
    if (value.includes('slack')) return Slack
    if (value.includes('github')) return Github
    if (value.includes('google') || value.includes('docs')) return FileText
    return Table2
  }

  const healthForTool = (name: string) => {
    const value = name.toLowerCase()
    const healthMap = Array.isArray(providerHealth)
      ? Object.fromEntries(
          providerHealth
            .map((item: any) => [item?.provider || item?.name, item])
            .filter(([key]) => Boolean(key)),
        )
      : providerHealth

    const searchProvider = healthMap.search
    const gmailProvider = healthMap.gmail
    const slackProvider = healthMap.slack
    const githubProvider = healthMap.github

    if (value.includes('search') || value.includes('brave') || value.includes('serper')) return searchProvider
    if (value.includes('gmail') || value.includes('email') || value.includes('google')) return gmailProvider
    if (value.includes('slack')) return slackProvider
    if (value.includes('github')) return githubProvider
    return null
  }

  const destinationForTool = (name: string) => {
    const value = name.toLowerCase()
    if (value.includes('model') || value.includes('openai') || value.includes('anthropic') || value.includes('groq')) {
      return '/settings/models'
    }
    return '/integrations'
  }

  const builtInDetails = (tool: any) => {
    const name = String(tool.name || tool.display_name || 'tool').toLowerCase()
    const provider = healthForTool(tool.name || tool.display_name || 'tool')

    if (name.includes('search') || name.includes('brave') || name.includes('serper') || name.includes('news')) {
      return {
        title: 'Search provider',
        detail:
          provider?.note ||
          'Web search is configured through environment variables like BRAVE_SEARCH_API_KEY or SERPER_API_KEY, not an OAuth connection.',
        actionLabel: null,
        action: null,
      }
    }

    if (name.includes('gmail') || name.includes('google')) {
      return {
        title: 'Google integration',
        detail: provider?.note || 'Connect or reconnect Google in Integrations to enable this tool.',
        actionLabel: 'Open Integrations',
        action: () => navigate('/integrations'),
      }
    }

    if (name.includes('slack')) {
      return {
        title: 'Slack integration',
        detail: provider?.note || 'Connect Slack in Integrations to enable this tool.',
        actionLabel: 'Open Integrations',
        action: () => navigate('/integrations'),
      }
    }

    if (name.includes('github')) {
      return {
        title: 'GitHub integration',
        detail: provider?.note || 'Connect a GitHub token in Integrations to enable this tool.',
        actionLabel: 'Open Integrations',
        action: () => navigate('/integrations'),
      }
    }

    return {
      title: 'Built-in tool',
      detail: provider?.note || tool.description || 'This tool is available to your agents when included in their toolset.',
      actionLabel: null,
      action: null,
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Tools</h1>
          <p className="page-subtitle">Custom integrations</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => starterPackMut.mutate()}
            disabled={starterPackMut.isPending}
          >
            <Wrench size={16} /> {starterPackMut.isPending ? 'Adding starter tools…' : 'Add Starter Pack'}
          </button>
          <button className="btn-primary" onClick={() => setEditing(makeToolDraft())}>
            <Plus size={16} /> Add Tool
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <div className="section-title">Built-In</div>
        <div className="overflow-hidden rounded-[24px] border border-white/[0.06] bg-white/[0.03]">
          {builtIns.map((tool: any) => {
            const Icon = iconForTool(tool.name || tool.display_name || 'tool')
            const provider = healthForTool(tool.name || tool.display_name || 'tool')
            const configured = provider ? provider.status !== 'not_configured' : !tool.requires_auth
            const isSelected = selectedBuiltIn?.name === tool.name
            return (
              <div
                key={tool.name}
                className={clsx(
                  'data-row w-full text-left transition hover:bg-white/[0.05]',
                  isSelected && 'bg-white/[0.05]',
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-indigo-300">
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">{tool.display_name || tool.name}</div>
                  <div className="truncate text-sm text-[#8B9DBE]">
                    {provider?.note || tool.description || 'Built-in tool'}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-mono text-[#8B9DBE]">
                    <span className={clsx('status-dot', configured ? 'dot-green' : 'dot-amber')} />
                    {configured ? 'configured' : 'needs config'}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedBuiltIn((current: any) => (current?.name === tool.name ? null : tool))
                    }
                    className={clsx(
                      'btn-ghost btn-sm',
                      configured ? 'text-indigo-300 hover:text-indigo-200' : 'text-amber-300 hover:text-amber-200',
                    )}
                  >
                    {isSelected ? 'hide' : 'details'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {selectedBuiltIn ? (
          <div ref={builtInDetailsRef} className="glass-card mt-4 rounded-[24px] p-5">
            {(() => {
              const Icon = iconForTool(selectedBuiltIn.name || selectedBuiltIn.display_name || 'tool')
              const provider = healthForTool(selectedBuiltIn.name || selectedBuiltIn.display_name || 'tool')
              const configured = provider ? provider.status !== 'not_configured' : !selectedBuiltIn.requires_auth
              const details = builtInDetails(selectedBuiltIn)
              return (
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05] text-indigo-300">
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {selectedBuiltIn.display_name || selectedBuiltIn.name}
                        </div>
                        <div className="text-xs text-[#8B9DBE]">{details.title}</div>
                      </div>
                    </div>
                    <p className="mt-4 text-sm text-[#8B9DBE]">{details.detail}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className={clsx('badge', configured ? 'badge-emerald' : 'badge-amber')}>
                        {configured ? 'configured' : 'needs config'}
                      </span>
                      <span className="badge-glass">{selectedBuiltIn.category}</span>
                      {selectedBuiltIn.auth_type ? <span className="badge-glass">{selectedBuiltIn.auth_type}</span> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {details.action ? (
                      <button className="btn-primary btn-sm" onClick={details.action}>
                        {details.actionLabel}
                      </button>
                    ) : null}
                    <button className="btn-ghost btn-sm" onClick={() => setSelectedBuiltIn(null)}>
                      Close
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="section-title">Custom</div>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[...Array(2)].map((_, i) => <div key={i} className="glass-card h-40 animate-pulse" />)}
          </div>
        ) : !tools.length ? (
          <div className="glass-card rounded-[24px] border border-dashed border-white/[0.10] px-6 py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04]">
              <Wrench size={28} className="text-indigo-300" />
            </div>
            <div className="mb-1 text-lg font-medium text-white">Add your first custom tool</div>
            <div className="mx-auto mb-5 max-w-sm text-sm text-[#8B9DBE]">
              Create Python tools with typed parameters for agents to call inside workflows.
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                className="btn-secondary"
                onClick={() => starterPackMut.mutate()}
                disabled={starterPackMut.isPending}
              >
                <Wrench size={15} /> {starterPackMut.isPending ? 'Adding starter tools…' : 'Install starter tools'}
              </button>
              <button className="btn-primary" onClick={() => setEditing(makeToolDraft())}>
                <Plus size={15} /> Add Tool
              </button>
            </div>
            <div className="mx-auto mt-6 grid max-w-3xl gap-3 text-left md:grid-cols-2">
              {STARTER_TOOL_TEMPLATES.map(template => (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => setEditing(makeToolDraft(template))}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 transition hover:border-indigo-500/25 hover:bg-white/[0.05]"
                >
                  <div className="text-sm font-semibold text-white">{template.name}</div>
                  <div className="mt-2 text-xs text-[#8B9DBE]">{template.description}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
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
      </section>
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
    <div className="glass-card group overflow-hidden p-5 transition duration-150 hover:-translate-y-0.5 hover:border-white/[0.12]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
                tool.is_active ? 'bg-indigo-500/12 text-indigo-300' : 'bg-white/[0.04] text-[#8B9DBE]',
              )}
            >
              <Code2 size={16} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{tool.name}</div>
              <div className="font-mono text-xs text-[#8B9DBE]">/tools/{tool.id}/test</div>
            </div>
            <span className="badge-glass">POST</span>
          </div>

          <div className="mt-3 text-sm text-[#8B9DBE]">{tool.description}</div>

          <div className="mt-3 flex flex-wrap gap-2">
            {params.map(p => (
              <span key={p.name} className="badge-glass">
                {p.name}: {p.type}{!p.required && '?'}
              </span>
            ))}
            {!tool.is_active && <span className="badge-red">disabled</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
          <button className="btn-secondary btn-sm" onClick={onEdit}>
            Test
          </button>
          <button className="btn-ghost btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button className="btn-danger btn-sm" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <button
          onClick={onToggle}
          className={clsx(
            'inline-flex items-center gap-2 text-xs font-medium transition',
            tool.is_active ? 'text-emerald-300' : 'text-[#8B9DBE]',
          )}
        >
          <span className={clsx('status-dot', tool.is_active ? 'dot-green' : 'dot-amber')} />
          {tool.is_active ? 'configured' : 'disabled'}
        </button>

        <button className="btn-ghost btn-sm" onClick={onEdit}>
          <ChevronRight size={13} />
          Open
        </button>
      </div>
    </div>
  )
}

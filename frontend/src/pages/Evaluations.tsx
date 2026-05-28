import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Beaker,
  CheckCircle2,
  FileJson,
  FlaskConical,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Trophy,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi, evalsApi, extractApiError, modelsApi } from '../api/client'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { ScoreBadge } from '../components/evals/ScoreBadge'
import { RunSuiteModal } from '../components/evals/RunSuiteModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import type {
  EvalCase,
  EvalModelComparisonHistoryItem,
  EvalModelComparisonResult,
  EvalRun,
  EvalSuite,
  ModelConfigRecord,
  ScoringMethod,
} from '../types'
import { toast } from '../lib/toast'

type Tab = 'cases' | 'runs' | 'insights' | 'compare'

const scoringMethods: ScoringMethod[] = [
  'llm_judge',
  'exact_match',
  'contains',
  'regex',
  'rouge_l',
  'semantic_similarity',
  'json_schema',
  'custom_function',
]

function truncate(value = '', length = 96) {
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function relative(date?: string | null) {
  if (!date) return 'Never'
  return `${formatDistanceToNow(new Date(date), { addSuffix: true })}`
}

function methodLabel(method?: string) {
  return (method || 'llm_judge').replace(/_/g, ' ')
}

export function Evaluations() {
  const qc = useQueryClient()
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('cases')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [showSuiteForm, setShowSuiteForm] = useState(false)
  const [showCaseForm, setShowCaseForm] = useState(false)
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null)
  const [caseToDelete, setCaseToDelete] = useState<EvalCase | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [suiteSearch, setSuiteSearch] = useState('')
  const [caseRunState, setCaseRunState] = useState<Record<string, { loading?: boolean; passed?: boolean | null; error?: string | null }>>({})

  const suitesQuery = useQuery({ queryKey: ['evals', 'suites'], queryFn: evalsApi.suites })
  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const selectedSuite = suitesQuery.data?.find(suite => suite.id === selectedSuiteId) || null

  useEffect(() => {
    if (!selectedSuiteId && suitesQuery.data?.length) {
      setSelectedSuiteId(suitesQuery.data[0].id)
    }
  }, [selectedSuiteId, suitesQuery.data])

  const detailQuery = useQuery({
    queryKey: ['evals', 'suite', selectedSuiteId],
    queryFn: () => evalsApi.suite(selectedSuiteId!),
    enabled: Boolean(selectedSuiteId),
  })

  const runsQuery = useQuery({
    queryKey: ['evals', 'suite-runs', selectedSuiteId],
    queryFn: () => evalsApi.runs(selectedSuiteId!, 20),
    enabled: Boolean(selectedSuiteId),
  })

  const latestRunId = runsQuery.data?.runs?.[0]?.id
  const activeRunId = selectedRunId || latestRunId
  const runDetailQuery = useQuery({
    queryKey: ['evals', 'run', activeRunId],
    queryFn: () => evalsApi.run(activeRunId!),
    enabled: Boolean(activeRunId),
  })

  const insightsQuery = useQuery({
    queryKey: ['evals', 'insights', selectedSuiteId],
    queryFn: () => evalsApi.insights(selectedSuiteId!),
    enabled: Boolean(selectedSuiteId),
  })
  const modelConfigsQuery = useQuery({
    queryKey: ['model-configs', 'evals-compare'],
    queryFn: modelsApi.list,
  })
  const compareHistoryQuery = useQuery({
    queryKey: ['evals', 'compare-history', selectedSuiteId],
    queryFn: () => evalsApi.compareHistory(selectedSuiteId!),
    enabled: Boolean(selectedSuiteId),
  })

  const refreshSelected = () => {
    qc.invalidateQueries({ queryKey: ['evals'] })
  }

  const quickTestMutation = useMutation({
    mutationFn: (agentId: string) => evalsApi.quickTest(agentId),
    onSuccess: async payload => {
      toast.success(`Quick test complete — ${payload.passed}/${payload.total} passed`)
      if (payload.suite_id) {
        setSelectedSuiteId(payload.suite_id)
        setSelectedRunId(payload.run_id)
        setTab('runs')
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['evals', 'suite-runs', selectedSuiteId] }),
        qc.invalidateQueries({ queryKey: ['evals', 'run', payload.run_id] }),
        qc.invalidateQueries({ queryKey: ['evals', 'suites'] }),
      ])
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const runSuite = (suite: EvalSuite) => {
    setSelectedSuiteId(suite.id)
    setShowRunModal(true)
  }

  const cases = detailQuery.data?.cases || []
  const latestScores = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const result of runDetailQuery.data?.results || []) {
      map.set(result.case_id, result.score ?? null)
    }
    return map
  }, [runDetailQuery.data])

  const filteredSuites = useMemo(() => {
    const suites = suitesQuery.data || []
    if (!suiteSearch.trim()) return suites
    const query = suiteSearch.toLowerCase()
    return suites.filter(suite =>
      [suite.name, suite.agent_name || '', suite.description || '']
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [suiteSearch, suitesQuery.data])

  return (
    <div className="flex h-full min-h-0 animate-fade-in overflow-hidden">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-white/[0.08] bg-[rgba(5,9,20,0.88)] backdrop-blur-xl">
        <div className="border-b border-white/[0.08] px-4 py-5">
          <div className="mb-3">
            <h1 className="page-title">Evaluations</h1>
            <p className="page-sub">{(suitesQuery.data?.length || 0)} suites · test your agents</p>
          </div>
          <button className="btn-primary w-full justify-center" onClick={() => setShowSuiteForm(true)}>
            <Plus size={14} /> Create Suite
          </button>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <Search size={14} className="text-[var(--text-3)]" />
            <input
              value={suiteSearch}
              onChange={event => setSuiteSearch(event.target.value)}
              placeholder="Search suites"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[var(--text-3)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {suitesQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, index) => <Skeleton key={index} className="h-32" />)}
            </div>
          ) : !filteredSuites.length ? (
            <div className="card rounded-2xl p-5 text-center">
              <FlaskConical className="mx-auto mb-3 text-indigo-300" size={28} />
              <div className="font-medium text-white">{suitesQuery.data?.length ? 'No suites match your search' : 'No eval suites yet'}</div>
              <p className="mt-2 text-sm text-[#8B9DBE]">Create one to start measuring your agent quality.</p>
              {!suitesQuery.data?.length ? <button className="btn-primary mt-4 w-full" onClick={() => setShowSuiteForm(true)}>Create Suite</button> : null}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSuites.map(suite => (
                <SuiteCard
                  key={suite.id}
                  suite={suite}
                  selected={suite.id === selectedSuiteId}
                  onSelect={() => {
                    setSelectedSuiteId(suite.id)
                    setTab('cases')
                    setSelectedRunId(null)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {!selectedSuiteId ? (
          <EmptyEvalHero onNew={() => setShowSuiteForm(true)} />
        ) : detailQuery.isLoading ? (
          <div className="space-y-5">
            <Skeleton className="h-24" />
            <SkeletonCard className="h-96" />
          </div>
        ) : detailQuery.data ? (
          <div className="space-y-5">
            <SuiteHeader
              suite={detailQuery.data}
              onRun={() => setShowRunModal(true)}
              onQuickTest={() => quickTestMutation.mutate(detailQuery.data.agent_id)}
              quickTesting={quickTestMutation.isPending}
            />
            <Tabs tab={tab} setTab={setTab} />

            {tab === 'cases' && (
              <TestCasesTab
                suite={detailQuery.data}
                cases={cases}
                latestScores={latestScores}
                caseRunState={caseRunState}
                onAddCase={() => {
                  setEditingCase(null)
                  setShowCaseForm(true)
                }}
                onImport={() => setShowImport(true)}
                onEdit={caseItem => {
                  setEditingCase(caseItem)
                  setShowCaseForm(true)
                }}
                onDelete={caseItem => setCaseToDelete(caseItem)}
                onRunCase={async caseItem => {
                  try {
                    setCaseRunState(prev => ({ ...prev, [caseItem.id]: { loading: true } }))
                    const run = await evalsApi.runCase(detailQuery.data!.id, caseItem.id)
                    const inlineResult = run.results?.find(result => result.case_id === caseItem.id)
                    setCaseRunState(prev => ({
                      ...prev,
                      [caseItem.id]: {
                        loading: false,
                        passed: run.passed ?? inlineResult?.passed ?? null,
                        error: inlineResult?.error_message || null,
                      },
                    }))
                    toast.success(run.passed ? 'Case passed' : 'Case failed')
                    setSelectedRunId(run.id)
                    setTab('runs')
                    refreshSelected()
                  } catch (error: any) {
                    setCaseRunState(prev => ({
                      ...prev,
                      [caseItem.id]: { loading: false, passed: false, error: extractApiError(error) },
                    }))
                    toast.error(extractApiError(error))
                  }
                }}
              />
            )}

            {tab === 'runs' && (
              <RunHistoryTab
                suite={detailQuery.data}
                runs={runsQuery.data?.runs || []}
                trend={runsQuery.data?.score_trend || []}
                selectedRunId={selectedRunId}
                selectedRun={runDetailQuery.data || null}
                loadingSelectedRun={runDetailQuery.isLoading}
                onSelectRun={run => setSelectedRunId(current => current === run.id ? null : run.id)}
              />
            )}

            {tab === 'insights' && (
              <InsightsTab suite={detailQuery.data} insights={insightsQuery.data} loading={insightsQuery.isLoading} />
            )}

            {tab === 'compare' && (
              <CompareTab
                suite={detailQuery.data}
                models={modelConfigsQuery.data || []}
                history={compareHistoryQuery.data?.comparisons || []}
                loadingHistory={compareHistoryQuery.isLoading}
                onRefresh={() => {
                  qc.invalidateQueries({ queryKey: ['evals', 'compare-history', selectedSuiteId] })
                  qc.invalidateQueries({ queryKey: ['evals', 'suite-runs', selectedSuiteId] })
                }}
              />
            )}
          </div>
        ) : null}
      </main>

      <SuiteForm
        open={showSuiteForm}
        agents={agentsQuery.data || []}
        onClose={() => setShowSuiteForm(false)}
        onCreated={suite => {
          setShowSuiteForm(false)
          setSelectedSuiteId(suite.id)
          refreshSelected()
        }}
      />
      <CaseForm
        open={showCaseForm}
        suiteId={selectedSuiteId}
        existing={editingCase}
        onClose={() => setShowCaseForm(false)}
        onSaved={() => {
          setShowCaseForm(false)
          refreshSelected()
        }}
      />
      <ImportCasesModal
        open={showImport}
        suite={detailQuery.data || null}
        onClose={() => setShowImport(false)}
        onImported={() => {
          setShowImport(false)
          refreshSelected()
        }}
      />
      <RunSuiteModal
        open={showRunModal}
        suite={detailQuery.data || selectedSuite}
        onClose={() => setShowRunModal(false)}
        onFinished={refreshSelected}
      />
      <ConfirmDialog
        open={Boolean(caseToDelete)}
        title={`Delete ${caseToDelete?.name || 'eval case'}?`}
        description="This removes the test case from the suite. Historical run results stay available."
        confirmLabel="Delete case"
        onClose={() => setCaseToDelete(null)}
        onConfirm={async () => {
          if (!caseToDelete || !detailQuery.data) return
          await evalsApi.deleteCase(detailQuery.data.id, caseToDelete.id)
          setCaseToDelete(null)
          toast.success('Eval case deleted')
          refreshSelected()
        }}
      />
    </div>
  )
}

function SuiteCard({ suite, selected, onSelect }: {
  suite: EvalSuite
  selected: boolean
  onSelect: () => void
}) {
  const agentTone = suite.agent_name?.charAt(0).toUpperCase() || 'A'
  const scoreBadgeClass =
    suite.last_run_score == null
      ? 'badge-glass'
      : suite.last_run_passed
        ? 'badge-emerald'
        : 'badge-red'

  return (
    <button
      className={clsx(
        'row w-full rounded-xl px-3 py-3 text-left transition-all',
        selected ? 'bg-indigo-500/[0.08] border-l-2 border-indigo-400' : 'hover:bg-white/[0.04]',
      )}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{suite.name}</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/15 text-[10px] font-bold text-indigo-200">
            {agentTone}
          </div>
          <span className="truncate text-xs text-[#8B9DBE]">{suite.agent_name || 'Agent'}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {suite.last_run_score == null ? (
            <span className="text-xs text-[#8B9DBE]">never</span>
          ) : (
            <span className={clsx('badge font-mono text-[10px]', scoreBadgeClass)}>
              {Math.round((suite.last_run_score || 0) * 100)}%
            </span>
          )}
          <span className="text-xs text-[#8B9DBE]">{suite.last_run_score == null ? '' : relative(suite.updated_at || suite.created_at)}</span>
        </div>
      </div>
    </button>
  )
}

function EmptyEvalHero({ onNew }: { onNew: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="card max-w-xl rounded-[28px] p-10 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-btn-primary">
          <Beaker size={28} className="text-white" />
        </div>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-white">Build your agent quality lab</h2>
        <p className="mt-3 text-[#8B9DBE]">Turn vibes into scores. Create regression suites, run them before changes, and watch agent quality improve over time.</p>
        <button className="btn-primary mt-6" onClick={onNew}><Plus size={16} /> New Eval Suite</button>
      </div>
    </div>
  )
}

function SuiteHeader({ suite, onRun, onQuickTest, quickTesting }: {
  suite: EvalSuite
  onRun: () => void
  onQuickTest: () => void
  quickTesting: boolean
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="badge badge-glass">{suite.agent_name || 'Agent'}</span>
          </div>
          <h2 className="text-3xl font-semibold tracking-[-0.05em] text-white">{suite.name}</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#8B9DBE]">{suite.description || 'No description yet.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={onQuickTest} disabled={quickTesting}>
            {quickTesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Quick Test
          </button>
          <button className="btn-primary" onClick={onRun}><Play size={15} /> Run Eval</button>
        </div>
      </div>
    </div>
  )
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'cases', label: 'CASES' },
    { id: 'runs', label: 'RUNS' },
    { id: 'insights', label: 'INSIGHTS' },
    { id: 'compare', label: 'COMPARE' },
  ]
  return (
    <div className="card flex flex-wrap gap-5 rounded-xl px-4 py-3">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={clsx(
            'border-b-2 pb-2 font-mono text-[11px] uppercase tracking-[0.14em] transition',
            tab === id ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-[#8B9DBE] hover:text-white',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function TestCasesTab({ suite, cases, latestScores, caseRunState, onAddCase, onImport, onEdit, onDelete, onRunCase }: {
  suite: EvalSuite
  cases: EvalCase[]
  latestScores: Map<string, number | null>
  caseRunState: Record<string, { loading?: boolean; passed?: boolean | null; error?: string | null }>
  onAddCase: () => void
  onImport: () => void
  onEdit: (caseItem: EvalCase) => void
  onDelete: (caseItem: EvalCase) => void
  onRunCase: (caseItem: EvalCase) => void
}) {
  if (!cases.length) {
    return (
      <div className="card rounded-[24px] border border-dashed border-white/[0.12] p-10 text-center">
        <FileJson className="mx-auto mb-3 text-indigo-300" size={30} />
        <div className="font-semibold text-white">No test cases yet</div>
        <p className="mt-2 text-sm text-[#8B9DBE]">Add cases manually or generate them from execution history.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn-secondary" onClick={onAddCase}><Plus size={14} /> Add Case</button>
          <button className="btn-ghost" onClick={onImport}>Import Cases</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={onAddCase}><Plus size={14} /> Add Case</button>
          <button className="btn-ghost" onClick={onImport}>Import Cases</button>
        </div>
        <div className="font-mono text-xs text-[#8B9DBE]">{cases.length} cases</div>
      </div>
      <div className="space-y-3">
        {cases.map(caseItem => {
          const latestScore = latestScores.get(caseItem.id)
          const state = caseRunState[caseItem.id]
          return (
            <div key={caseItem.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-white">{caseItem.name}</div>
                  <div className="mt-2 text-sm text-[#8B9DBE]">{truncate(caseItem.input, 180)}</div>
                  <div className="mt-2 text-sm italic text-[var(--text-3)]">
                    {truncate(caseItem.expected_output || 'Judge quality against the expected behavior.', 160)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {latestScore != null ? <ScoreBadge score={latestScore} threshold={suite.pass_threshold} size="sm" /> : null}
                  <button className="btn-ghost btn-sm" onClick={() => onRunCase(caseItem)}>Run this case</button>
                  <button className="btn-ghost h-8 px-2" onClick={() => onEdit(caseItem)} title="Edit"><Pencil size={14} /></button>
                  <button className="btn-ghost h-8 px-2 text-red-300" onClick={() => onDelete(caseItem)} title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              {state ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {state.loading ? (
                    <span className="badge badge-glass"><Loader2 size={12} className="animate-spin" /> running</span>
                  ) : state.passed ? (
                    <span className="badge badge-emerald">PASS</span>
                  ) : (
                    <span className="badge badge-red">FAIL</span>
                  )}
                  {!state.loading && state.error ? (
                    <span className="truncate text-xs text-red-300">{truncate(state.error, 120)}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RunHistoryTab({ suite, runs, trend, selectedRunId, selectedRun, loadingSelectedRun, onSelectRun }: {
  suite: EvalSuite
  runs: EvalRun[]
  trend: { date: string; score?: number | null; passed?: boolean | null }[]
  selectedRunId: string | null
  selectedRun: EvalRun | null
  loadingSelectedRun: boolean
  onSelectRun: (run: EvalRun) => void
}) {
  const chartData = trend.map(item => ({
    date: item.date ? format(new Date(item.date), 'MMM d') : '',
    score: item.score == null ? null : Math.round(item.score * 100),
    passed: item.passed,
  }))

  return (
    <div className="space-y-4">
      <div className="card card-indigo p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Score trend</h3>
            <p className="text-sm text-[#8B9DBE]">Reference line: {Math.round(suite.pass_threshold * 100)}% threshold</p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#71717f', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#71717f', fontSize: 11 }} tickFormatter={value => `${value}%`} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: 'rgba(8,13,26,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', backdropFilter: 'blur(16px)' }} formatter={value => [`${value}%`, 'Score']} />
              <ReferenceLine y={suite.pass_threshold * 100} stroke="#f59e0b" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-3">
        {!runs.length ? (
          <div className="card rounded-2xl border border-dashed border-white/[0.12] p-8 text-center text-[#8B9DBE]">No runs yet. Run the suite to start tracking quality.</div>
        ) : runs.map((run, index) => (
          <div key={run.id} className="card overflow-hidden">
            <button className="row min-h-[44px] w-full text-left" onClick={() => onSelectRun(run)}>
              <div className={clsx('font-mono text-sm font-semibold', (run.suite_score || 0) >= suite.pass_threshold ? 'text-emerald-300' : 'text-red-300')}>
                {Math.round((run.suite_score || 0) * 100)}%
              </div>
              <div className="text-sm text-white">{run.passed_cases}/{run.total_cases} cases</div>
              <div className="font-mono text-xs text-[#8B9DBE]">{format(new Date(run.created_at), 'MMM d, h:mm a')}</div>
              <div className="min-w-0 flex-1 truncate text-xs text-[#8B9DBE]">{run.model_config_id || run.triggered_by}</div>
              <span className={run.passed ? 'badge badge-emerald' : 'badge badge-red'}>{run.passed ? 'pass' : 'fail'}</span>
            </button>
            {selectedRunId === run.id ? (
              <div className="border-t border-white/[0.08] p-4">
                {loadingSelectedRun ? (
                  <Skeleton className="h-48" />
                ) : selectedRun ? (
                  <div className="space-y-3">
                    {(selectedRun.results || []).map(result => (
                      <div key={result.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{result.case?.name || 'Case'}</div>
                            <div className="mt-1 truncate text-xs text-[#8B9DBE]">{truncate(result.case?.input || '', 120)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={result.passed ? 'badge badge-emerald' : 'badge badge-red'}>
                              {result.passed ? 'PASS' : 'FAIL'}
                            </span>
                            {result.score != null ? <ScoreBadge score={result.score} threshold={suite.pass_threshold} size="sm" /> : null}
                          </div>
                        </div>
                        {!result.passed && (result.error_message || result.actual_output) ? (
                          <div className="mt-2 text-xs text-red-300">
                            {truncate(result.error_message || result.actual_output || '', 180)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[#8B9DBE]">No run details loaded.</div>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightsTab({ suite, insights, loading }: { suite: EvalSuite; insights?: any; loading: boolean }) {
  if (loading) return <Skeleton className="h-96" />
  const trend = insights?.score_trend || []
  const first = trend[0]?.score ?? null
  const last = trend[trend.length - 1]?.score ?? null
  const delta = first != null && last != null ? last - first : null
  const recommendation = delta == null
    ? 'Run this suite a few times to unlock quality recommendations.'
    : delta >= 0
    ? 'Quality is trending upward. Keep the current prompt/tool changes, then add harder edge cases to prevent overfitting.'
    : 'Quality is drifting down. Review failed cases first, then tighten the agent system prompt around missing requirements.'

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className={clsx('card p-5', delta != null && delta < 0 ? 'card-red' : 'card-emerald')}>
        <div className="flex items-center gap-3">
          <div className={clsx('grid h-11 w-11 place-items-center rounded-xl', delta == null || delta >= 0 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300')}>
            {delta == null || delta >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
          </div>
          <div>
            <div className="text-sm text-[#8B9DBE]">Score trend</div>
            <div className="font-mono text-2xl font-semibold text-white">{delta == null ? '—' : `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} pts`}</div>
          </div>
        </div>
      </div>
      <div className="card card-indigo p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold text-white"><Sparkles size={17} /> Recommendation</div>
        <p className="text-sm leading-6 text-[#D7E0EF]">{recommendation}</p>
      </div>
      <InsightList title="Hardest Cases" icon={AlertTriangle} items={(insights?.hardest_cases || []).filter((item: any) => (item.avg_score || 0) < 0.6).map((item: any) => `${item.case_name || item.case_id} · avg ${Math.round((item.avg_score || 0) * 100)}%`)} />
      <InsightList title="Regressions" icon={ArrowDownRight} items={(insights?.regression_cases || []).map((item: any) => item.case_name || item.case_id)} />
      <InsightList title="Most Improved" icon={ArrowUpRight} items={(insights?.most_improved_cases || []).map((item: any) => `${item.case_name || item.case_id} · +${Math.round((item.delta || 0) * 100)} pts`)} />
      <div className="card p-5">
        <div className="mb-3 font-semibold text-white">Suite threshold</div>
        <ScoreBadge score={suite.pass_threshold} threshold={suite.pass_threshold} size="lg" />
        <p className="mt-3 text-sm text-[#8B9DBE]">Runs pass when the weighted average reaches this threshold.</p>
      </div>
    </div>
  )
}

function CompareTab({
  suite,
  models,
  history,
  loadingHistory,
  onRefresh,
}: {
  suite: EvalSuite
  models: ModelConfigRecord[]
  history: EvalModelComparisonHistoryItem[]
  loadingHistory: boolean
  onRefresh: () => void
}) {
  const qc = useQueryClient()
  const [modelAId, setModelAId] = useState('')
  const [modelBId, setModelBId] = useState('')
  const [result, setResult] = useState<EvalModelComparisonResult | null>(null)
  const estimatedSeconds = Math.max((suite.case_count || suite.cases?.length || 0) * 2, 8)

  useEffect(() => {
    if (!models.length) return
    if (!modelAId) setModelAId(models[0]?.id || '')
    if (!modelBId) setModelBId(models[1]?.id || models[0]?.id || '')
  }, [modelAId, modelBId, models])

  const compareMutation = useMutation({
    mutationFn: () => evalsApi.compareModels(suite.id, modelAId, modelBId),
    onSuccess: payload => {
      setResult(payload)
      onRefresh()
      toast.success('Model comparison finished')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const applyMutation = useMutation({
    mutationFn: (modelConfigId: string) => agentsApi.assignModel(suite.agent_id, modelConfigId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['model-configs'] })
      toast.success('Winning model applied to this agent')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const winnerSide = result?.winner === 'model_a' ? result.model_a : result?.winner === 'model_b' ? result.model_b : null

  return (
    <div className="space-y-4">
      <div className="card card-indigo p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">Compare Models on This Suite</h3>
            <p className="mt-2 text-sm text-[#8B9DBE]">
              Run the same eval suite on two saved model configs and compare pass rate, speed, and cost.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] xl:min-w-[680px]">
            <select className="input" value={modelAId} onChange={e => setModelAId(e.target.value)}>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.display_name} — {model.model_id}
                </option>
              ))}
            </select>
            <div className="grid place-items-center text-sm font-semibold text-[#8B9DBE]">vs</div>
            <select className="input" value={modelBId} onChange={e => setModelBId(e.target.value)}>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.display_name} — {model.model_id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary btn-runner"
            disabled={!modelAId || !modelBId || modelAId === modelBId || compareMutation.isPending}
            onClick={() => compareMutation.mutate()}
          >
            {compareMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Running comparison...
              </>
            ) : (
              <>
                <Beaker size={16} />
                Run Comparison
              </>
            )}
          </button>
          {compareMutation.isPending && (
            <span className="text-sm text-[#8B9DBE]">This takes about {estimatedSeconds}s for two full runs.</span>
          )}
        </div>
      </div>

      {result && (
        <div className={clsx('card p-5', winnerSide ? 'card-emerald shadow-btn-approve' : 'card-indigo')}>
          <div className="grid gap-4 lg:grid-cols-2">
            {([
              ['A', result.model_a],
              ['B', result.model_b],
            ] as Array<['A' | 'B', EvalModelComparisonResult['model_a']]>).map(([slot, side]) => {
              const isWinner = result.winner === `model_${slot.toLowerCase()}`
              return (
                <div
                  key={side.model_config_id}
                  className={clsx(
                    'rounded-2xl border p-4 transition',
                    isWinner ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/[0.08] bg-white/[0.03]',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-[#8B9DBE]">Model {slot}</div>
                      <div className="mt-2 text-lg font-semibold text-white">{side.display_name || side.model_name}</div>
                      <div className="mt-1 text-sm text-[#8B9DBE]">{side.model_name}</div>
                    </div>
                    {isWinner && <span className="badge badge-emerald"><Trophy size={12} /> Winner</span>}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-white/80">
                    <div className="flex items-center justify-between"><span>Pass rate</span><span className="font-semibold text-white">{side.pass_rate}%</span></div>
                    <div className="flex items-center justify-between"><span>Avg speed</span><span className="font-semibold text-white">{side.avg_duration_seconds}s</span></div>
                    <div className="flex items-center justify-between"><span>Cost / run</span><span className="font-semibold text-white">${side.cost_usd.toFixed(4)}</span></div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-emerald-500/12 p-2 text-emerald-300">
                <CheckCircle2 size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">Winner reason</div>
                <p className="mt-1 text-sm leading-6 text-[#8B9DBE]">{result.winner_reason}</p>
              </div>
            </div>
            {winnerSide && (
              <button
                className="btn-emerald btn-runner mt-4"
                disabled={applyMutation.isPending}
                onClick={() => applyMutation.mutate(winnerSide.model_config_id)}
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>Apply {winnerSide.display_name || winnerSide.model_name} to this agent</>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-white/[0.08] px-5 py-4">
          <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">Previous Comparisons</h4>
        </div>
        {loadingHistory ? (
          <div className="p-5"><Skeleton className="h-40" /></div>
        ) : !history.length ? (
          <div className="p-5 text-sm text-[#8B9DBE]">No comparisons yet. Run one to build a history for this suite.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#8B9DBE]">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Model A</th>
                  <th className="px-4 py-3">Model B</th>
                  <th className="px-4 py-3">Winner</th>
                  <th className="px-4 py-3">Pass Rates</th>
                </tr>
              </thead>
              <tbody>
                {history.map(item => (
                  <tr key={item.comparison_group_id} className="border-t border-white/[0.05] hover:bg-white/[0.025]">
                    <td className="px-4 py-3 text-[#8B9DBE]">{relative(item.created_at)}</td>
                    <td className="px-4 py-3 text-white">{item.model_a.display_name || item.model_a.model_name}</td>
                    <td className="px-4 py-3 text-white">{item.model_b.display_name || item.model_b.model_name}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('badge', item.winner ? 'badge-emerald' : 'badge-glass')}>
                        {item.winner_label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#8B9DBE]">
                      {item.pass_rates.model_a}% vs {item.pass_rates.model_b}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SuiteForm({ open, agents, onClose, onCreated }: {
  open: boolean
  agents: { id: string; name: string; role: string }[]
  onClose: () => void
  onCreated: (suite: EvalSuite) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState('')
  const [threshold, setThreshold] = useState(0.8)
  const mutation = useMutation({
    mutationFn: () => evalsApi.createSuite({ name, description, agent_id: agentId, pass_threshold: threshold }),
    onSuccess: suite => {
      toast.success('Eval suite created')
      onCreated(suite)
      setName('')
      setDescription('')
      setAgentId('')
      setThreshold(0.8)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  useEffect(() => {
    if (!agentId && agents[0]) setAgentId(agents[0].id)
  }, [agentId, agents])

  if (!open) return null
  return (
    <ModalShell title="New eval suite" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Suite name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Support quality regression" /></Field>
        <Field label="Agent">
          <select className="input" value={agentId} onChange={e => setAgentId(e.target.value)}>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
          </select>
        </Field>
        <Field label={`Pass threshold (${Math.round(threshold * 100)}%)`}>
          <input type="range" min={0.1} max={1} step={0.05} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-full indigo-indigo-500" />
        </Field>
        <Field label="Description"><textarea className="input min-h-24 resize-none" value={description} onChange={e => setDescription(e.target.value)} /></Field>
        <button className="btn-primary w-full" disabled={!name || !agentId || mutation.isPending} onClick={() => mutation.mutate()}>
          Create Suite
        </button>
      </div>
    </ModalShell>
  )
}

function CaseForm({ open, suiteId, existing, onClose, onSaved }: {
  open: boolean
  suiteId: string | null
  existing: EvalCase | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [input, setInput] = useState('')
  const [expected, setExpected] = useState('')
  const [method, setMethod] = useState<ScoringMethod>('llm_judge')
  const [config, setConfig] = useState('{}')
  const [weight, setWeight] = useState(1)
  const [tags, setTags] = useState('')

  useEffect(() => {
    if (!open) return
    setName(existing?.name || '')
    setInput(existing?.input || '')
    setExpected(existing?.expected_output || '')
    setMethod(existing?.scoring_method || 'llm_judge')
    setConfig(JSON.stringify(existing?.scoring_config || {}, null, 2))
    setWeight(existing?.weight || 1)
    setTags(existing?.tags || '')
  }, [existing, open])

  const save = async () => {
    if (!suiteId) return
    let parsedConfig = {}
    try {
      parsedConfig = config ? JSON.parse(config) : {}
    } catch {
      toast.error('Scoring config must be valid JSON')
      return
    }
    const payload = {
      name,
      input,
      expected_output: expected || undefined,
      scoring_method: method,
      scoring_config: parsedConfig,
      weight,
      tags,
    }
    try {
      if (existing) await evalsApi.updateCase(suiteId, existing.id, payload as Partial<EvalCase>)
      else await evalsApi.createCase(suiteId, payload)
      toast.success(existing ? 'Eval case updated' : 'Eval case created')
      onSaved()
    } catch (error: any) {
      toast.error(extractApiError(error))
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="glass-elevated h-full w-full max-w-xl overflow-y-auto rounded-none border-l border-white/[0.1] p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#8B9DBE]">Eval case</div>
            <h3 className="mt-1 text-2xl font-semibold text-white">{existing ? 'Edit case' : 'Add case'}</h3>
          </div>
          <button className="btn-ghost h-9 px-2" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="space-y-4">
          <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Input"><textarea className="input min-h-32 resize-y font-mono" value={input} onChange={e => setInput(e.target.value)} /></Field>
          <Field label="Expected output"><textarea className="input min-h-28 resize-y font-mono" value={expected} onChange={e => setExpected(e.target.value)} placeholder="Optional for LLM judge" /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Scoring method">
              <select className="input capitalize" value={method} onChange={e => setMethod(e.target.value as ScoringMethod)}>
                {scoringMethods.map(item => <option key={item} value={item}>{methodLabel(item)}</option>)}
              </select>
            </Field>
            <Field label="Weight"><input className="input" type="number" min={0.1} step={0.1} value={weight} onChange={e => setWeight(Number(e.target.value))} /></Field>
          </div>
          <Field label="Tags"><input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="regression,security,happy-path" /></Field>
          <Field label="Scoring config JSON"><textarea className="input min-h-32 resize-y font-mono" value={config} onChange={e => setConfig(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={!name || !input} onClick={save}>Save Case</button>
        </div>
      </div>
    </div>
  )
}

function ImportCasesModal({ open, suite, onClose, onImported }: {
  open: boolean
  suite: EvalSuite | null
  onClose: () => void
  onImported: () => void
}) {
  const [jsonText, setJsonText] = useState('')
  const [generating, setGenerating] = useState(false)

  if (!open || !suite) return null

  const importJson = async () => {
    try {
      const parsed = JSON.parse(jsonText)
      if (!Array.isArray(parsed)) throw new Error('Expected JSON array')
      const result = await evalsApi.bulkCases(suite.id, parsed)
      toast.success(`Imported ${result.created} cases`)
      onImported()
    } catch (error: any) {
      toast.error(error.message || 'Invalid JSON array')
    }
  }

  const generate = async () => {
    setGenerating(true)
    try {
      const result = await evalsApi.generateFromHistory(suite.id, { count: 10 })
      toast.success(`Generated ${result.created} test cases`)
      onImported()
    } catch (error: any) {
      toast.error(extractApiError(error))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <ModalShell title="Import eval cases" onClose={onClose}>
      <div className="space-y-5">
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 font-medium text-white"><Sparkles size={16} /> Generate from history</div>
          <p className="mb-4 text-sm text-[#8B9DBE]">Analyzes the last 50 successful executions for this agent and creates regression cases.</p>
          <button className="btn-secondary w-full" disabled={generating} onClick={generate}>
            {generating ? 'Analyzing last 50 executions...' : 'Generate 10 Test Cases'}
          </button>
        </div>
        <Field label="Paste JSON array">
          <textarea className="input min-h-56 resize-y font-mono" value={jsonText} onChange={e => setJsonText(e.target.value)} placeholder='[{"name":"...", "input":"...", "scoring_method":"llm_judge"}]' />
        </Field>
        <button className="btn-primary w-full" onClick={importJson} disabled={!jsonText.trim()}>Import Cases</button>
      </div>
    </ModalShell>
  )
}

function InsightList({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: string[] }) {
  return (
    <div className="card card-indigo p-5">
      <div className="mb-4 flex items-center gap-2 font-semibold text-white"><Icon size={17} /> {title}</div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item, index) => <div key={`${item}-${index}`} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-[#D7E0EF]">{item}</div>)}
        </div>
      ) : (
        <p className="text-sm text-[#8B9DBE]">Nothing notable yet.</p>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="label">{label}</span>{children}</label>
}

function ModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass-elevated w-full max-w-xl rounded-2xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button className="btn-ghost h-9 px-2" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

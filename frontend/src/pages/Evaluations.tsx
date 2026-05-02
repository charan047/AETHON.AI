import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Beaker,
  Braces,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileJson,
  FlaskConical,
  History,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
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
import { agentsApi, evalsApi } from '../api/client'
import { GlowCard } from '../components/ui/GlowCard'
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton'
import { ScoreBadge } from '../components/evals/ScoreBadge'
import { RunSuiteModal } from '../components/evals/RunSuiteModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import type { EvalCase, EvalCaseResult, EvalRun, EvalSuite, ScoringMethod } from '../types'
import { toast } from '../lib/toast'

type Tab = 'cases' | 'history' | 'details' | 'insights'

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

  const refreshSelected = () => {
    qc.invalidateQueries({ queryKey: ['evals'] })
  }

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

  return (
    <div className="flex h-full min-h-0 animate-fade-in overflow-hidden">
      <aside className="flex w-80 shrink-0 flex-col border-r border-white/[0.08] bg-obsidian-925">
        <div className="border-b border-white/[0.08] p-5">
          <div className="mb-3 inline-flex rounded-full border border-accent-400/20 bg-accent-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-accent-200">
            Quality system
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em] text-white">Eval Suites</h1>
              <p className="mt-1 text-xs text-obsidian-500">Regression proof for every agent.</p>
            </div>
            <button className="btn-primary h-9 px-3 text-xs" onClick={() => setShowSuiteForm(true)}>
              <Plus size={14} /> New
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {suitesQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, index) => <Skeleton key={index} className="h-32" />)}
            </div>
          ) : !suitesQuery.data?.length ? (
            <GlowCard glowColor="cyan" className="p-5 text-center">
              <FlaskConical className="mx-auto mb-3 text-cyan-300" size={28} />
              <div className="font-medium text-white">No eval suites yet</div>
              <p className="mt-2 text-sm text-obsidian-500">Create one to start measuring your agent quality.</p>
              <button className="btn-primary mt-4 w-full" onClick={() => setShowSuiteForm(true)}>Create Suite</button>
            </GlowCard>
          ) : (
            <div className="space-y-3">
              {suitesQuery.data.map(suite => (
                <SuiteCard
                  key={suite.id}
                  suite={suite}
                  selected={suite.id === selectedSuiteId}
                  onSelect={() => {
                    setSelectedSuiteId(suite.id)
                    setTab('cases')
                    setSelectedRunId(null)
                  }}
                  onRun={() => runSuite(suite)}
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
              onImport={() => setShowImport(true)}
              onAddCase={() => {
                setEditingCase(null)
                setShowCaseForm(true)
              }}
            />
            <Tabs tab={tab} setTab={setTab} hasRun={Boolean(activeRunId)} />

            {tab === 'cases' && (
              <TestCasesTab
                suite={detailQuery.data}
                cases={cases}
                latestScores={latestScores}
                onEdit={caseItem => {
                  setEditingCase(caseItem)
                  setShowCaseForm(true)
                }}
                onDelete={caseItem => setCaseToDelete(caseItem)}
                onRunCase={async caseItem => {
                  try {
                    const run = await evalsApi.runCase(detailQuery.data!.id, caseItem.id)
                    toast.success(run.passed ? 'Case passed' : 'Case failed')
                    setSelectedRunId(run.id)
                    setTab('details')
                    refreshSelected()
                  } catch (error: any) {
                    toast.error(error.response?.data?.detail || 'Failed to run case')
                  }
                }}
              />
            )}

            {tab === 'history' && (
              <RunHistoryTab
                suite={detailQuery.data}
                runs={runsQuery.data?.runs || []}
                trend={runsQuery.data?.score_trend || []}
                onSelectRun={run => {
                  setSelectedRunId(run.id)
                  setTab('details')
                }}
              />
            )}

            {tab === 'details' && (
              <RunDetailsTab
                suite={detailQuery.data}
                run={runDetailQuery.data || null}
                loading={runDetailQuery.isLoading}
              />
            )}

            {tab === 'insights' && (
              <InsightsTab suite={detailQuery.data} insights={insightsQuery.data} loading={insightsQuery.isLoading} />
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

function SuiteCard({ suite, selected, onSelect, onRun }: {
  suite: EvalSuite
  selected: boolean
  onSelect: () => void
  onRun: () => void
}) {
  return (
    <GlowCard active={selected} hoverable glowColor={suite.last_run_passed === false ? 'red' : 'indigo'} className="p-4">
      <button className="block w-full text-left" onClick={onSelect}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{suite.name}</div>
            <div className="mt-2 inline-flex max-w-full rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-xs text-cyan-200">
              <span className="truncate">{suite.agent_name || 'Agent'}</span>
            </div>
          </div>
          <ScoreBadge score={suite.last_run_score} threshold={suite.pass_threshold} size="sm" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-obsidian-500">
          <div>{suite.case_count || 0} cases</div>
          <div className="text-right">{suite.last_run_score == null ? 'Never run' : relative(suite.updated_at || suite.created_at)}</div>
        </div>
      </button>
      <button className="btn-secondary mt-3 h-9 w-full text-xs" onClick={onRun}>
        <Play size={13} /> Run Now
      </button>
    </GlowCard>
  )
}

function EmptyEvalHero({ onNew }: { onNew: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <GlowCard glowColor="cyan" className="max-w-xl p-10 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent-500 to-cyan-500 shadow-glow-md">
          <Beaker size={28} className="text-white" />
        </div>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-white">Build your agent quality lab</h2>
        <p className="mt-3 text-obsidian-400">Turn vibes into scores. Create regression suites, run them before changes, and watch agent quality improve over time.</p>
        <button className="btn-primary mt-6" onClick={onNew}><Plus size={16} /> New Eval Suite</button>
      </GlowCard>
    </div>
  )
}

function SuiteHeader({ suite, onRun, onImport, onAddCase }: {
  suite: EvalSuite
  onRun: () => void
  onImport: () => void
  onAddCase: () => void
}) {
  return (
    <GlowCard glowColor="indigo" className="p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="badge-purple">{suite.status}</span>
            <span className="badge-blue">{suite.agent_name || 'Agent'}</span>
            <span className="badge-gray">v{suite.version}</span>
          </div>
          <h2 className="text-3xl font-semibold tracking-[-0.05em] text-white">{suite.name}</h2>
          <p className="mt-2 max-w-2xl text-sm text-obsidian-400">{suite.description || 'No description yet.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={onImport}><Upload size={15} /> Import Cases</button>
          <button className="btn-secondary" onClick={onAddCase}><Plus size={15} /> Add Case</button>
          <button className="btn-primary" onClick={onRun}><Play size={15} /> Run Suite</button>
        </div>
      </div>
    </GlowCard>
  )
}

function Tabs({ tab, setTab, hasRun }: { tab: Tab; setTab: (tab: Tab) => void; hasRun: boolean }) {
  const tabs: { id: Tab; label: string; icon: LucideIcon; disabled?: boolean }[] = [
    { id: 'cases', label: 'Test Cases', icon: FileJson },
    { id: 'history', label: 'Run History', icon: History },
    { id: 'details', label: 'Run Details', icon: Braces, disabled: !hasRun },
    { id: 'insights', label: 'Insights', icon: Sparkles },
  ]
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-white/[0.08] bg-obsidian-900 p-1">
      {tabs.map(({ id, label, icon: Icon, disabled }) => (
        <button
          key={id}
          disabled={disabled}
          onClick={() => setTab(id)}
          className={clsx(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40',
            tab === id ? 'bg-accent-500 text-white shadow-glow-sm' : 'text-obsidian-400 hover:bg-white/[0.04] hover:text-white',
          )}
        >
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  )
}

function TestCasesTab({ suite, cases, latestScores, onEdit, onDelete, onRunCase }: {
  suite: EvalSuite
  cases: EvalCase[]
  latestScores: Map<string, number | null>
  onEdit: (caseItem: EvalCase) => void
  onDelete: (caseItem: EvalCase) => void
  onRunCase: (caseItem: EvalCase) => void
}) {
  const columns = useMemo<ColumnDef<EvalCase>[]>(() => [
    { header: 'Name', accessorKey: 'name', cell: info => <span className="font-medium text-white">{String(info.getValue())}</span> },
    { header: 'Input', accessorKey: 'input', cell: info => <span className="text-obsidian-400">{truncate(String(info.getValue()), 72)}</span> },
    { header: 'Expected', accessorKey: 'expected_output', cell: info => <span className="text-obsidian-400">{truncate(String(info.getValue() || 'Judge quality'), 72)}</span> },
    { header: 'Scoring Method', accessorKey: 'scoring_method', cell: info => <span className="badge-purple capitalize">{methodLabel(String(info.getValue()))}</span> },
    { header: 'Weight', accessorKey: 'weight', cell: info => <span className="font-mono text-obsidian-300">{Number(info.getValue()).toFixed(1)}</span> },
    { header: 'Last Score', id: 'last_score', cell: ({ row }) => <ScoreBadge score={latestScores.get(row.original.id)} threshold={suite.pass_threshold} size="sm" /> },
    {
      header: 'Actions',
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost h-8 px-2" onClick={() => onRunCase(row.original)} title="Run just this case"><Play size={14} /></button>
          <button className="btn-ghost h-8 px-2" onClick={() => onEdit(row.original)} title="Edit"><Pencil size={14} /></button>
          <button className="btn-ghost h-8 px-2 text-red-300" onClick={() => onDelete(row.original)} title="Delete"><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [latestScores, onDelete, onEdit, onRunCase, suite.pass_threshold])

  const table = useReactTable({ data: cases, columns, getCoreRowModel: getCoreRowModel() })

  if (!cases.length) {
    return (
      <GlowCard glowColor="cyan" className="p-10 text-center">
        <FileJson className="mx-auto mb-3 text-cyan-300" size={30} />
        <div className="font-semibold text-white">No test cases yet</div>
        <p className="mt-2 text-sm text-obsidian-500">Add cases manually or generate them from execution history.</p>
      </GlowCard>
    )
  }

  return (
    <GlowCard glowColor="indigo" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.08] bg-white/[0.03] text-xs uppercase tracking-wide text-obsidian-500">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="px-4 py-3 text-left last:text-right">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b border-white/[0.05] hover:bg-white/[0.025]">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="max-w-[280px] px-4 py-4 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlowCard>
  )
}

function RunHistoryTab({ suite, runs, trend, onSelectRun }: {
  suite: EvalSuite
  runs: EvalRun[]
  trend: { date: string; score?: number | null; passed?: boolean | null }[]
  onSelectRun: (run: EvalRun) => void
}) {
  const chartData = trend.map(item => ({
    date: item.date ? format(new Date(item.date), 'MMM d') : '',
    score: item.score == null ? null : Math.round(item.score * 100),
    passed: item.passed,
  }))

  return (
    <div className="space-y-4">
      <GlowCard glowColor="indigo" className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Score trend</h3>
            <p className="text-sm text-obsidian-500">Reference line: {Math.round(suite.pass_threshold * 100)}% threshold</p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#71717f', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#71717f', fontSize: 11 }} tickFormatter={value => `${value}%`} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }} formatter={value => [`${value}%`, 'Score']} />
              <ReferenceLine y={suite.pass_threshold * 100} stroke="#f59e0b" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </GlowCard>

      <div className="space-y-3">
        {!runs.length ? (
          <GlowCard glowColor="cyan" className="p-8 text-center text-obsidian-400">No runs yet. Run the suite to start tracking quality.</GlowCard>
        ) : runs.map((run, index) => (
          <GlowCard key={run.id} glowColor={run.passed ? 'cyan' : 'red'} className="p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] font-mono text-sm text-white">#{runs.length - index}</div>
                <div>
                  <div className="font-medium text-white">{format(new Date(run.created_at), 'MMM d, yyyy h:mm a')}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-obsidian-500">
                    <span>{run.passed_cases}/{run.total_cases} passed</span>
                    <span>{run.error_cases} errors</span>
                    <span>{run.duration_seconds || 0}s</span>
                    <span>${(run.total_cost_usd || 0).toFixed(5)}</span>
                    {run.git_commit && <span className="font-mono">{run.git_commit.slice(0, 7)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={run.passed ? 'badge-green' : 'badge-red'}>{run.passed ? 'PASSED' : 'FAILED'}</span>
                <span className="badge-gray">{run.triggered_by}</span>
                <ScoreBadge score={run.suite_score} threshold={suite.pass_threshold} size="lg" />
                <button className="btn-secondary h-9 text-xs" onClick={() => onSelectRun(run)}>View Details</button>
              </div>
            </div>
          </GlowCard>
        ))}
      </div>
    </div>
  )
}

function RunDetailsTab({ suite, run, loading }: { suite: EvalSuite; run: EvalRun | null; loading: boolean }) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'errors'>('all')
  const results = (run?.results || []).filter(result => {
    if (filter === 'passed') return result.passed
    if (filter === 'failed') return !result.passed && !result.error_message
    if (filter === 'errors') return Boolean(result.error_message)
    return true
  })

  if (loading) return <Skeleton className="h-96" />
  if (!run) return <GlowCard glowColor="cyan" className="p-8 text-center text-obsidian-400">No run selected yet.</GlowCard>

  return (
    <div className="space-y-4">
      <GlowCard glowColor={run.passed ? 'cyan' : 'red'} className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">Run summary</h3>
            <p className="mt-1 text-sm text-obsidian-500">{format(new Date(run.created_at), 'MMM d, yyyy h:mm a')} · {run.triggered_by}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ScoreBadge score={run.suite_score} threshold={suite.pass_threshold} size="lg" />
            <Metric label="Passed" value={`${run.passed_cases}/${run.total_cases}`} />
            <Metric label="Errors" value={String(run.error_cases)} />
            <Metric label="Cost" value={`$${(run.total_cost_usd || 0).toFixed(5)}`} />
          </div>
        </div>
      </GlowCard>

      <div className="flex flex-wrap gap-2">
        {(['all', 'passed', 'failed', 'errors'] as const).map(value => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={clsx('rounded-lg px-3 py-2 text-sm capitalize transition', filter === value ? 'bg-accent-500 text-white' : 'bg-white/[0.04] text-obsidian-400 hover:text-white')}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {results.map(result => <CaseResultCard key={result.id} result={result} suite={suite} />)}
      </div>
    </div>
  )
}

function CaseResultCard({ result, suite }: { result: EvalCaseResult; suite: EvalSuite }) {
  const [open, setOpen] = useState(false)
  const details = result.scoring_details || {}
  const reasoning = typeof details.reasoning === 'string' ? details.reasoning : ''
  const strengths = Array.isArray(details.strengths) ? details.strengths : []
  const weaknesses = Array.isArray(details.weaknesses) ? details.weaknesses : []

  return (
    <GlowCard glowColor={result.passed ? 'cyan' : 'red'} className="overflow-hidden">
      <button className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(value => !value)}>
        <div className="flex min-w-0 items-center gap-3">
          {open ? <ChevronDown size={16} className="text-obsidian-500" /> : <ChevronRight size={16} className="text-obsidian-500" />}
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{result.case?.name || 'Eval case'}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-obsidian-500">
              <span className="badge-purple capitalize">{methodLabel(result.case?.scoring_method)}</span>
              <span>{(result.duration_seconds || 0).toFixed(1)}s</span>
              <span>{result.tokens_used || 0} tokens</span>
              <span>${(result.cost_usd || 0).toFixed(5)}</span>
            </div>
          </div>
        </div>
        <ScoreBadge score={result.score} threshold={suite.pass_threshold} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-white/[0.08] p-4">
          {result.error_message && (
            <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{result.error_message}</div>
          )}
          {reasoning && <JudgeBlock title="Judge reasoning" value={reasoning} />}
          {!!strengths.length && <JudgeBlock title="Strengths" value={strengths.map(String).join('\n')} />}
          {!!weaknesses.length && <JudgeBlock title="Weaknesses" value={weaknesses.map(String).join('\n')} />}
          <DiffSection title="Input" value={result.case?.input} />
          <DiffSection title="Expected" value={result.case?.expected_output || 'No specific expected output'} />
          <DiffSection title="Actual" value={result.actual_output || ''} highlight />
          <DiffSection title="Scoring details JSON" value={JSON.stringify(details, null, 2)} />
        </div>
      )}
    </GlowCard>
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
      <GlowCard glowColor={delta == null || delta >= 0 ? 'cyan' : 'red'} className="p-5">
        <div className="flex items-center gap-3">
          <div className={clsx('grid h-11 w-11 place-items-center rounded-xl', delta == null || delta >= 0 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300')}>
            {delta == null || delta >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
          </div>
          <div>
            <div className="text-sm text-obsidian-500">Score Trend</div>
            <div className="font-mono text-2xl font-semibold text-white">{delta == null ? '—' : `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} pts`}</div>
          </div>
        </div>
      </GlowCard>
      <GlowCard glowColor="indigo" className="p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold text-white"><Sparkles size={17} /> Recommendation</div>
        <p className="text-sm leading-6 text-obsidian-300">{recommendation}</p>
      </GlowCard>
      <InsightList title="Hardest Cases" icon={AlertTriangle} items={(insights?.hardest_cases || []).filter((item: any) => (item.avg_score || 0) < 0.6).map((item: any) => `${item.case_name || item.case_id} · avg ${Math.round((item.avg_score || 0) * 100)}%`)} />
      <InsightList title="Regressions" icon={ArrowDownRight} items={(insights?.regression_cases || []).map((item: any) => item.case_name || item.case_id)} />
      <InsightList title="Most Improved" icon={ArrowUpRight} items={(insights?.most_improved_cases || []).map((item: any) => `${item.case_name || item.case_id} · +${Math.round((item.delta || 0) * 100)} pts`)} />
      <GlowCard glowColor="cyan" className="p-5">
        <div className="mb-3 font-semibold text-white">Suite threshold</div>
        <ScoreBadge score={suite.pass_threshold} threshold={suite.pass_threshold} size="lg" />
        <p className="mt-3 text-sm text-obsidian-500">Runs pass when the weighted average reaches this threshold.</p>
      </GlowCard>
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
    onError: (error: any) => toast.error(error.response?.data?.detail || 'Failed to create suite'),
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
          <input type="range" min={0.1} max={1} step={0.05} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-full accent-indigo-500" />
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
      toast.error(error.response?.data?.detail || 'Failed to save case')
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-white/[0.1] bg-obsidian-900 p-6 shadow-glow-md">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-obsidian-500">Eval case</div>
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
      toast.error(error.response?.data?.detail || 'Failed to generate cases')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <ModalShell title="Import eval cases" onClose={onClose}>
      <div className="space-y-5">
        <GlowCard glowColor="cyan" className="p-4">
          <div className="mb-2 flex items-center gap-2 font-medium text-white"><Sparkles size={16} /> Generate from history</div>
          <p className="mb-4 text-sm text-obsidian-500">Analyzes the last 50 successful executions for this agent and creates regression cases.</p>
          <button className="btn-secondary w-full" disabled={generating} onClick={generate}>
            {generating ? 'Analyzing last 50 executions...' : 'Generate 10 Test Cases'}
          </button>
        </GlowCard>
        <Field label="Paste JSON array">
          <textarea className="input min-h-56 resize-y font-mono" value={jsonText} onChange={e => setJsonText(e.target.value)} placeholder='[{"name":"...", "input":"...", "scoring_method":"llm_judge"}]' />
        </Field>
        <button className="btn-primary w-full" onClick={importJson} disabled={!jsonText.trim()}>Import Cases</button>
      </div>
    </ModalShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] text-obsidian-500">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function DiffSection({ title, value, highlight = false }: { title: string; value?: string | null; highlight?: boolean }) {
  return (
    <details className="rounded-xl border border-white/[0.08] bg-black/20">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white">{title}</summary>
      <pre className={clsx('max-h-80 overflow-auto whitespace-pre-wrap border-t border-white/[0.08] p-4 font-mono text-xs leading-6', highlight ? 'text-cyan-100' : 'text-obsidian-300')}>
        {value || '—'}
      </pre>
    </details>
  )
}

function JudgeBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-accent-400/20 bg-accent-400/10 p-3">
      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-accent-200">{title}</div>
      <div className="whitespace-pre-wrap text-sm text-obsidian-200">{value}</div>
    </div>
  )
}

function InsightList({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: string[] }) {
  return (
    <GlowCard glowColor="indigo" className="p-5">
      <div className="mb-4 flex items-center gap-2 font-semibold text-white"><Icon size={17} /> {title}</div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item, index) => <div key={`${item}-${index}`} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-obsidian-300">{item}</div>)}
        </div>
      ) : (
        <p className="text-sm text-obsidian-500">Nothing notable yet.</p>
      )}
    </GlowCard>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="label">{label}</span>{children}</label>
}

function ModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-white/[0.1] bg-obsidian-900 p-6 shadow-glow-md">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button className="btn-ghost h-9 px-2" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

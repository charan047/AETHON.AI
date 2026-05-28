import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, MarkerType,
  type Connection, type Edge, type Node,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { workflowsApi, agentsApi, executionsApi, extractApiError } from '../api/client'
import { PageShell } from '../components/Layout/PageShell'
import { AgentNode } from '../components/Workflow/AgentNode'
import { ApprovalNode } from '../components/Workflow/nodes/ApprovalNode'
import { ConditionNode } from '../components/Workflow/nodes/ConditionNode'
import { ParallelGroupNode } from '../components/Workflow/nodes/ParallelGroupNode'
import { EmptyState } from '../components/ui/EmptyState'
import { VersionHistory } from '../components/workflows/VersionHistory'
import { Plus, Save, Play, Square, Trash2, GitBranch, ChevronLeft, X, Layers, MessageSquare, Copy, Cpu, GitMerge, Hand, GitCompareArrows, CalendarClock, Webhook, SunMedium, Newspaper, FileText, Search, Clock3 } from 'lucide-react'
import { clsx } from 'clsx'
import type { Workflow, Agent, AutomationTemplate, ScheduledWorkflow, WorkflowInputVariable } from '../types'
import { SkeletonCard } from '../components/ui/Skeleton'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { DotGrid } from '../components/reactbits/DotGrid'
import { toast } from '../lib/toast'

const nodeTypes = {
  agentNode: AgentNode,
  approval: ApprovalNode,
  condition: ConditionNode,
  parallel_group: ParallelGroupNode,
}

const SCHEDULE_PRESETS = [
  { label: 'Weekdays 8am', cron: '0 8 * * 1-5' },
  { label: 'Monday', cron: '0 9 * * 1' },
  { label: 'Friday 5pm', cron: '0 17 * * 5' },
]

function formatRunTime(iso?: string | null) {
  if (!iso) return 'Not scheduled yet'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? 'Not scheduled yet'
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function workflowStatusBadge(status?: string | null) {
  if (status === 'active' || status === 'completed') return 'badge badge-green'
  if (status === 'paused' || status === 'pending_review') return 'badge badge-amber'
  if (status === 'failed') return 'badge badge-red'
  return 'badge badge-glass'
}

function statusActionLabel(status?: string | null) {
  if (status === 'active') return 'Pause'
  if (status === 'paused') return 'Resume'
  return 'Activate'
}

function nextStatus(status?: string | null) {
  if (status === 'active') return 'paused'
  return 'active'
}

function workflowSortOrder(status?: string | null) {
  if (status === 'active') return 0
  if (status === 'paused') return 1
  return 2
}

function canActivateWorkflow(workflow: Workflow) {
  return Boolean((workflow.nodes || []).length)
}

function createWorkflowDraft(): Partial<Workflow> {
  return {
    name: 'New Process',
    description: 'Describe the operating loop this workflow should run for your agency.',
    trigger: 'manual',
    execution_mode: 'sequential',
    requires_review: false,
    input_variables: [],
    nodes: [
      {
        id: 'node-1',
        type: 'agentNode',
        position: { x: 220, y: 200 },
        data: { label: 'Agent 1' },
      },
    ],
    edges: [],
  }
}

function automationIcon(id: string) {
  if (id === 'morning_brief') return SunMedium
  if (id === 'weekly_client_reports') return FileText
  return Newspaper
}

function normalizeNodeType(type?: string) {
  if (!type || type === 'agent') return 'agentNode'
  return type
}

function normalizeNodePosition(position: { x?: number; y?: number } | undefined, index: number) {
  return {
    x: typeof position?.x === 'number' ? position.x : 180 + index * 220,
    y: typeof position?.y === 'number' ? position.y : 180,
  }
}

function normalizeWorkflowInputVariables(inputVariables?: WorkflowInputVariable[] | null): WorkflowInputVariable[] {
  return (inputVariables || []).map((variable, index) => ({
    name: String(variable.name || `input_${index + 1}`),
    label: String(variable.label || variable.name || `Input ${index + 1}`),
    type: variable.type === 'select' || variable.type === 'textarea' ? variable.type : 'text',
    required: Boolean(variable.required),
    default: String(variable.default || ''),
    options: Array.isArray(variable.options)
      ? variable.options.map(option => String(option).trim()).filter(Boolean)
      : [],
  }))
}

function createWorkflowInputVariable(index: number): WorkflowInputVariable {
  return {
    name: `input_${index + 1}`,
    label: `Input ${index + 1}`,
    type: 'text',
    required: false,
    default: '',
    options: [],
  }
}

function buildVariableRunDefaults(inputVariables: WorkflowInputVariable[]): Record<string, string> {
  return inputVariables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable.name] = variable.default || ''
    return acc
  }, {})
}

function WorkflowBuilder({ workflow, agents, onSave, onClose }: {
  workflow: Partial<Workflow>
  agents: Agent[]
  onSave: (wf: Partial<Workflow>) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const availableNodeOptions = (workflow.nodes || []).map(n => ({
    id: n.id,
    label: String(n.data?.label || n.data?.title || n.id),
  }))
  const initNodes: Node<any>[] = (workflow.nodes || []).map((n, index) => ({
    ...n,
    type: normalizeNodeType(n.type),
    position: normalizeNodePosition(n.position, index),
    data: {
      ...n.data,
      agentName: agents.find(a => a.id === n.data.agent_id)?.name,
      agents,
      availableNodes: availableNodeOptions,
      onRemove: (id: string): void => setNodes(ns => ns.filter(n => n.id !== id)),
      onUpdate: (id: string, patch: Record<string, unknown>): void => setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    },
  }))

  const [nodes, setNodes, onNodesChange] = useNodesState<any>(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>(workflow.edges || [])
  const [name, setName] = useState(workflow.name || '')
  const [desc, setDesc] = useState(workflow.description || '')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [inputVariables, setInputVariables] = useState<WorkflowInputVariable[]>(
    normalizeWorkflowInputVariables(workflow.input_variables),
  )
  const [runPanelOpen, setRunPanelOpen] = useState(false)
  const [runVariableValues, setRunVariableValues] = useState<Record<string, string>>(
    buildVariableRunDefaults(normalizeWorkflowInputVariables(workflow.input_variables)),
  )
  const [runValidationError, setRunValidationError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [mode, setMode] = useState<'sequential' | 'orchestrator'>(workflow.execution_mode || 'sequential')
  const [orchPrompt, setOrchPrompt] = useState(workflow.orchestration_prompt || '')
  const [requiresReview, setRequiresReview] = useState(Boolean(workflow.requires_review))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [scheduleValue, setScheduleValue] = useState(workflow.schedule || '')
  const [scheduleTimezone, setScheduleTimezone] = useState(workflow.schedule_timezone || 'UTC')
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(workflow.schedule_enabled))
  const idRef = useRef(Date.now())
  const runPanelRef = useRef<HTMLDivElement | null>(null)
  const qc = useQueryClient()
  const hasStructuredInputs = inputVariables.length > 0
  const nextRunLabel = scheduleEnabled && scheduleValue ? 'Runs after schedule save' : 'Manual only'
  const selectedSchedulePreset = SCHEDULE_PRESETS.find(preset => preset.cron === scheduleValue)?.cron || null
  const webhookId = useMemo(() => workflow.id || 'unsaved', [workflow.id])

  const { data: webhookInfo } = useQuery({
    queryKey: ['workflow-webhook-url', workflow.id],
    queryFn: () => workflowsApi.webhookUrl(workflow.id!),
    enabled: Boolean(workflow.id),
  })
  const scheduleMut = useMutation({
    mutationFn: () => workflowsApi.setSchedule(workflow.id!, scheduleValue, scheduleEnabled, scheduleTimezone),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workflows'] }),
        qc.invalidateQueries({ queryKey: ['workflows-scheduled'] }),
      ])
      toast.success(scheduleEnabled ? 'Schedule saved' : 'Schedule disabled')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  useEffect(() => {
    if (!runPanelOpen) return undefined

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRunPanelOpen(false)
        setRunValidationError(null)
      }
    }

    const onPointerDown = (event: MouseEvent) => {
      if (runPanelRef.current && event.target instanceof globalThis.Node && !runPanelRef.current.contains(event.target)) {
        setRunPanelOpen(false)
        setRunValidationError(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [runPanelOpen])

  const onConnect = useCallback((connection: Connection) => {
    setEdges(es => addEdge({ ...connection, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, es))
  }, [setEdges])

  const addNode = () => {
    const id = `node-${++idRef.current}`
    const newNode: Node = {
      id, type: 'agentNode',
      position: { x: 200 + nodes.length * 220, y: 200 },
      data: { label: `Agent ${nodes.length + 1}`, onRemove: (nid: string) => setNodes(ns => ns.filter(n => n.id !== nid)) },
    }
    setNodes(ns => [...ns, newNode])
  }

  const addApprovalNode = () => {
    const id = `approval-${++idRef.current}`
    setNodes(ns => [...ns, {
      id,
      type: 'approval',
      position: { x: 200 + ns.length * 220, y: 120 },
      data: {
        title: 'Review required before continuing',
        label: 'Human approval',
        description: '',
        timeout_hours: 24,
        auto_approve_on_timeout: false,
        onRemove: (nid: string) => setNodes(nodes => nodes.filter(n => n.id !== nid)),
        onUpdate: (nid: string, patch: Record<string, unknown>) => setNodes(nodes => nodes.map(n => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)),
      },
    }])
  }

  const addConditionNode = () => {
    const id = `condition-${++idRef.current}`
    setNodes(ns => [...ns, {
      id,
      type: 'condition',
      position: { x: 200 + ns.length * 220, y: 300 },
      data: {
        label: 'Check condition',
        evaluation_mode: 'contains',
        conditions: [],
        default_target_node_id: '',
        availableNodes: ns.map(n => ({ id: n.id, label: String(n.data?.label || n.data?.title || n.id) })),
        onRemove: (nid: string) => setNodes(nodes => nodes.filter(n => n.id !== nid)),
        onUpdate: (nid: string, patch: Record<string, unknown>) => setNodes(nodes => nodes.map(n => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)),
      },
    }])
  }

  const addParallelGroupNode = () => {
    const id = `parallel-${++idRef.current}`
    setNodes(ns => [...ns, {
      id,
      type: 'parallel_group',
      position: { x: 200 + ns.length * 220, y: 460 },
      data: {
        label: 'Parallel research phase',
        agent_ids: [],
        merge_strategy: 'concatenate',
        merge_separator: '\n\n---\n\n',
        agents,
        onRemove: (nid: string) => setNodes(nodes => nodes.filter(n => n.id !== nid)),
        onUpdate: (nid: string, patch: Record<string, unknown>) => setNodes(nodes => nodes.map(n => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)),
      },
    }])
  }

  const assignAgent = (nodeId: string, agent: Agent) => {
    setNodes(ns => ns.map(n => n.id !== nodeId ? n : {
      ...n,
      data: { ...n.data, label: agent.name, agent_id: agent.id, agentName: agent.name, role: agent.role },
    }))
    setSelectedNode(null)
  }

  const save = () => {
    if (!name) { toast.error('Please enter a process name'); return }
    const cleanNodes = nodes.map(({ id, type, position, data }, index) => ({
      id,
      type: normalizeNodeType(type),
      position: normalizeNodePosition(position, index),
      data: {
        label: data.label,
        title: data.title,
        description: data.description,
        timeout_hours: data.timeout_hours,
        auto_approve_on_timeout: data.auto_approve_on_timeout,
        evaluation_mode: data.evaluation_mode,
        conditions: data.conditions,
        default_target_node_id: data.default_target_node_id,
        agent_id: data.agent_id,
        agent_ids: data.agent_ids,
        merge_strategy: data.merge_strategy,
        merge_separator: data.merge_separator,
        role: data.role,
      },
    }))
    const cleanEdges = edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target, animated: e.animated, label: typeof e.label === 'string' ? e.label : undefined }))
    onSave({
      name,
      description: desc,
      nodes: cleanNodes,
      edges: cleanEdges,
      execution_mode: mode,
      orchestration_prompt: orchPrompt,
      requires_review: requiresReview,
      input_variables: inputVariables,
    })
  }

  const run = async () => {
    if (!workflow.id) { toast.error('Save the process first'); return }
    if (!runInput) { toast.error('Enter an input message'); return }
    setRunning(true)
    setRunningId(null)
    try {
      const execution = await executionsApi.run(workflow.id, runInput)
      setRunning(true)
      setRunningId(execution.execution_id)
      toast.info('Run started')
      setRunInput('')
      navigate(`/executions/${execution.execution_id}`)
    } catch (e) {
      setRunning(false)
      setRunningId(null)
      toast.error(extractApiError(e))
    }
  }

  const openRunPanel = () => {
    if (!workflow.id) { toast.error('Save the process first'); return }
    setRunVariableValues(buildVariableRunDefaults(inputVariables))
    setRunValidationError(null)
    setRunPanelOpen(true)
  }

  const runWithVariables = async () => {
    if (!workflow.id) { toast.error('Save the process first'); return }

    const missing = inputVariables
      .filter(variable => variable.required && !(runVariableValues[variable.name] || variable.default || '').trim())
      .map(variable => variable.label || variable.name)

    if (missing.length > 0) {
      const message = `Please fill the required inputs: ${missing.join(', ')}`
      setRunValidationError(message)
      toast.error(message)
      return
    }

    setRunning(true)
    setRunningId(null)
    setRunValidationError(null)
    try {
      const execution = await workflowsApi.run(
        workflow.id,
        Object.fromEntries(
          Object.entries(runVariableValues).map(([key, value]) => [key, value.trim()]),
        ),
      )
      setRunning(true)
      setRunningId(execution.execution_id)
      setRunPanelOpen(false)
      toast.info('Run started')
      navigate(`/executions/${execution.execution_id}`)
    } catch (e) {
      setRunning(false)
      setRunningId(null)
      toast.error(extractApiError(e))
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={onClose}><ChevronLeft size={18} /></button>
          <div className="min-w-0 flex-1">
            {isEditingName ? (
              <input
                autoFocus
                aria-label="Process name"
                className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xl font-semibold tracking-[-0.03em] text-[var(--t1)] outline-none focus:border-indigo-400"
                value={name}
                placeholder="Process name"
                onChange={event => setName(event.target.value)}
                onBlur={() => {
                  setIsEditingName(false)
                  if (workflow.id) save()
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    setIsEditingName(false)
                    if (workflow.id) save()
                  }
                }}
              />
            ) : (
              <button type="button" className="text-left" aria-label="Edit process name" onClick={() => setIsEditingName(true)}>
                <div className="truncate text-xl font-semibold tracking-[-0.03em] text-[var(--t1)]">{name || workflow.name || 'Untitled process'}</div>
                <div className="mt-1 truncate text-xs text-[var(--t2)]">{desc || 'Click the title to rename. Save persists nodes, review rules, variables, and schedule.'}</div>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {workflow.id && (
              <button className="btn-ghost text-xs" onClick={() => setHistoryOpen(true)}>
                <GitCompareArrows size={14} /> History
              </button>
            )}
            <button className="btn-secondary text-xs" onClick={save}>
              <Save size={14} /> Save
            </button>
            {workflow.id && (
              <div className="relative flex items-center gap-2" ref={runPanelRef}>
                {hasStructuredInputs ? (
                  <>
                    <button className="btn-primary text-xs" onClick={openRunPanel} disabled={running}>
                      <Play size={14} /> {running ? 'Running...' : 'Run'}
                    </button>
                    {runPanelOpen && (
                      <div className="glass-elevated absolute right-0 top-[calc(100%+0.75rem)] z-30 w-[360px] p-4">
                        <div className="mb-1 text-sm font-semibold text-white">Run {name || workflow.name || 'Process'}</div>
                        <p className="mb-3 text-xs text-[var(--t2)]">Fill in the inputs for this run.</p>
                        <div className="mb-3 flex flex-wrap gap-2">
                          {inputVariables.map(variable => (
                            <span key={variable.name} className="badge badge-indigo">
                              {variable.label || variable.name}
                            </span>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {inputVariables.map(variable => (
                            <label key={variable.name} className="block">
                              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-white">
                                <span>{variable.label || variable.name}</span>
                                {variable.required && <span className="text-red-400">*</span>}
                              </div>
                              {variable.type === 'select' ? (
                                <select
                                  className="input w-full"
                                  value={runVariableValues[variable.name] ?? variable.default ?? ''}
                                  onChange={event => setRunVariableValues(current => ({ ...current, [variable.name]: event.target.value }))}
                                >
                                  <option value="">Select an option</option>
                                  {(variable.options || []).map(option => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                </select>
                              ) : variable.type === 'textarea' ? (
                                <textarea
                                  className="input min-h-[104px] w-full resize-y py-2"
                                  placeholder={variable.default || `Enter ${variable.label || variable.name}`}
                                  value={runVariableValues[variable.name] ?? variable.default ?? ''}
                                  onChange={event => setRunVariableValues(current => ({ ...current, [variable.name]: event.target.value }))}
                                />
                              ) : (
                                <input
                                  type="text"
                                  className="input w-full"
                                  placeholder={variable.default || `Enter ${variable.label || variable.name}`}
                                  value={runVariableValues[variable.name] ?? variable.default ?? ''}
                                  onChange={event => setRunVariableValues(current => ({ ...current, [variable.name]: event.target.value }))}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                        {runValidationError ? <p className="mt-3 text-xs text-red-300">{runValidationError}</p> : null}
                        <div className="mt-4 flex items-center justify-end gap-2">
                          <button type="button" className="btn-ghost text-xs" onClick={() => { setRunPanelOpen(false); setRunValidationError(null) }}>
                            Cancel
                          </button>
                          <button className="btn-primary text-xs" onClick={runWithVariables} disabled={running}>
                            <Play size={14} /> Start Run
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      className="input w-48 text-xs"
                      placeholder="Task input..."
                      value={runInput}
                      onChange={event => setRunInput(event.target.value)}
                    />
                    <button className="btn-primary text-xs" onClick={run} disabled={running}>
                      <Play size={14} /> Run
                    </button>
                  </>
                )}
                {running && runningId ? (
                  <button
                    className="btn-danger text-xs"
                    onClick={async () => {
                      try {
                        await executionsApi.cancel(runningId)
                        setRunning(false)
                        setRunningId(null)
                        toast.success('Run stopped')
                      } catch (e) {
                        toast.error(extractApiError(e))
                      }
                    }}
                  >
                    <Square size={14} /> Stop
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs" onClick={addNode}><Plus size={14} /> Agent</button>
          <button className="btn-secondary text-xs" onClick={addApprovalNode}><Hand size={14} /> Approval</button>
          <button className="btn-secondary text-xs" onClick={addConditionNode}><GitBranch size={14} /> Condition</button>
          <button className="btn-secondary text-xs" onClick={addParallelGroupNode}><GitCompareArrows size={14} /> Parallel</button>
          <div className="ml-auto flex items-center gap-1 rounded-xl border border-[var(--border)] bg-white/[0.03] p-1">
            <button
              onClick={() => setMode('sequential')}
              className={clsx('rounded-lg px-2.5 py-1 text-xs transition-colors', mode === 'sequential' ? 'bg-indigo-500/15 text-indigo-300' : 'text-[var(--t3)] hover:text-[var(--t1)]')}
            >
              <span className="inline-flex items-center gap-1"><GitMerge size={12} /> Sequential</span>
            </button>
            <button
              onClick={() => setMode('orchestrator')}
              className={clsx('rounded-lg px-2.5 py-1 text-xs transition-colors', mode === 'orchestrator' ? 'bg-indigo-500/15 text-indigo-300' : 'text-[var(--t3)] hover:text-[var(--t1)]')}
            >
              <span className="inline-flex items-center gap-1"><Cpu size={12} /> Orchestrator</span>
            </button>
          </div>
        </div>
      </div>

      {mode === 'orchestrator' && (
        <div className="border-b border-[var(--border)] bg-white/[0.02] px-4 py-3">
          <div className="card p-3">
            <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--t3)]">
              <Cpu size={12} /> Orchestration Prompt
            </div>
            <textarea
              className="input min-h-[84px] w-full resize-none py-3"
              placeholder="Describe how the orchestrator should coordinate agents."
              value={orchPrompt}
              onChange={e => setOrchPrompt(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="wf-canvas relative flex-1" data-testid="workflow-builder">
          <DotGrid dotColor="rgba(255,255,255,0.07)" gap={20} />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: 'rgba(99,102,241,0.82)', strokeWidth: 1.8, filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.35))' },
              markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(99,102,241,0.82)' },
            }}
          >
            <Controls />
            <MiniMap nodeColor="rgba(255,255,255,0.6)" maskColor="rgba(5,9,20,0.82)" />
          </ReactFlow>

          {nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-2xl border border-dashed border-white/[0.10] bg-black/15 px-6 py-8 text-center backdrop-blur-sm">
                <GitBranch size={32} className="mx-auto mb-3 text-[var(--t3)]" />
                <div className="text-sm text-[var(--t2)]">Add nodes to build your process</div>
                <div className="mt-1 text-xs text-[var(--t3)]">Compose agents, approvals, conditions, and parallel phases.</div>
              </div>
            </div>
          ) : null}
        </div>

        {workflow.id ? (
          <aside className="card min-h-0 w-[380px] overflow-y-auto border-l border-white/[0.07] p-4">
            <div className="space-y-4">
              <div className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Require my review</div>
                    <div className="mt-1 text-xs text-[var(--t2)]">Every output waits for your approval before completing.</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={requiresReview}
                    onClick={() => setRequiresReview(value => !value)}
                    className={clsx(
                      'relative inline-flex h-7 w-12 items-center rounded-full border transition-colors duration-200',
                      requiresReview ? 'border-indigo-500/30 bg-indigo-500/15' : 'border-white/[0.10] bg-white/[0.04]',
                    )}
                  >
                    <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200', requiresReview ? 'translate-x-6' : 'translate-x-1')} />
                  </button>
                </div>
              </div>

              <div className="card p-4">
                <div className="section-title">Schedule</div>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_PRESETS.map(preset => (
                    <button
                      key={preset.cron}
                      type="button"
                      onClick={() => {
                        setScheduleEnabled(true)
                        setScheduleValue(preset.cron)
                      }}
                      className={clsx(
                        'rounded-full border px-3 py-1.5 text-xs transition-all duration-150',
                        selectedSchedulePreset === preset.cron
                          ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
                          : 'border-white/[0.10] bg-white/[0.03] text-[var(--t2)] hover:text-[var(--t1)]',
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setScheduleEnabled(true)}
                    className={clsx(
                      'rounded-full border px-3 py-1.5 text-xs transition-all duration-150',
                      !selectedSchedulePreset && scheduleEnabled
                        ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
                        : 'border-white/[0.10] bg-white/[0.03] text-[var(--t2)] hover:text-[var(--t1)]',
                    )}
                  >
                    Custom
                  </button>
                </div>
                <div className="mt-3 grid gap-3">
                  <input className="input" placeholder="0 8 * * 1-5" value={scheduleValue} onChange={e => setScheduleValue(e.target.value)} />
                  <select className="input" value={scheduleTimezone} onChange={e => setScheduleTimezone(e.target.value)}>
                    {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata'].map(zone => (
                      <option key={zone} value={zone}>{zone}</option>
                    ))}
                  </select>
                  <div className="font-mono text-[11px] text-[var(--t3)]">Next run: {nextRunLabel}</div>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" className={scheduleEnabled ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setScheduleEnabled(current => !current)}>
                      {scheduleEnabled ? 'Scheduled' : 'Manual'}
                    </button>
                    <button className="btn-primary btn-sm" onClick={() => scheduleMut.mutate()} disabled={!scheduleValue || scheduleMut.isPending}>
                      {scheduleMut.isPending ? 'Saving…' : 'Save Schedule'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card p-4">
                <div className="section-title">Webhook</div>
                {webhookInfo ? (
                  <>
                    <div className="rounded-xl border border-white/[0.10] bg-black/20 px-3 py-2 font-mono text-[11px] text-white/70">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{webhookInfo.webhook_url}</span>
                        <button
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(webhookInfo.webhook_url)
                            toast.success('Webhook URL copied')
                          }}
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>
                    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20 p-3 font-mono text-[11px] text-white/55">
                      {webhookInfo.curl_example}
                    </pre>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/[0.10] px-3 py-4 text-xs text-[var(--t3)]">
                    Save this process to generate a signed webhook URL.
                  </div>
                )}
              </div>

              <div className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="section-title !mb-0 !border-0 !pb-0">Input Variables</div>
                    <p className="mt-1 text-xs text-[var(--t2)]">Define inputs filled in each time this runs.</p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setInputVariables(current => [...current, createWorkflowInputVariable(current.length)])}>
                    <Plus size={14} /> Add Variable
                  </button>
                </div>
                <div className="space-y-3">
                  {inputVariables.map((variable, index) => (
                    <div key={`${variable.name}-${index}`} className="rounded-xl border border-white/[0.08] bg-black/15 p-3">
                      <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                        <input
                          className="input text-xs"
                          placeholder="name"
                          value={variable.name}
                          onChange={event => setInputVariables(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value.replace(/\s+/g, '_') } : item))}
                        />
                        <input
                          className="input text-xs"
                          placeholder="Label"
                          value={variable.label}
                          onChange={event => setInputVariables(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
                        />
                        <select
                          className="input text-xs"
                          value={variable.type}
                          onChange={event => setInputVariables(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as WorkflowInputVariable['type'] } : item))}
                        >
                          <option value="text">Text</option>
                          <option value="textarea">Textarea</option>
                          <option value="select">Select</option>
                        </select>
                        <button type="button" className="btn-ghost h-10 px-3 text-red-300" onClick={() => setInputVariables(current => current.filter((_, itemIndex) => itemIndex !== index))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr]">
                        <input
                          className="input text-xs"
                          placeholder={variable.type === 'select' ? 'Default option' : 'Default value'}
                          value={variable.default || ''}
                          onChange={event => setInputVariables(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, default: event.target.value } : item))}
                        />
                        {variable.type === 'select' ? (
                          <input
                            className="input text-xs"
                            placeholder="Options: formal, casual, friendly"
                            value={(variable.options || []).join(', ')}
                            onChange={event => setInputVariables(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, options: event.target.value.split(',').map(option => option.trim()).filter(Boolean) } : item))}
                          />
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/[0.10] px-3 py-2 text-xs text-[var(--t3)]">
                            {variable.type === 'textarea' ? 'Textarea inputs are best for longer briefs or notes.' : 'Text inputs support short free-form values.'}
                          </div>
                        )}
                      </div>
                      <label className="mt-3 flex items-center gap-2 text-xs text-[var(--t2)]">
                        <input
                          type="checkbox"
                          checked={Boolean(variable.required)}
                          onChange={event => setInputVariables(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))}
                        />
                        Required for every run
                      </label>
                    </div>
                  ))}
                  {!inputVariables.length ? (
                    <div className="rounded-xl border border-dashed border-white/[0.10] px-4 py-5 text-sm text-[var(--t3)]">
                      No inputs yet. Add variables to turn this process into a reusable run template.
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <button className="btn-primary btn-sm" onClick={save}>Save Variables</button>
                  </div>
                </div>
              </div>

              {selectedNode && selectedNode.type === 'agentNode' ? (
                <div className="card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="section-title !mb-0 !border-0 !pb-0">Assign Agent</div>
                    <button onClick={() => setSelectedNode(null)} className="btn-ghost p-1"><X size={14} /></button>
                  </div>
                  <p className="mb-3 text-xs text-[var(--t3)]">Select an agent for <span className="text-white">{selectedNode.data.label}</span></p>
                  <div className="space-y-2">
                    {agents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => assignAgent(selectedNode.id, agent)}
                        className={clsx(
                          'w-full rounded-xl border p-3 text-left text-sm transition-colors',
                          selectedNode.data.agent_id === agent.id
                            ? 'border-indigo-500/30 bg-indigo-500/10 text-white'
                            : 'border-white/[0.08] bg-white/[0.03] text-white/70 hover:border-white/[0.14]',
                        )}
                      >
                        <div className="font-medium">{agent.name}</div>
                        <div className="mt-0.5 text-xs text-[var(--t3)]">{agent.role} · {agent.model.split('-')[1] || agent.model}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
      {workflow.id && (
        <VersionHistory
          workflow={workflow}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestored={(restored) => {
            setName(restored.name)
            setDesc(restored.description)
            const restoredOptions = (restored.nodes || []).map(n => ({
              id: n.id,
              label: String(n.data?.label || n.data?.title || n.id),
            }))
            setNodes((restored.nodes || []).map((n, index) => ({
              ...n,
              type: normalizeNodeType(n.type),
              position: normalizeNodePosition(n.position, index),
              data: {
                ...n.data,
                agentName: agents.find(a => a.id === n.data.agent_id)?.name,
                agents,
                availableNodes: restoredOptions,
                onRemove: (id: string): void => setNodes(ns => ns.filter(node => node.id !== id)),
                onUpdate: (id: string, patch: Record<string, unknown>): void => setNodes(ns => ns.map(node => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)),
              },
            })) as Node<any>[])
            setEdges((restored.edges || []) as Edge<any>[])
            setMode(restored.execution_mode)
            setOrchPrompt(restored.orchestration_prompt || '')
            setRequiresReview(Boolean(restored.requires_review))
            setInputVariables(normalizeWorkflowInputVariables(restored.input_variables))
            setRunVariableValues(buildVariableRunDefaults(normalizeWorkflowInputVariables(restored.input_variables)))
            setRunPanelOpen(false)
            setRunValidationError(null)
          }}
        />
      )}
    </div>
  )
}

export function Workflows() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Workflow> | null>(null)
  const [workflowToDelete, setWorkflowToDelete] = useState<Workflow | null>(null)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const { data: workflows = [], isLoading } = useQuery({ queryKey: ['workflows'], queryFn: workflowsApi.list })
  const { data: scheduledWorkflows = [] } = useQuery({ queryKey: ['workflows-scheduled'], queryFn: workflowsApi.listScheduled })
  const { data: automationTemplates = [] } = useQuery({ queryKey: ['workflow-automation-templates'], queryFn: workflowsApi.automationTemplates })
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })

  const createMut = useMutation({
    mutationFn: workflowsApi.create,
    onSuccess: async (wf) => {
      await qc.invalidateQueries({ queryKey: ['workflows'] })
      setSelectedWorkflowId(wf.id)
      setEditing(wf)
      toast.success('Workflow created!')
    },
    onError: () => toast.error('Failed to create process'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: Partial<Workflow>) => workflowsApi.update(id!, data),
    onSuccess: async (wf) => {
      await qc.invalidateQueries({ queryKey: ['workflows'] })
      setSelectedWorkflowId(wf.id)
      setEditing(wf)
      toast.success('Saved!')
    },
    onError: () => toast.error('Failed to save process'),
  })
  const deleteMut = useMutation({
    mutationFn: workflowsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflows'] }); setWorkflowToDelete(null); toast.success('Process deleted') },
  })
  const enableAutomationMut = useMutation({
    mutationFn: workflowsApi.enableAutomationTemplate,
    onSuccess: async (payload: { workflow: Workflow }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workflows'] }),
        qc.invalidateQueries({ queryKey: ['workflows-scheduled'] }),
        qc.invalidateQueries({ queryKey: ['workflow-automation-templates'] }),
      ])
      toast.success(`${payload.workflow.name} enabled`)
    },
    onError: error => toast.error(extractApiError(error)),
  })
  const disableAutomationMut = useMutation({
    mutationFn: (args: { workflowId: string; schedule: string; timezone: string }) =>
      workflowsApi.setSchedule(args.workflowId, args.schedule, false, args.timezone),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workflows'] }),
        qc.invalidateQueries({ queryKey: ['workflows-scheduled'] }),
        qc.invalidateQueries({ queryKey: ['workflow-automation-templates'] }),
      ])
      toast.success('Automation disabled')
    },
    onError: error => toast.error(extractApiError(error)),
  })
  const updateStatusMut = useMutation({
    mutationFn: ({ workflow, status }: { workflow: Workflow; status: 'active' | 'paused' }) =>
      workflowsApi.update(workflow.id, { status, trigger: status === 'active' ? workflow.trigger || 'manual' : 'manual' }),
    onSuccess: async (wf) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workflows'] }),
        qc.invalidateQueries({ queryKey: ['workflows-scheduled'] }),
      ])
      setSelectedWorkflowId(wf.id)
      toast.success(`Workflow ${wf.status === 'active' ? 'activated' : 'paused'}`)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const handleSave = (data: Partial<Workflow>) => {
    if (editing?.id) updateMut.mutate({ ...data, id: editing.id })
    else createMut.mutate(data)
  }

  useEffect(() => {
    if (!selectedWorkflowId && workflows.length) {
      setSelectedWorkflowId(workflows[0].id)
    }
  }, [selectedWorkflowId, workflows])

  if (editing !== null) {
    return <WorkflowBuilder workflow={editing} agents={agents} onSave={handleSave} onClose={() => setEditing(null)} />
  }

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    toast.success('Workflow ID copied!')
  }

  const filteredWorkflows = workflows
    .filter(workflow => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [workflow.name, workflow.description || '', workflow.trigger || ''].join(' ').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const statusDelta = workflowSortOrder(a.status) - workflowSortOrder(b.status)
      if (statusDelta !== 0) return statusDelta
      return a.name.localeCompare(b.name)
    })
  const liveWorkflows = filteredWorkflows.filter(workflow => workflow.status !== 'draft')
  const draftWorkflows = filteredWorkflows.filter(workflow => workflow.status === 'draft')
  const selectedWorkflow = filteredWorkflows.find(workflow => workflow.id === selectedWorkflowId) || workflows.find(workflow => workflow.id === selectedWorkflowId) || filteredWorkflows[0] || workflows[0]
  const selectedScheduled = scheduledWorkflows.find(item => item.workflow_id === selectedWorkflow?.id)
  const selectedScheduleActive = Boolean(selectedScheduled?.schedule_enabled)

  return (
    <PageShell
      title="Processes"
      subtitle="Design the operating loops your AI company runs every day."
      actions={<button className="btn-primary" onClick={() => setEditing(createWorkflowDraft())}><Plus size={16} /> New Process</button>}
      contentClassName="space-y-6 p-6"
    >
      <section className="space-y-4">
        <div>
          <p className="section-title mb-3 border-0 pb-0">AUTOMATIONS</p>
          <p className="text-sm text-[var(--t2)]">Enable the agency routines founders expect to run without touching a button.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {automationTemplates.map((template: AutomationTemplate) => {
            const Icon = automationIcon(template.id)
            const scheduled = scheduledWorkflows.find((item: ScheduledWorkflow) => item.workflow_id === template.workflow_id)
            return (
              <div key={template.id} className="surface-card flex flex-col gap-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-[var(--bg-s)] p-3 text-[var(--t1)]">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--t1)]">{template.name}</h3>
                      <span className={template.enabled ? 'badge badge-green' : 'badge badge-muted'}>
                        {template.enabled ? 'Enabled' : 'Ready'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--t2)]">{template.description}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-s)] px-3 py-2 text-xs text-[var(--t3)]">
                  {template.enabled && scheduled?.schedule_enabled && scheduled?.next_run_at
                    ? `Next run: ${formatRunTime(scheduled.next_run_at)}`
                    : `Cron: ${template.cron}`}
                </div>
                <div className="mt-auto flex gap-2">
                  {template.enabled && template.workflow_id && scheduled ? (
                    <>
                      <button
                        className="btn-secondary flex-1 text-xs"
                        onClick={() => setSelectedWorkflowId(template.workflow_id!)}
                      >
                        Manage
                      </button>
                      <button
                        className="btn-ghost flex-1 text-xs"
                        onClick={() => disableAutomationMut.mutate({
                          workflowId: template.workflow_id!,
                          schedule: scheduled.schedule,
                          timezone: scheduled.schedule_timezone,
                        })}
                      >
                        Disable
                      </button>
                    </>
                  ) : (
                    <button className="btn-primary w-full text-xs" onClick={() => enableAutomationMut.mutate(template.id)}>
                      Enable →
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {isLoading ? (
        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
          <SkeletonCard className="h-[420px]" />
          <SkeletonCard className="h-[420px]" />
        </div>
      ) : !workflows.length ? (
        <div className="surface-card">
          <EmptyState
            icon="⚡"
            title="Recurring work, automated"
            description="Set up a process once. It runs on schedule, pauses for your approval on anything important, logs everything."
            action={{ label: 'Create first process', onClick: () => setEditing(createWorkflowDraft()) }}
            secondaryAction={{ label: 'Browse templates', onClick: () => navigate('/marketplace') }}
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="surface overflow-hidden self-start">
            <div className="border-b border-[var(--border)] p-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t3)]" />
                <input
                  className="input pl-9"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search processes"
                />
              </div>
            </div>
            <div className="px-3 pb-1 pt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--t3)]">
              Live
            </div>
            {liveWorkflows.length ? liveWorkflows.map(wf => {
              const scheduled = scheduledWorkflows.find(item => item.workflow_id === wf.id)
              const scheduleActive = Boolean(scheduled?.schedule_enabled)
              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setSelectedWorkflowId(wf.id)}
                  className={clsx(
                    'row grid w-full grid-cols-[minmax(0,1fr)_max-content_max-content] items-center gap-3 text-left',
                    selectedWorkflow?.id === wf.id && 'bg-indigo-500/[0.08] border-l-2 border-indigo-400',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--t1)]">{wf.name}</div>
                    <div className="mono mt-1 text-[10px] text-[var(--t3)]">{scheduleActive && scheduled?.next_run_at ? formatRunTime(scheduled.next_run_at) : wf.trigger}</div>
                  </div>
                  <span className={clsx('status-dot', scheduleActive ? 'dot-green dot-live' : wf.status === 'active' ? 'dot-blue' : 'dot-muted')} />
                  <span className={workflowStatusBadge(wf.status)}>{wf.status}</span>
                </button>
              )
            }) : (
              <div className="row cursor-default text-xs text-[var(--t3)]">No live processes yet.</div>
            )}
            {draftWorkflows.length ? (
              <>
                <div className="px-3 pb-1 pt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--t3)]">
                  Drafts
                </div>
                {draftWorkflows.map(wf => {
                  const scheduled = scheduledWorkflows.find(item => item.workflow_id === wf.id)
                  const scheduleActive = Boolean(scheduled?.schedule_enabled)
                  return (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => setSelectedWorkflowId(wf.id)}
                      className={clsx(
                        'row grid w-full grid-cols-[minmax(0,1fr)_max-content_max-content] items-center gap-3 text-left',
                        selectedWorkflow?.id === wf.id && 'bg-indigo-500/[0.08] border-l-2 border-indigo-400',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--t1)]">{wf.name}</div>
                        <div className="mono mt-1 text-[10px] text-[var(--t3)]">{scheduleActive && scheduled?.next_run_at ? formatRunTime(scheduled.next_run_at) : 'Needs activation'}</div>
                      </div>
                      <span className={clsx('status-dot', scheduleActive ? 'dot-green dot-live' : 'dot-muted')} />
                      <span className={workflowStatusBadge(wf.status)}>{wf.status}</span>
                    </button>
                  )
                })}
              </>
            ) : null}
          </div>

          <div className="space-y-4">
            {selectedWorkflow ? (
              <div className="surface-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={clsx('badge', selectedWorkflow.status === 'active' ? 'badge-green' : selectedWorkflow.status === 'paused' ? 'badge-amber' : 'badge-muted')}>
                        {selectedWorkflow.status}
                      </span>
                      <span className="mono text-xs text-[var(--t3)]">{selectedWorkflow.execution_mode}</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[var(--t1)]">{selectedWorkflow.name}</h2>
                    <p className="mt-2 max-w-3xl text-sm text-[var(--t2)]">{selectedWorkflow.description || 'No description yet.'}</p>
                    {selectedWorkflow.status === 'draft' ? (
                      <p className="mt-3 text-xs text-[var(--t3)]">
                        Drafts do not run yet. Activate this process once the steps look right.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={(selectedWorkflow.status === 'draft' && !canActivateWorkflow(selectedWorkflow)) || updateStatusMut.isPending}
                      onClick={() => updateStatusMut.mutate({
                        workflow: selectedWorkflow,
                        status: nextStatus(selectedWorkflow.status) as 'active' | 'paused',
                      })}
                    >
                      {statusActionLabel(selectedWorkflow.status)}
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => copyId(selectedWorkflow.id)}>
                      <Copy size={13} /> ID
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(selectedWorkflow)}>
                      <GitBranch size={13} /> Builder
                    </button>
                    <Link
                      to={`/chat/${selectedWorkflow.id}`}
                      className="btn-secondary btn-sm flex items-center gap-1.5"
                      title="Chat with this process"
                    >
                      <MessageSquare size={13} /> Chat
                    </Link>
                    <button className="btn-danger btn-sm" onClick={() => setWorkflowToDelete(selectedWorkflow)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="surface p-3">
                    <div className="section-title mb-2 border-0 pb-0">NODES</div>
                    <div className="mono text-lg text-[var(--t1)]">{(selectedWorkflow.nodes || []).length}</div>
                  </div>
                  <div className="surface p-3">
                    <div className="section-title mb-2 border-0 pb-0">EDGES</div>
                    <div className="mono text-lg text-[var(--t1)]">{(selectedWorkflow.edges || []).length}</div>
                  </div>
                  <div className="surface p-3">
                    <div className="section-title mb-2 border-0 pb-0">NEXT RUN</div>
                    <div className="mono text-sm text-[var(--t1)]">{selectedScheduleActive && selectedScheduled?.next_run_at ? formatRunTime(selectedScheduled.next_run_at) : 'Manual only'}</div>
                  </div>
                  <div className="surface p-3">
                    <div className="section-title mb-2 border-0 pb-0">REVIEW</div>
                    <div className="mono text-sm text-[var(--t1)]">{selectedWorkflow.requires_review ? 'Required' : 'Auto-complete'}</div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="section-title mb-0 border-0 pb-0">DRAFT PROCESSES</div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {draftWorkflows.length ? draftWorkflows.map(wf => (
                <div key={wf.id} className="surface-card flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[var(--t1)]">{wf.name}</div>
                      {wf.description ? <div className="mt-1 line-clamp-2 text-xs text-[var(--t3)]">{wf.description}</div> : null}
                    </div>
                    <span className={clsx('badge', wf.status === 'active' ? 'badge-green' : wf.status === 'paused' ? 'badge-amber' : 'badge-muted')}>{wf.status}</span>
                  </div>
                  <div className="mono flex items-center gap-2 text-[11px] text-[var(--t3)]">
                    <span>{(wf.nodes || []).length} nodes</span>
                    <span>·</span>
                    <span>{wf.execution_mode}</span>
                    <span>·</span>
                    <span>{wf.trigger}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn-primary btn-sm"
                      disabled={!canActivateWorkflow(wf) || updateStatusMut.isPending}
                      onClick={() => updateStatusMut.mutate({ workflow: wf, status: 'active' })}
                    >
                      Activate
                    </button>
                    <button className="btn-secondary btn-sm flex-1" onClick={() => setEditing(wf)}>
                      <GitBranch size={13} /> Builder
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setSelectedWorkflowId(wf.id)}>
                      Details
                    </button>
                  </div>
                </div>
              )) : (
                <div className="surface-card p-5 text-sm text-[var(--t3)]">
                  No drafts hanging around. New processes you create from scratch will show up here until you activate them.
                </div>
              )}
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(workflowToDelete)}
        title={`Delete ${workflowToDelete?.name || 'process'}?`}
        description="This removes the process definition. Past runs remain available, but scheduled or webhook triggers for this process will stop working."
        confirmLabel="Delete process"
        loading={deleteMut.isPending}
        onClose={() => setWorkflowToDelete(null)}
        onConfirm={() => workflowToDelete && deleteMut.mutate(workflowToDelete.id)}
      />
    </PageShell>
  )
}

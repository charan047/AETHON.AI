import { useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, MarkerType,
  type Connection, type Edge, type Node,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { workflowsApi, agentsApi, executionsApi } from '../api/client'
import { AgentNode } from '../components/Workflow/AgentNode'
import { ApprovalNode } from '../components/Workflow/nodes/ApprovalNode'
import { ConditionNode } from '../components/Workflow/nodes/ConditionNode'
import { ParallelGroupNode } from '../components/Workflow/nodes/ParallelGroupNode'
import { VersionHistory } from '../components/workflows/VersionHistory'
import { Plus, Save, Play, Trash2, GitBranch, ChevronLeft, X, Layers, MessageSquare, Copy, Cpu, GitMerge, Hand, GitCompareArrows } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import type { Workflow, Agent } from '../types'
import { SkeletonCard } from '../components/ui/Skeleton'

const nodeTypes = {
  agentNode: AgentNode,
  approval: ApprovalNode,
  condition: ConditionNode,
  parallel_group: ParallelGroupNode,
}

function WorkflowBuilder({ workflow, agents, onSave, onClose }: {
  workflow: Partial<Workflow>
  agents: Agent[]
  onSave: (wf: Partial<Workflow>) => void
  onClose: () => void
}) {
  const availableNodeOptions = (workflow.nodes || []).map(n => ({
    id: n.id,
    label: String(n.data?.label || n.data?.title || n.id),
  }))
  const initNodes: Node<any>[] = (workflow.nodes || []).map(n => ({
    ...n,
    type: n.type || 'agentNode',
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
  const [runInput, setRunInput] = useState('')
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<'sequential' | 'orchestrator'>(workflow.execution_mode || 'sequential')
  const [orchPrompt, setOrchPrompt] = useState(workflow.orchestration_prompt || '')
  const [historyOpen, setHistoryOpen] = useState(false)
  const idRef = useRef(Date.now())

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
    if (!name) { toast.error('Please enter a workflow name'); return }
    const cleanNodes = nodes.map(({ id, type, position, data }) => ({
      id, type: type || 'agentNode', position,
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
    onSave({ name, description: desc, nodes: cleanNodes, edges: cleanEdges, execution_mode: mode, orchestration_prompt: orchPrompt })
  }

  const run = async () => {
    if (!workflow.id) { toast.error('Save the workflow first'); return }
    if (!runInput) { toast.error('Enter an input message'); return }
    setRunning(true)
    try {
      await executionsApi.run(workflow.id, runInput)
      toast.success('Workflow started! Check Monitoring for live updates.')
      setRunInput('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to run workflow')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-obsidian-950">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-obsidian-925 px-4">
        <button className="btn-ghost" onClick={onClose}><ChevronLeft size={18} /></button>
        <div className="flex items-center gap-2 flex-1">
          <input className="w-48 border-none bg-transparent text-base font-semibold text-white outline-none"
            placeholder="Workflow Name" value={name} onChange={e => setName(e.target.value)} />
          <input className="flex-1 border-none bg-transparent text-sm text-obsidian-500 outline-none"
            placeholder="Description..." value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <button className="btn-secondary text-xs" onClick={addNode}><Plus size={14} /> Agent</button>
        <button className="btn-secondary text-xs text-amber-300" onClick={addApprovalNode}><Hand size={14} /> Approval</button>
        <button className="btn-secondary text-xs text-indigo-300" onClick={addConditionNode}><GitBranch size={14} /> Condition</button>
        <button className="btn-secondary text-xs text-fuchsia-300" onClick={addParallelGroupNode}><GitCompareArrows size={14} /> Parallel</button>

        {/* Execution mode toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-obsidian-900 p-0.5">
          <button
            onClick={() => setMode('sequential')}
            className={clsx('flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors', mode === 'sequential' ? 'bg-accent-500 text-white shadow-glow-sm' : 'text-obsidian-400 hover:text-white')}
          >
            <GitMerge size={12} /> Sequential
          </button>
          <button
            onClick={() => setMode('orchestrator')}
            className={clsx('flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors', mode === 'orchestrator' ? 'bg-cyan-500 text-white shadow-glow-cyan' : 'text-obsidian-400 hover:text-white')}
          >
            <Cpu size={12} /> Orchestrator
          </button>
        </div>

        {workflow.id && (
          <button className="btn-secondary text-xs" onClick={() => setHistoryOpen(true)}>
            <GitCompareArrows size={14} /> History
          </button>
        )}
        <button className="btn-secondary text-xs" onClick={save}><Save size={14} /> Save</button>

        {workflow.id && (
          <div className="flex items-center gap-2 border-l border-white/[0.08] pl-3">
            <input className="input w-48 text-xs py-1.5" placeholder="Enter task input..." value={runInput} onChange={e => setRunInput(e.target.value)} />
            <button className="btn-primary text-xs" onClick={run} disabled={running}>
              <Play size={14} /> {running ? 'Running...' : 'Run'}
            </button>
          </div>
        )}
      </div>

      {/* Orchestration prompt bar — shown only in orchestrator mode */}
      {mode === 'orchestrator' && (
        <div className="flex shrink-0 items-start gap-3 border-b border-cyan-400/15 bg-cyan-400/5 px-4 py-2.5">
          <div className="flex items-center gap-1.5 whitespace-nowrap pt-1.5 text-xs font-medium text-cyan-300">
            <Cpu size={12} /> Orchestration Prompt
          </div>
          <textarea
            className="flex-1 resize-none rounded-lg border border-cyan-400/15 bg-obsidian-950/60 px-3 py-1.5 text-xs text-obsidian-100 placeholder-obsidian-600 outline-none focus:border-cyan-400/60"
            rows={2}
            placeholder="Describe how the orchestrator should coordinate agents — e.g. 'First use the Researcher to gather facts, then pass results to the Writer to produce a report. Always synthesize a final answer.'"
            value={orchPrompt}
            onChange={e => setOrchPrompt(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="obsidian-grid relative flex-1">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            defaultEdgeOptions={{ animated: true, style: { stroke: '#6366f1', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' } }}
          >
            <Background color="rgba(99,102,241,0.22)" gap={22} />
            <Controls />
            <MiniMap nodeColor="#6366f1" maskColor="rgba(10,10,15,0.72)" />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <GitBranch size={40} className="mx-auto mb-3 text-obsidian-600" />
                <div className="text-sm text-obsidian-400">Add nodes to build your workflow</div>
                <div className="mt-1 text-xs text-obsidian-600">Compose agents, approvals, conditions, and parallel phases</div>
              </div>
            </div>
          )}
        </div>

        {/* Agent Assignment Panel */}
        {selectedNode && selectedNode.type === 'agentNode' && (
          <div className="w-72 overflow-y-auto border-l border-white/[0.08] bg-obsidian-925 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Assign Agent</h3>
              <button onClick={() => setSelectedNode(null)} className="btn-ghost p-1"><X size={14} /></button>
            </div>
            <p className="mb-3 text-xs text-obsidian-500">Select an agent for <strong className="text-obsidian-300">{selectedNode.data.label}</strong></p>
            <div className="space-y-2">
              {agents.map(agent => (
                <button key={agent.id}
                  onClick={() => assignAgent(selectedNode.id, agent)}
                  className={clsx('w-full text-left p-3 rounded-lg border text-sm transition-colors',
                    selectedNode.data.agent_id === agent.id
                      ? 'border-accent-400/60 bg-accent-400/10 text-accent-200 shadow-glow-sm'
                      : 'border-white/[0.08] bg-white/[0.03] text-obsidian-300 hover:border-white/[0.14]'
                  )}>
                  <div className="font-medium">{agent.name}</div>
                  <div className="mt-0.5 text-xs text-obsidian-500">{agent.role} · {agent.model.split('-')[1] || agent.model}</div>
                </button>
              ))}
              {!agents.length && <div className="py-4 text-center text-xs text-obsidian-600">No agents yet. Create agents first.</div>}
            </div>
          </div>
        )}
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
            setNodes((restored.nodes || []).map(n => ({
              ...n,
              type: n.type || 'agentNode',
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
          }}
        />
      )}
    </div>
  )
}

export function Workflows() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Workflow> | null>(null)

  const { data: workflows = [], isLoading } = useQuery({ queryKey: ['workflows'], queryFn: workflowsApi.list })
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })

  const createMut = useMutation({
    mutationFn: workflowsApi.create,
    onSuccess: (wf) => { qc.invalidateQueries({ queryKey: ['workflows'] }); setEditing(wf); toast.success('Workflow created!') },
    onError: () => toast.error('Failed to create workflow'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: Partial<Workflow>) => workflowsApi.update(id!, data),
    onSuccess: (wf) => { qc.invalidateQueries({ queryKey: ['workflows'] }); setEditing(wf); toast.success('Saved!') },
    onError: () => toast.error('Failed to save workflow'),
  })
  const deleteMut = useMutation({
    mutationFn: workflowsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflows'] }); toast.success('Workflow deleted') },
  })

  const handleSave = (data: Partial<Workflow>) => {
    if (editing?.id) updateMut.mutate({ ...data, id: editing.id })
    else createMut.mutate(data)
  }

  if (editing !== null) {
    return <WorkflowBuilder workflow={editing} agents={agents} onSave={handleSave} onClose={() => setEditing(null)} />
  }

  const statusColor: Record<string, string> = {
    draft: 'badge-gray', active: 'badge-green', paused: 'badge-yellow',
  }

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    toast.success('Workflow ID copied!')
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Workflows</h1>
          <p className="mt-2 text-sm text-obsidian-400">Design the operating loops your AI company runs every day.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} /> New Workflow
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} className="h-44" />)}
        </div>
      ) : !workflows.length ? (
        <div className="rounded-2xl border border-white/[0.08] bg-obsidian-900 py-24 text-center">
          <GitBranch size={48} className="mx-auto mb-4 text-accent-300" />
          <div className="font-medium text-white">No workflows yet - build your first automated process</div>
          <div className="mb-5 mt-2 text-sm text-obsidian-500">Create a workflow or start from a template.</div>
          <div className="flex gap-3 justify-center">
            <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New Workflow</button>
            <a href="/templates" className="btn-secondary"><Layers size={16} /> Browse Templates</a>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map(wf => (
            <div key={wf.id} className="card card-hover flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white">{wf.name}</div>
                  {wf.description && <div className="mt-0.5 line-clamp-1 text-xs text-obsidian-500">{wf.description}</div>}
                </div>
                <span className={clsx(statusColor[wf.status] || 'badge-gray', 'ml-2 flex-shrink-0')}>{wf.status}</span>
              </div>

              <div className="flex items-center gap-3 text-xs text-obsidian-500">
                <span>{(wf.nodes || []).length} nodes</span>
                <span>·</span>
                <span>{(wf.edges || []).length} edges</span>
                <span>·</span>
                <span>{wf.trigger}</span>
                <span>·</span>
                {wf.execution_mode === 'orchestrator'
                  ? <span className="flex items-center gap-1 text-emerald-500"><Cpu size={10} /> orchestrator</span>
                  : <span className="flex items-center gap-1 text-violet-400"><GitMerge size={10} /> sequential</span>
                }
              </div>

              {/* Workflow ID row */}
              <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-obsidian-600">ID</span>
                <span className="flex-1 truncate font-mono text-[11px] text-obsidian-500">{wf.id}</span>
                <button
                  onClick={() => copyId(wf.id)}
                  className="text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"
                  title="Copy workflow ID"
                >
                  <Copy size={11} />
                </button>
              </div>

              <div className="flex gap-2 mt-auto">
                <button className="btn-secondary flex-1 text-xs" onClick={() => setEditing(wf)}>
                  <GitBranch size={13} /> Builder
                </button>
                <Link
                  to={`/chat/${wf.id}`}
                  className="btn-secondary text-xs px-3 flex items-center gap-1.5"
                  title="Chat with this workflow"
                >
                  <MessageSquare size={13} /> Chat
                </Link>
                <button className="btn-danger text-xs px-3" onClick={() => {
                  if (confirm(`Delete "${wf.name}"?`)) deleteMut.mutate(wf.id)
                }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

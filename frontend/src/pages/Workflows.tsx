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
import { Plus, Save, Play, Trash2, GitBranch, ChevronLeft, X, Layers, MessageSquare, Copy, Check, Cpu, GitMerge } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import type { Workflow, Agent } from '../types'

const nodeTypes = { agentNode: AgentNode }

function WorkflowBuilder({ workflow, agents, onSave, onClose }: {
  workflow: Partial<Workflow>
  agents: Agent[]
  onSave: (wf: Partial<Workflow>) => void
  onClose: () => void
}) {
  const initNodes = (workflow.nodes || []).map(n => ({
    ...n,
    type: 'agentNode',
    data: {
      ...n.data,
      agentName: agents.find(a => a.id === n.data.agent_id)?.name,
      onRemove: (id: string) => setNodes(ns => ns.filter(n => n.id !== id)),
    },
  }))

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>(workflow.edges || [])
  const [name, setName] = useState(workflow.name || '')
  const [desc, setDesc] = useState(workflow.description || '')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [runInput, setRunInput] = useState('')
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<'sequential' | 'orchestrator'>(workflow.execution_mode || 'sequential')
  const [orchPrompt, setOrchPrompt] = useState(workflow.orchestration_prompt || '')
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
      data: { label: data.label, agent_id: data.agent_id, role: data.role },
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
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Toolbar */}
      <div className="h-14 bg-slate-900 border-b border-slate-800 flex items-center gap-3 px-4 flex-shrink-0">
        <button className="btn-ghost" onClick={onClose}><ChevronLeft size={18} /></button>
        <div className="flex items-center gap-2 flex-1">
          <input className="bg-transparent border-none text-slate-100 font-semibold text-base outline-none w-48"
            placeholder="Workflow Name" value={name} onChange={e => setName(e.target.value)} />
          <input className="bg-transparent border-none text-slate-500 text-sm outline-none flex-1"
            placeholder="Description..." value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <button className="btn-secondary text-xs" onClick={addNode}><Plus size={14} /> Add Node</button>

        {/* Execution mode toggle */}
        <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-0.5">
          <button
            onClick={() => setMode('sequential')}
            className={clsx('flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors', mode === 'sequential' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200')}
          >
            <GitMerge size={12} /> Sequential
          </button>
          <button
            onClick={() => setMode('orchestrator')}
            className={clsx('flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors', mode === 'orchestrator' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200')}
          >
            <Cpu size={12} /> Orchestrator
          </button>
        </div>

        <button className="btn-secondary text-xs" onClick={save}><Save size={14} /> Save</button>

        {workflow.id && (
          <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
            <input className="input w-48 text-xs py-1.5" placeholder="Enter task input..." value={runInput} onChange={e => setRunInput(e.target.value)} />
            <button className="btn-primary text-xs" onClick={run} disabled={running}>
              <Play size={14} /> {running ? 'Running...' : 'Run'}
            </button>
          </div>
        )}
      </div>

      {/* Orchestration prompt bar — shown only in orchestrator mode */}
      {mode === 'orchestrator' && (
        <div className="bg-emerald-950/40 border-b border-emerald-900/50 px-4 py-2.5 flex items-start gap-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium pt-1.5 whitespace-nowrap">
            <Cpu size={12} /> Orchestration Prompt
          </div>
          <textarea
            className="flex-1 bg-slate-900/60 border border-emerald-900/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-emerald-700 resize-none"
            rows={2}
            placeholder="Describe how the orchestrator should coordinate agents — e.g. 'First use the Researcher to gather facts, then pass results to the Writer to produce a report. Always synthesize a final answer.'"
            value={orchPrompt}
            onChange={e => setOrchPrompt(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            defaultEdgeOptions={{ animated: true, style: { stroke: '#6d28d9', strokeWidth: 2 } }}
          >
            <Background color="#1e293b" gap={20} />
            <Controls className="!bg-slate-800 !border-slate-700" />
            <MiniMap className="!bg-slate-900 !border-slate-700" nodeColor="#6d28d9" />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <GitBranch size={40} className="mx-auto text-slate-700 mb-3" />
                <div className="text-slate-500 text-sm">Add nodes to build your workflow</div>
                <div className="text-slate-700 text-xs mt-1">Click "Add Node" to start</div>
              </div>
            </div>
          )}
        </div>

        {/* Agent Assignment Panel */}
        {selectedNode && (
          <div className="w-64 bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-200">Assign Agent</h3>
              <button onClick={() => setSelectedNode(null)} className="btn-ghost p-1"><X size={14} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">Select an agent for <strong className="text-slate-400">{selectedNode.data.label}</strong></p>
            <div className="space-y-2">
              {agents.map(agent => (
                <button key={agent.id}
                  onClick={() => assignAgent(selectedNode.id, agent)}
                  className={clsx('w-full text-left p-3 rounded-lg border text-sm transition-colors',
                    selectedNode.data.agent_id === agent.id
                      ? 'border-violet-500 bg-violet-900/20 text-violet-300'
                      : 'border-slate-700 bg-slate-800 hover:border-slate-600 text-slate-300'
                  )}>
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{agent.role} · {agent.model.split('-')[1] || agent.model}</div>
                </button>
              ))}
              {!agents.length && <div className="text-xs text-slate-600 text-center py-4">No agents yet. Create agents first.</div>}
            </div>
          </div>
        )}
      </div>
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Workflows</h1>
          <p className="text-slate-400 text-sm mt-1">Visual multi-agent workflow builder</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} /> New Workflow
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(2)].map((_, i) => <div key={i} className="card h-40 animate-pulse bg-slate-800/50" />)}
        </div>
      ) : !workflows.length ? (
        <div className="text-center py-20">
          <GitBranch size={48} className="mx-auto text-slate-700 mb-4" />
          <div className="text-slate-400 font-medium">No workflows yet</div>
          <div className="text-slate-600 text-sm mt-1 mb-4">Create a workflow or start from a template</div>
          <div className="flex gap-3 justify-center">
            <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New Workflow</button>
            <a href="/templates" className="btn-secondary"><Layers size={16} /> Browse Templates</a>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map(wf => (
            <div key={wf.id} className="card card-hover p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-100">{wf.name}</div>
                  {wf.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{wf.description}</div>}
                </div>
                <span className={clsx(statusColor[wf.status] || 'badge-gray', 'ml-2 flex-shrink-0')}>{wf.status}</span>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500">
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
              <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2.5 py-1.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-wide font-medium">ID</span>
                <span className="text-[11px] text-slate-500 font-mono truncate flex-1">{wf.id}</span>
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

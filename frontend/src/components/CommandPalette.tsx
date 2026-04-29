import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Bot, CheckCircle2, GitBranch, Play, Search, X, Zap } from 'lucide-react'
import { agentsApi, executionsApi, monitoringApi, workflowsApi } from '../api/client'

type Command = {
  id: string
  label: string
  hint: string
  icon: ReactNode
  run: () => void | Promise<void>
}

export function CommandPalette() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data: agents = [] } = useQuery({ queryKey: ['palette-agents'], queryFn: agentsApi.list, enabled: open })
  const { data: workflows = [] } = useQuery({ queryKey: ['palette-workflows'], queryFn: workflowsApi.list, enabled: open })
  const { data: executions = [] } = useQuery({ queryKey: ['palette-executions'], queryFn: () => monitoringApi.recentExecutions(8), enabled: open })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(value => !value)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const runWorkflow = async (workflowId: string, workflowName: string) => {
      await executionsApi.run(workflowId, 'Run this workflow from the Command Palette.')
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
      toast.success(`Started ${workflowName}`)
      setOpen(false)
    }

    return [
      {
        id: 'approvals',
        label: 'Approve pending items',
        hint: 'Jump to human approvals',
        icon: <CheckCircle2 size={16} />,
        run: () => { navigate('/approvals'); setOpen(false) },
      },
      ...workflows.flatMap(workflow => [
        {
          id: `workflow-${workflow.id}`,
          label: `Open workflow ${workflow.name}`,
          hint: 'Go to workflow builder',
          icon: <GitBranch size={16} />,
          run: () => { navigate('/workflows'); setOpen(false) },
        },
        {
          id: `run-${workflow.id}`,
          label: `Run workflow ${workflow.name}`,
          hint: 'Start immediately',
          icon: <Play size={16} />,
          run: () => runWorkflow(workflow.id, workflow.name),
        },
      ]),
      ...agents.map(agent => ({
        id: `agent-${agent.id}`,
        label: `Chat with agent ${agent.name}`,
        hint: `${agent.role} · opens team page`,
        icon: <Bot size={16} />,
        run: () => { navigate('/agents'); setOpen(false) },
      })),
      ...executions.map((execution: any) => ({
        id: `execution-${execution.id}`,
        label: `View recent run ${execution.workflow_name}`,
        hint: execution.status,
        icon: <Zap size={16} />,
        run: () => { navigate(`/chat/${execution.workflow_id}`); setOpen(false) },
      })),
    ]
  }, [agents, executions, navigate, qc, workflows])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commands.slice(0, 10)
    return commands
      .filter(command => `${command.label} ${command.hint}`.toLowerCase().includes(normalized))
      .slice(0, 12)
  }, [commands, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-xl" onClick={() => setOpen(false)}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-obsidian-900 shadow-glow-lg" onClick={event => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
          <Search size={18} className="text-cyan-300" />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='Search, "run workflow", "chat with agent", "approve"...'
            className="flex-1 border-none bg-transparent text-sm text-white outline-none placeholder:text-obsidian-500"
          />
          <button className="btn-ghost h-8 px-2" onClick={() => setOpen(false)}><X size={15} /></button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {filtered.map(command => (
            <button
              key={command.id}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.05]"
              onClick={() => command.run()}
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
                {command.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{command.label}</div>
                <div className="mt-0.5 truncate text-xs text-obsidian-500">{command.hint}</div>
              </div>
            </button>
          ))}
          {!filtered.length && <div className="p-8 text-center text-sm text-obsidian-500">No commands found.</div>}
        </div>
      </div>
    </div>
  )
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowsApi, agentsApi } from '../api/client'
import { Layers, GitBranch, Bot, Wand2, CheckCircle } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import type { Template } from '../types'

function TemplateCard({ template, onUse }: { template: Template; onUse: (t: Template) => void }) {
  return (
    <div className="card p-5 flex flex-col gap-4 card-hover">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-900/40 border border-violet-800/40 flex items-center justify-center flex-shrink-0">
          <Layers size={20} className="text-violet-400" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-100">{template.name}</h3>
          <p className="text-sm text-slate-400 mt-0.5">{template.description}</p>
        </div>
      </div>

      {/* Pipeline preview */}
      <div className="flex items-center gap-2 overflow-x-auto py-1">
        {template.nodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-2 flex-shrink-0">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                <Bot size={14} className="text-violet-400" />
              </div>
              <span className="text-xs text-slate-500 mt-1 whitespace-nowrap">{node.data.label}</span>
            </div>
            {i < template.nodes.length - 1 && (
              <div className="w-8 h-0.5 bg-gradient-to-r from-violet-800 to-violet-600 flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Suggested agents */}
      <div>
        <div className="text-xs text-slate-500 mb-2 font-medium">Suggested Agents</div>
        <div className="space-y-1.5">
          {template.suggested_agents.map((ag, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center flex-shrink-0">
                <Bot size={11} className="text-slate-400" />
              </div>
              <span className="text-slate-300 font-medium">{ag.name}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500 truncate">{ag.tools.length ? ag.tools.join(', ') : 'no tools'}</span>
            </div>
          ))}
        </div>
      </div>

      <button className="btn-primary w-full text-sm mt-auto" onClick={() => onUse(template)}>
        <Wand2 size={15} /> Use Template
      </button>
    </div>
  )
}

export function Templates() {
  const qc = useQueryClient()
  const [deploying, setDeploying] = useState<string | null>(null)
  const [deployed, setDeployed] = useState<string[]>([])

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'], queryFn: workflowsApi.getTemplates,
  })
  const { data: agents = [] } = useQuery({
    queryKey: ['agents'], queryFn: agentsApi.list,
  })

  const createAgent = useMutation({ mutationFn: agentsApi.create })
  const createWorkflow = useMutation({ mutationFn: workflowsApi.create })

  const useTemplate = async (template: Template) => {
    setDeploying(template.id)
    try {
      // Create suggested agents
      const createdAgents: Record<string, string> = {}
      for (const ag of template.suggested_agents) {
        const existing = agents.find(a => a.role === ag.role && a.name === ag.name)
        if (existing) {
          createdAgents[ag.role] = existing.id
        } else {
          const created = await createAgent.mutateAsync({
            name: ag.name, role: ag.role,
            system_prompt: ag.system_prompt,
            tools: ag.tools, model: 'claude-sonnet-4-6',
            description: `Auto-created from template: ${template.name}`,
            memory_enabled: true, temperature: 0.7, max_tokens: 2000,
            max_iterations: 10, timeout: 120, telegram_enabled: false,
          })
          createdAgents[ag.role] = created.id
        }
      }

      // Build workflow nodes with real agent IDs
      const nodes = template.nodes.map((n, i) => {
        const sg = template.suggested_agents[i]
        const agentId = sg ? createdAgents[sg.role] : undefined
        return {
          ...n,
          data: { ...n.data, agent_id: agentId },
        }
      })

      await createWorkflow.mutateAsync({
        name: template.name,
        description: template.description,
        nodes, edges: template.edges,
        template_id: template.id,
        trigger: 'manual',
      })

      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['workflows'] })
      setDeployed(d => [...d, template.id])
      toast.success(`Template "${template.name}" deployed! Agents and workflow created.`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to deploy template')
    } finally {
      setDeploying(null)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Workflow Templates</h1>
        <p className="text-slate-400 text-sm mt-1">Pre-built multi-agent workflows — ready to use in one click</p>
      </div>

      <div className="mb-6 p-4 card bg-violet-900/10 border-violet-900/40">
        <div className="flex items-start gap-3">
          <Wand2 size={18} className="text-violet-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-violet-300">One-click deployment</div>
            <div className="text-xs text-slate-400 mt-1">
              Using a template automatically creates the suggested agents and connects them into a workflow.
              You can then open the workflow builder to customize agent assignments, add nodes, or modify connections.
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-64 animate-pulse bg-slate-800/50" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => (
            <div key={template.id} className="relative">
              {deployed.includes(template.id) && (
                <div className="absolute top-3 right-3 z-10 flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-900/60 rounded-full px-2 py-0.5">
                  <CheckCircle size={11} /> Deployed
                </div>
              )}
              {deploying === template.id ? (
                <div className="card p-5 h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <div className="text-sm text-slate-400">Deploying template...</div>
                  </div>
                </div>
              ) : (
                <TemplateCard template={template} onUse={useTemplate} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

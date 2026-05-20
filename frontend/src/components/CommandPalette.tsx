import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Command } from 'cmdk'
import Fuse from 'fuse.js'
import { AnimatePresence, motion } from 'framer-motion'
import {
  agentsApi,
  approvalsApi,
  clientsApi,
  executionsApi,
  missionsApi,
  workflowsApi,
} from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { WorkflowInputVariable } from '../types'

type CommandSection = 'Navigation' | 'Quick Actions' | 'Agents' | 'Clients' | 'Workflows'

interface PaletteCommand {
  id: string
  label: string
  description?: string
  section: CommandSection
  keywords?: string[]
  shortcut?: string
  action: () => void | Promise<void>
}

const NAVIGATION_COMMANDS: Array<Omit<PaletteCommand, 'action'> & { to: string }> = [
  { id: 'nav-dashboard', label: 'Dashboard', description: 'Agency overview and attention queue', section: 'Navigation', shortcut: 'G D', keywords: ['command center', 'home'], to: '/' },
  { id: 'nav-clients', label: 'Clients', description: 'Accounts, portals, and activity', section: 'Navigation', shortcut: 'G C', keywords: ['accounts'], to: '/clients' },
  { id: 'nav-chat', label: 'Agency Chat', description: 'Coordinate work across the agency', section: 'Navigation', shortcut: 'G H', keywords: ['company chat'], to: '/company-chat' },
  { id: 'nav-agents', label: 'Agents', description: 'Configure your AI team', section: 'Navigation', shortcut: 'G A', keywords: ['team'], to: '/agents' },
  { id: 'nav-messages', label: 'Messages', description: 'Direct agent conversations', section: 'Navigation', shortcut: 'G M', keywords: ['threads', 'dm'], to: '/messages' },
  { id: 'nav-workflows', label: 'Workflows', description: 'Reusable process templates', section: 'Navigation', shortcut: 'G W', keywords: ['builder'], to: '/workflows' },
  { id: 'nav-missions', label: 'Missions', description: 'Multi-agent goals in flight', section: 'Navigation', shortcut: 'G T', keywords: ['goal', 'tasks'], to: '/missions' },
  { id: 'nav-executions', label: 'Executions', description: 'Live runs and results', section: 'Navigation', shortcut: 'G E', keywords: ['monitoring', 'runs'], to: '/monitoring' },
  { id: 'nav-approvals', label: 'Approvals', description: 'Items waiting on you', section: 'Navigation', shortcut: 'G P', keywords: ['review'], to: '/approvals' },
  { id: 'nav-integrations', label: 'Integrations', description: 'External systems and tool health', section: 'Navigation', shortcut: 'G I', keywords: ['gmail', 'slack'], to: '/integrations' },
  { id: 'nav-a2a', label: 'A2A Tasks', description: 'Agent-to-agent tasks and history', section: 'Navigation', shortcut: 'G 2', keywords: ['a2a'], to: '/a2a-tasks' },
  { id: 'nav-marketplace', label: 'Marketplace', description: 'Install templates and packs', section: 'Navigation', shortcut: 'G K', keywords: ['templates'], to: '/marketplace' },
  { id: 'nav-memory', label: 'Memory', description: 'Agent memory and retention', section: 'Navigation', shortcut: 'G R', keywords: ['memories'], to: '/memory' },
  { id: 'nav-analytics', label: 'Analytics', description: 'Performance and cost insights', section: 'Navigation', shortcut: 'G L', keywords: ['reports'], to: '/analytics' },
  { id: 'nav-evals', label: 'Evals', description: 'Testing and scorecards', section: 'Navigation', shortcut: 'G V', keywords: ['evaluations'], to: '/evals' },
]

function buildWorkflowInputValues(inputVariables?: WorkflowInputVariable[]) {
  const variables = inputVariables || []
  const values = variables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable.name] = variable.default || ''
    return acc
  }, {})
  const missingRequired = variables
    .filter(variable => variable.required && !(variable.default || '').trim())
    .map(variable => variable.label || variable.name)
  return { values, missingRequired }
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const canLoadDynamic = open && auth.isAuthenticated && !auth.isLoading && Boolean(auth.activeOrg?.id)

  const { data: agents = [] } = useQuery({
    queryKey: ['agents-for-palette'],
    queryFn: agentsApi.list,
    enabled: canLoadDynamic,
    staleTime: 30_000,
  })
  const { data: clientsResponse } = useQuery({
    queryKey: ['clients-for-palette'],
    queryFn: clientsApi.list,
    enabled: canLoadDynamic,
    staleTime: 30_000,
  })
  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows-for-palette'],
    queryFn: workflowsApi.list,
    enabled: canLoadDynamic,
    staleTime: 30_000,
  })

  const close = useCallback(() => {
    setQuery('')
    onOpenChange(false)
  }, [onOpenChange])

  const navigationCommands = useMemo<PaletteCommand[]>(
    () =>
      NAVIGATION_COMMANDS.map(item => ({
        ...item,
        action: () => navigate(item.to),
      })),
    [navigate],
  )

  const quickActions = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'quick-approve-all',
        label: 'Approve all pending items',
        description: 'Approve workflow and agent approval requests',
        section: 'Quick Actions',
        shortcut: '⌥ A',
        keywords: ['bulk approve', 'review all'],
        action: async () => {
          const [pendingApprovals, agentRequests] = await Promise.all([
            approvalsApi.pending(),
            approvalsApi.agentRequests(),
          ])

          const approvalCount = pendingApprovals.length + agentRequests.requests.length
          if (!approvalCount) {
            toast.info('Nothing is waiting for approval.')
            return
          }

          await Promise.all([
            ...pendingApprovals.map(item => approvalsApi.approve(item.id, 'Approved from Command Palette')),
            ...agentRequests.requests.map(item => approvalsApi.approveAgentRequest(item.id, 'Approved from Command Palette')),
          ])

          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['approvals'] }),
            queryClient.invalidateQueries({ queryKey: ['agency-overview'] }),
          ])
          toast.success(`Approved ${approvalCount} pending item${approvalCount === 1 ? '' : 's'}.`)
        },
      },
      {
        id: 'quick-new-agent',
        label: 'New agent',
        description: 'Open the AI Team form',
        section: 'Quick Actions',
        shortcut: '⌥ N',
        keywords: ['add agent', 'hire'],
        action: () => navigate('/agents?create=1'),
      },
      {
        id: 'quick-new-mission',
        label: 'New mission',
        description: 'Start a coordinated goal',
        section: 'Quick Actions',
        shortcut: '⌥ M',
        keywords: ['goal', 'create mission'],
        action: () => navigate('/missions?create=1'),
      },
      {
        id: 'quick-pause-all',
        label: 'Pause all',
        description: 'Open AI Team controls',
        section: 'Quick Actions',
        shortcut: '⌥ P',
        keywords: ['pause all agents'],
        action: () => {
          toast.info('Open AI Team to pause agents individually.')
          navigate('/agents')
        },
      },
    ],
    [navigate, queryClient],
  )

  const agentCommands = useMemo<PaletteCommand[]>(
    () =>
      agents.map(agent => ({
        id: `agent-${agent.id}`,
        label: agent.persona_name || agent.name,
        description: agent.role || agent.role_slug || 'Agent',
        section: 'Agents',
        keywords: [agent.name, agent.persona_name || '', agent.role || '', agent.role_slug || ''],
        action: () => navigate(`/agents?agent=${agent.id}`),
      })),
    [agents, navigate],
  )

  const clientCommands = useMemo<PaletteCommand[]>(
    () =>
      (clientsResponse?.clients || []).map(client => ({
        id: `client-${client.id}`,
        label: client.name,
        description: client.company_name || 'Client account',
        section: 'Clients',
        keywords: [client.name, client.company_name || '', client.contact_email || ''],
        action: () => navigate(`/clients/${client.id}`),
      })),
    [clientsResponse?.clients, navigate],
  )

  const workflowCommands = useMemo<PaletteCommand[]>(
    () =>
      workflows.flatMap(workflow => {
        const { values, missingRequired } = buildWorkflowInputValues(workflow.input_variables)
        return [
          {
            id: `workflow-open-${workflow.id}`,
            label: workflow.name,
            description: workflow.description || 'Open workflow builder',
            section: 'Workflows' as const,
            keywords: [workflow.name, workflow.description || '', 'open workflow'],
            action: () => navigate('/workflows'),
          },
          {
            id: `workflow-run-${workflow.id}`,
            label: `Run ${workflow.name}`,
            description:
              missingRequired.length > 0
                ? `Needs inputs: ${missingRequired.join(', ')}`
                : 'Run with saved defaults',
            section: 'Workflows' as const,
            keywords: [workflow.name, 'run workflow'],
            action: async () => {
              if (missingRequired.length > 0) {
                toast.info(`Open ${workflow.name} to fill required inputs: ${missingRequired.join(', ')}.`)
                navigate('/workflows')
                return
              }

              const execution =
                workflow.input_variables && workflow.input_variables.length > 0
                  ? await workflowsApi.run(workflow.id, values)
                  : await executionsApi.run(workflow.id, 'Run this workflow from the Command Palette.')

              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['workflows'] }),
                queryClient.invalidateQueries({ queryKey: ['recent-executions'] }),
                queryClient.invalidateQueries({ queryKey: ['agency-overview'] }),
              ])
              toast.success('Run started.')
              navigate(`/executions/${execution.execution_id}`)
            },
          },
        ]
      }),
    [navigate, queryClient, workflows],
  )

  const allCommands = useMemo(
    () => [...navigationCommands, ...quickActions, ...agentCommands, ...clientCommands, ...workflowCommands],
    [agentCommands, clientCommands, navigationCommands, quickActions, workflowCommands],
  )

  const fuse = useMemo(
    () =>
      new Fuse(allCommands, {
        includeScore: true,
        threshold: 0.35,
        ignoreLocation: true,
        keys: ['label', 'description', 'keywords', 'shortcut', 'section'],
      }),
    [allCommands],
  )

  const grouped = useMemo(() => {
    const orderedSections: CommandSection[] = ['Navigation', 'Quick Actions', 'Agents', 'Clients', 'Workflows']
    const groups = new Map<CommandSection, PaletteCommand[]>()
    for (const section of orderedSections) groups.set(section, [])
    for (const command of allCommands) {
      groups.get(command.section)?.push(command)
    }
    return orderedSections
      .map(section => ({ section, items: groups.get(section) || [] }))
      .filter(group => group.items.length > 0)
  }, [allCommands])

  const searchResults = useCallback(
    (query: string) => {
      if (!query.trim()) return grouped

      const resultIds = new Set(fuse.search(query.trim()).map(item => item.item.id))
      return grouped
        .map(group => ({
          section: group.section,
          items: group.items.filter(item => resultIds.has(item.id)),
        }))
        .filter(group => group.items.length > 0)
    },
    [fuse, grouped],
  )

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            className="cmdk-backdrop z-50"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="fixed inset-x-0 top-[12vh] z-[60] px-4"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <Command
              className="cmdk-panel mx-auto"
              shouldFilter={false}
              loop
            >
                <Command.Input
                  autoFocus
                  className="cmdk-search"
                  placeholder="Search pages, agents, clients, workflows…"
                  value={query}
                  onValueChange={setQuery}
                />
              <Command.List className="max-h-[60vh] overflow-y-auto py-2">
                <Command.Empty className="px-4 py-10 text-center text-sm text-white/35">
                  Nothing matched. Try a page, client, agent, or workflow name.
                </Command.Empty>
                {searchResults(query).map(group => (
                  <Command.Group
                    key={group.section}
                    heading={group.section}
                    className="data-[hidden=true]:hidden"
                  >
                    {group.items.map(item => (
                      <Command.Item
                        key={item.id}
                        value={[item.label, item.description || '', ...(item.keywords || [])].join(' ')}
                        onSelect={() => {
                          void item.action()
                          close()
                        }}
                        className="cmdk-row mx-2 rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{item.label}</div>
                          {item.description ? (
                            <div className="truncate text-xs text-white/35">{item.description}</div>
                          ) : null}
                        </div>
                        {item.shortcut ? <span className="cmdk-shortcut">{item.shortcut}</span> : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
              <div className="flex items-center gap-4 border-t border-white/[0.08] px-4 py-3 text-xs text-white/30">
                <span>↑↓ navigate</span>
                <span>Enter select</span>
                <span>Esc close</span>
              </div>
            </Command>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
}

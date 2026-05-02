import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { agentsApi, executionsApi, workflowsApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: string
  action: () => void | Promise<void>
  group: string
  keywords?: string[]
}

const RECENT_STORAGE_KEY = 'aethon-command-palette-recents'

function loadRecentIds() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY)
    return raw ? JSON.parse(raw) as string[] : []
  } catch {
    return []
  }
}

function saveRecentIds(ids: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids.slice(0, 6)))
}

function fuzzyMatch(value: string, query: string) {
  const haystack = value.toLowerCase()
  const needle = query.toLowerCase().trim()
  if (!needle) return true
  if (haystack.includes(needle)) return true

  let searchIndex = 0
  for (const character of needle) {
    const foundAt = haystack.indexOf(character, searchIndex)
    if (foundAt === -1) return false
    searchIndex = foundAt + 1
  }
  return true
}

export function CommandPalette() {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecentIds())
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canLoadDynamicCommands = open && auth.isAuthenticated && !auth.isLoading && Boolean(auth.activeOrg?.id)

  const { data: agents = [] } = useQuery({
    queryKey: ['agents-for-palette'],
    queryFn: agentsApi.list,
    enabled: canLoadDynamicCommands,
    staleTime: 30_000,
  })

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows-for-palette'],
    queryFn: workflowsApi.list,
    enabled: canLoadDynamicCommands,
    staleTime: 30_000,
  })

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(prev => !prev)
      }
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const rememberCommand = useCallback((id: string) => {
    setRecentIds(prev => {
      const next = [id, ...prev.filter(item => item !== id)].slice(0, 6)
      saveRecentIds(next)
      return next
    })
  }, [])

  const run = useCallback(async (command: CommandItem) => {
    rememberCommand(command.id)
    await command.action()
    close()
  }, [close, rememberCommand])

  const navCommands = useMemo<CommandItem[]>(() => [
    {
      id: 'nav-dashboard',
      label: 'Go to Command Center',
      icon: '⚡',
      group: 'Navigate',
      action: () => navigate('/'),
      keywords: ['home', 'dashboard', 'overview'],
    },
    {
      id: 'nav-agents',
      label: 'Go to Agents',
      icon: '🤖',
      group: 'Navigate',
      action: () => navigate('/agents'),
      keywords: ['team', 'employees'],
    },
    {
      id: 'nav-workflows',
      label: 'Go to Workflows',
      icon: '🔄',
      group: 'Navigate',
      action: () => navigate('/workflows'),
    },
    {
      id: 'nav-executions',
      label: 'Go to Executions',
      icon: '▶',
      group: 'Navigate',
      action: () => navigate('/executions'),
      keywords: ['monitoring', 'runs'],
    },
    {
      id: 'nav-marketplace',
      label: 'Go to Marketplace',
      icon: '🛒',
      group: 'Navigate',
      action: () => navigate('/marketplace'),
      keywords: ['install', 'templates'],
    },
    {
      id: 'nav-integrations',
      label: 'Go to Integrations',
      icon: '🔌',
      group: 'Navigate',
      action: () => navigate('/integrations'),
      keywords: ['slack', 'gmail'],
    },
    {
      id: 'nav-approvals',
      label: 'View Approvals',
      icon: '📋',
      group: 'Navigate',
      action: () => navigate('/approvals'),
      keywords: ['review', 'audit'],
    },
  ], [navigate])

  const actionCommands = useMemo<CommandItem[]>(() => [
    {
      id: 'action-new-agent',
      label: 'Create new agent',
      icon: '➕',
      group: 'Actions',
      action: () => navigate('/agents'),
      keywords: ['hire', 'add'],
    },
    {
      id: 'action-marketplace',
      label: 'Install from marketplace',
      icon: '📦',
      group: 'Actions',
      action: () => navigate('/marketplace'),
      keywords: ['browse', 'templates'],
    },
    {
      id: 'action-integrations',
      label: 'Connect Gmail or Slack',
      icon: '🔗',
      group: 'Actions',
      action: () => navigate('/integrations'),
      keywords: ['connect', 'oauth'],
    },
  ], [navigate])

  const agentCommands = useMemo<CommandItem[]>(() => (
    agents.slice(0, 10).map(agent => ({
      id: `agent-${agent.id}`,
      label: `Open ${agent.name}`,
      description: agent.role_slug ?? agent.model,
      icon: '🤖',
      group: 'Agents',
      action: () => navigate(`/agents?agent=${agent.id}`),
      keywords: [agent.name, agent.role || '', agent.role_slug || ''],
    }))
  ), [agents, navigate])

  const workflowCommands = useMemo<CommandItem[]>(() => (
    workflows.slice(0, 10).flatMap(workflow => ([
      {
        id: `workflow-open-${workflow.id}`,
        label: `Open workflow ${workflow.name}`,
        description: 'Go to workflow builder',
        icon: '🧭',
        group: 'Workflows',
        action: () => navigate('/workflows'),
        keywords: [workflow.name, workflow.description || ''],
      },
      {
        id: `workflow-run-${workflow.id}`,
        label: `Run workflow ${workflow.name}`,
        description: 'Start immediately',
        icon: '▶',
        group: 'Run Workflow',
        action: async () => {
          const execution = await executionsApi.run(workflow.id, 'Run this workflow from the Command Palette.')
          queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
          queryClient.invalidateQueries({ queryKey: ['recent-executions'] })
          toast.info('Run started')
          navigate(`/executions/${execution.execution_id}`)
        },
        keywords: [workflow.name, 'run', 'execute'],
      },
    ]))
  ), [navigate, queryClient, workflows])

  const allCommands = useMemo(
    () => [...navCommands, ...actionCommands, ...agentCommands, ...workflowCommands],
    [actionCommands, agentCommands, navCommands, workflowCommands],
  )

  const recentCommands = useMemo(
    () => recentIds.map(id => allCommands.find(command => command.id === id)).filter(Boolean) as CommandItem[],
    [allCommands, recentIds],
  )

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands
    return allCommands.filter(command =>
      fuzzyMatch(
        [
          command.label,
          command.description || '',
          ...(command.keywords || []),
        ].join(' '),
        query,
      ),
    )
  }, [allCommands, query])

  const grouped = useMemo(() => {
    const source = !query.trim() && recentCommands.length
      ? [{ heading: 'Recent', items: recentCommands }, ...Object.entries(
        allCommands.reduce<Record<string, CommandItem[]>>((acc, command) => {
          if (!acc[command.group]) acc[command.group] = []
          acc[command.group].push(command)
          return acc
        }, {}),
      ).map(([heading, items]) => ({ heading, items }))]
      : Object.entries(
        filteredCommands.reduce<Record<string, CommandItem[]>>((acc, command) => {
          if (!acc[command.group]) acc[command.group] = []
          acc[command.group].push(command)
          return acc
        }, {}),
      ).map(([heading, items]) => ({ heading, items }))

    const seen = new Set<string>()
    return source.map(group => ({
      heading: group.heading,
      items: group.items.filter(command => {
        if (group.heading === 'Recent') return true
        if (seen.has(command.id)) return false
        seen.add(command.id)
        return true
      }),
    })).filter(group => group.items.length > 0)
  }, [allCommands, filteredCommands, query, recentCommands])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed left-1/2 top-[20vh] z-50 w-full max-w-xl -translate-x-1/2 px-4"
          >
            <Command
              className="overflow-hidden rounded-xl shadow-2xl"
              style={{
                background: '#0F1520',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
              shouldFilter={false}
            >
              <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
                <span className="text-sm text-white/30">⌘</span>
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Type a command or search…"
                  autoFocus
                  className="flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/25"
                />
                <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-xs text-white/20">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-72 overflow-y-auto py-2">
                <Command.Empty className="py-8 text-center text-sm text-white/30">
                  No results for &quot;{query}&quot;
                </Command.Empty>

                {grouped.map(group => (
                  <Command.Group
                    key={group.heading}
                    heading={group.heading}
                    className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-white/25"
                  >
                    {group.items.map(command => (
                      <Command.Item
                        key={command.id}
                        value={`${command.label} ${command.description ?? ''} ${(command.keywords || []).join(' ')}`}
                        onSelect={() => void run(command)}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-white/70 transition-colors data-[selected=true]:border-l-2 data-[selected=true]:border-accent-purple data-[selected=true]:bg-accent-purple/15 data-[selected=true]:text-white/90"
                      >
                        {command.icon && (
                          <span className="w-5 flex-shrink-0 text-center text-base">{command.icon}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{command.label}</div>
                          {command.description && (
                            <div className="truncate text-xs text-white/30">{command.description}</div>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>

              <div className="flex items-center gap-4 border-t border-white/5 px-4 py-2">
                {[
                  ['↑↓', 'navigate'],
                  ['↵', 'select'],
                  ['esc', 'close'],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <kbd className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-xs text-white/20">
                      {key}
                    </kbd>
                    <span className="text-xs text-white/20">{label}</span>
                  </div>
                ))}
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

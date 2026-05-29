import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Building,
  CheckCircle,
  CheckCircle2,
  Cpu,
  FileText,
  GitBranch,
  LayoutDashboard,
  Plus,
  Plug,
  Search,
  Settings,
  Store,
  Target,
  TestTube,
  UserPlus,
  Users,
} from 'lucide-react'
import { agentsApi, api, clientsApi } from '../api/client'
import { useDebounce } from '../hooks/useDebounce'
import type { GlobalSearchResponse, SearchResult } from '../types'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const navigate = useNavigate()
  const debouncedQ = useDebounce(searchValue.trim(), 300)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  useEffect(() => {
    if (!open) {
      setSearchValue('')
    }
  }, [open])

  const { data: agents = [] } = useQuery({
    queryKey: ['agents-cmdk'],
    queryFn: () => agentsApi.list(),
    enabled: open,
    staleTime: 30_000,
  })
  const { data: clientsResponse } = useQuery({
    queryKey: ['clients-cmdk'],
    queryFn: () => clientsApi.list(),
    enabled: open,
    staleTime: 30_000,
  })
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['global-search', debouncedQ],
    queryFn: () =>
      debouncedQ.length >= 2
        ? api.get<GlobalSearchResponse>('/search', { params: { q: debouncedQ } }).then(r => r.data)
        : Promise.resolve({ results: [], total: 0, query: debouncedQ }),
    enabled: open && debouncedQ.length >= 2,
    staleTime: 30_000,
  })

  const clients = clientsResponse?.clients || []
  const showingSearchResults = searchValue.trim().length >= 2
  const results = searchResults?.results || []

  const ICON_MAP = {
    agent: Bot,
    client: Building,
    file: FileText,
    execution: Activity,
    mission: Target,
    workflow: GitBranch,
  } satisfies Record<SearchResult['type'], typeof Bot>

  const PAGES = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Clients', icon: Users, path: '/clients' },
    { label: 'Team Members', icon: Bot, path: '/agents' },
    { label: 'Processes', icon: GitBranch, path: '/workflows' },
    { label: 'Runs', icon: Activity, path: '/monitoring' },
    { label: 'Approvals', icon: CheckCircle, path: '/approvals' },
    { label: 'Projects', icon: Target, path: '/missions' },
    { label: 'Analytics', icon: BarChart3, path: '/analytics' },
    { label: 'Evaluations', icon: TestTube, path: '/evals' },
    { label: 'Marketplace', icon: Store, path: '/marketplace' },
    { label: 'Integrations', icon: Plug, path: '/integrations' },
    { label: 'Models', icon: Cpu, path: '/settings/models' },
    { label: 'Memory', icon: Brain, path: '/memory' },
    { label: 'Settings', icon: Settings, path: '/settings/org' },
  ]

  const ACTIONS = [
    { label: 'Approve all pending', icon: CheckCircle2, action: () => { navigate('/approvals'); setOpen(false) } },
    { label: 'New team member', icon: UserPlus, action: () => { navigate('/agents?create=1'); setOpen(false) } },
    { label: 'New process', icon: Plus, action: () => { navigate('/workflows?new=1'); setOpen(false) } },
    { label: 'Start a project', icon: Target, action: () => { navigate('/missions?create=1'); setOpen(false) } },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="cmdk-panel"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
          >
            <Command shouldFilter={false}>
              <Command.Input
                className="cmdk-input"
                placeholder="Search or run commands..."
                autoFocus
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <Command.List style={{ maxHeight: 340, overflowY: 'auto' }}>
                {showingSearchResults ? (
                  <>
                    {results.length > 0 || isFetching ? (
                      <Command.Group
                        heading={(
                          <span className="cmdk-group">
                            Search Results
                            {isFetching ? <span className="ml-2 text-t4">...</span> : null}
                          </span>
                        )}
                      >
                        {results.map(result => {
                          const Icon = ICON_MAP[result.type] ?? Search
                          return (
                            <Command.Item
                              key={`${result.type}-${result.id}`}
                              value={`${result.title} ${result.subtitle} ${result.type}`}
                              className="cmdk-row-item"
                              onSelect={() => {
                                navigate(result.navigate_to)
                                setOpen(false)
                              }}
                            >
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
                                <Icon size={12} style={{ color: 'rgba(255,255,255,0.55)' }} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-white">
                                  {result.title}
                                </span>
                                {result.subtitle ? (
                                  <span className="block truncate text-[11px] text-t3">
                                    {result.subtitle}
                                  </span>
                                ) : null}
                              </div>
                              <span className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-t4">
                                {result.type}
                              </span>
                            </Command.Item>
                          )
                        })}
                        {results.length === 0 && isFetching ? (
                          <div className="px-4 py-3 text-sm text-t3">
                            Searching…
                          </div>
                        ) : null}
                      </Command.Group>
                    ) : null}

                    {debouncedQ.length >= 2 && results.length === 0 && !isFetching ? (
                      <div className="py-6 text-center text-sm text-t3">
                        No results for "{debouncedQ}"
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Command.Group heading={<span className="cmdk-group">Quick Actions</span>}>
                      {ACTIONS.map(a => (
                        <Command.Item key={a.label} className="cmdk-row-item" onSelect={a.action}>
                          <a.icon size={14} style={{ color: 'rgba(255,255,255,0.40)' }} />
                          {a.label}
                        </Command.Item>
                      ))}
                    </Command.Group>

                    <Command.Group heading={<span className="cmdk-group">Navigate</span>}>
                      {PAGES.map(p => (
                        <Command.Item
                          key={p.path}
                          className="cmdk-row-item"
                          onSelect={() => {
                            navigate(p.path)
                            setOpen(false)
                          }}
                        >
                          <p.icon size={14} style={{ color: 'rgba(255,255,255,0.40)' }} />
                          {p.label}
                          <span
                            className="ml-auto rounded font-mono text-[10px]"
                            style={{ color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', padding: '2px 5px' }}
                          >
                            ↵
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>

                    {agents.length > 0 && (
                      <Command.Group heading={<span className="cmdk-group">Team Members</span>}>
                        {agents.slice(0, 5).map(a => (
                          <Command.Item
                            key={a.id}
                            className="cmdk-row-item"
                            onSelect={() => {
                              navigate(`/agents?agent=${a.id}`)
                              setOpen(false)
                            }}
                          >
                            <Bot size={14} style={{ color: 'rgba(255,255,255,0.40)' }} />
                            {a.persona_name || a.name}
                            <span className="ml-1 text-xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
                              {a.role}
                            </span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {clients.length > 0 && (
                      <Command.Group heading={<span className="cmdk-group">Clients</span>}>
                        {clients.slice(0, 5).map(c => (
                          <Command.Item
                            key={c.id}
                            className="cmdk-row-item"
                            onSelect={() => {
                              navigate(`/clients/${c.id}`)
                              setOpen(false)
                            }}
                          >
                            <Building size={14} style={{ color: 'rgba(255,255,255,0.40)' }} />
                            {c.company_name || c.name}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </>
                )}
              </Command.List>

              <div className="flex items-center gap-4 border-t px-3 py-2" style={{ borderColor: '#2A2A2A' }}>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  <kbd className="font-mono">↑↓</kbd> navigate
                  <kbd className="ml-2 font-mono">↵</kbd> select
                  <kbd className="ml-2 font-mono">esc</kbd> close
                </span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

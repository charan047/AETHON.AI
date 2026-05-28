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
  GitBranch,
  LayoutDashboard,
  Plus,
  Plug,
  Settings,
  Store,
  Target,
  TestTube,
  UserPlus,
  Users,
} from 'lucide-react'
import { agentsApi, clientsApi } from '../api/client'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

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

  const clients = clientsResponse?.clients || []

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
            <Command>
              <Command.Input
                className="cmdk-input"
                placeholder="Search or run commands..."
                autoFocus
              />
              <Command.List style={{ maxHeight: 340, overflowY: 'auto' }}>
                <Command.Empty>
                  <div className="p-6 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    No results
                  </div>
                </Command.Empty>

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

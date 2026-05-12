import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  Building2,
  CheckCircle2,
  FlaskConical,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageCircle,
  Settings,
  ShoppingBag,
  Wrench,
  Workflow,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { useAuth } from '../../contexts/AuthContext'
import { approvalsApi, messagesApi, modelsApi } from '../../api/client'
import { AgentAvatar } from '../ui/AgentAvatar'
import { OrgSwitcher } from '../org/OrgSwitcher'

type NavItem = {
  to: string
  icon: typeof LayoutDashboard
  label: string
  activePrefixes?: string[]
  badge?: 'approvals' | 'models' | 'messages'
}

type NavGroup = {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'AGENCY',
    items: [
      { to: '/clients', icon: Briefcase, label: 'Clients', activePrefixes: ['/clients'] },
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', activePrefixes: ['/', '/dashboard'] },
      { to: '/company-chat', icon: Building2, label: 'Agency Chat', activePrefixes: ['/company-chat'] },
    ],
  },
  {
    title: 'AI TEAM',
    items: [
      { to: '/agents', icon: Bot, label: 'Agents', activePrefixes: ['/agents'] },
      { to: '/messages', icon: MessageCircle, label: 'Agent Messages', activePrefixes: ['/messages'], badge: 'messages' },
      { to: '/workflows', icon: Workflow, label: 'Workflows', activePrefixes: ['/workflows'] },
      { to: '/monitoring', icon: BarChart3, label: 'Executions', activePrefixes: ['/monitoring', '/executions'] },
      { to: '/approvals', icon: CheckCircle2, label: 'Approvals', activePrefixes: ['/approvals'], badge: 'approvals' },
    ],
  },
  {
    title: 'TOOLS',
    items: [
      { to: '/integrations', icon: Link2, label: 'Integrations', activePrefixes: ['/integrations'] },
      { to: '/marketplace', icon: ShoppingBag, label: 'Marketplace', activePrefixes: ['/marketplace'] },
      { to: '/tools', icon: Wrench, label: 'Custom Tools', activePrefixes: ['/tools'] },
      { to: '/memory', icon: Brain, label: 'Memory', activePrefixes: ['/memory'] },
    ],
  },
  {
    title: 'SETTINGS',
    items: [
      { to: '/settings/org', icon: Settings, label: 'Settings', activePrefixes: ['/settings/org', '/company'] },
      { to: '/settings/models', icon: Bot, label: 'AI Models', activePrefixes: ['/settings/models'], badge: 'models' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', activePrefixes: ['/analytics'] },
      { to: '/evals', icon: FlaskConical, label: 'Evals', activePrefixes: ['/evals'] },
      { to: '/settings/team', icon: Briefcase, label: 'Team Structure', activePrefixes: ['/settings/team', '/org-chart'] },
    ],
  },
]

function Badge({
  count,
  tone = 'red',
  compact = false,
}: {
  count?: number
  tone?: 'red' | 'blue' | 'amber'
  compact?: boolean
}) {
  if (!count) return null

  const tones = {
    red: 'bg-red-500/15 text-red-300 border-red-500/20',
    blue: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full border text-[10px] font-semibold',
        tones[tone],
        compact ? 'h-5 min-w-5 px-1.5' : 'min-w-5 px-1.5 py-0.5',
      )}
    >
      {count}
    </span>
  )
}

export function Sidebar({
  mobileOpen = false,
  onCloseMobile,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}) {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const canLoadOrgScopedSidebarData = auth.isAuthenticated && !auth.isLoading && Boolean(auth.activeOrg?.id)

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: approvalsApi.pending,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 30_000,
  })
  const agentRequestsQuery = useQuery({
    queryKey: ['approvals', 'agent-requests-sidebar'],
    queryFn: approvalsApi.agentRequests,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 30_000,
  })
  const { data: modelConfigs = [] } = useQuery({
    queryKey: ['model-configs', 'sidebar'],
    queryFn: modelsApi.list,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 60_000,
  })
  const { data: unreadData } = useQuery({
    queryKey: ['messages-unread-count'],
    queryFn: () => messagesApi.unreadCount(),
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 30_000,
  })

  const unreadMessages = unreadData?.count || 0
  const combinedApprovals = pendingApprovals.length + (agentRequestsQuery.data?.pending_count || 0)
  const hasFailedModels = modelConfigs.some(config => config.test_status === 'failed')

  const signOut = () => {
    auth.logout()
    navigate('/login')
  }

  const isActive = (item: NavItem) => {
    const prefixes = item.activePrefixes || [item.to]
    if (item.to === '/') {
      return location.pathname === '/' || location.pathname === '/dashboard' || location.pathname === '/company-os'
    }
    return prefixes.some(prefix => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))
  }

  const handleNavClick = () => {
    onCloseMobile?.()
  }

  const displayName = auth.activeOrg?.name || auth.email?.split('@')[0] || 'Agency Owner'

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-30 flex h-full w-[240px] shrink-0 flex-col overflow-hidden',
        'bg-[rgba(8,13,26,0.85)] shadow-[1px_0_0_rgba(255,255,255,0.06),0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl',
        'transition-transform duration-300 ease-out lg:static',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.18),transparent_60%)]" />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-[0_0_12px_rgba(37,99,235,0.4)]">
            <Briefcase size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-extrabold tracking-tight text-white">Aethon</span>
            <span className="ml-1.5 rounded bg-blue-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
              Agency OS
            </span>
          </div>
        </div>

        <div className="px-4 pt-2">
          <OrgSwitcher collapsed={false} />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map(group => (
            <div key={group.title} className="pb-3">
              <p className="px-5 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-[0.20em] text-[#2D3748]">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map(item => {
                  const active = isActive(item)
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={handleNavClick}
                      className={clsx(
                        'group relative flex cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500/30',
                        active
                          ? 'bg-blue-600/12 text-blue-300'
                          : 'text-[#4B5A73] hover:bg-white/[0.04] hover:text-[#8B9DBE]',
                      )}
                    >
                      {active && <div className="absolute left-0 h-5 w-0.5 rounded-r-full bg-blue-500" />}
                      <Icon size={16} className={active ? 'text-blue-400' : 'text-[#4B5A73] transition-colors group-hover:text-[#8B9DBE]'} />
                      <span className="truncate">{item.label}</span>
                      {item.badge === 'approvals' && <span className="ml-auto"><Badge count={combinedApprovals} tone="red" compact /></span>}
                      {item.badge === 'messages' && <span className="ml-auto"><Badge count={unreadMessages} tone="blue" compact /></span>}
                      {item.badge === 'models' && hasFailedModels && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-300">
                          !
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
            <AgentAvatar name={displayName} color="linear-gradient(135deg, #2563EB, #10B981)" size="md" />
            <Link
              to="/settings/org"
              onClick={handleNavClick}
              className="min-w-0 flex-1 cursor-pointer focus:outline-none"
            >
              <div className="truncate text-sm font-semibold text-white">{displayName}</div>
              <div className="truncate text-xs text-[#4B5A73]">{auth.email || 'Open settings'}</div>
            </Link>
            <Link
              to="/settings/org"
              aria-label="Open settings"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[#8B9DBE] transition duration-150 hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              onClick={handleNavClick}
            >
              <Settings size={16} />
            </Link>
            <button
              type="button"
              aria-label="Sign out"
              onClick={signOut}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[#8B9DBE] transition duration-150 hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

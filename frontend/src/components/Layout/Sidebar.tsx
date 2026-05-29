import { Link, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Bot,
  Brain,
  Briefcase,
  Building2,
  CheckCircle2,
  FolderOpen,
  FlaskConical,
  LayoutDashboard,
  Link2,
  MessageCircle,
  PanelLeftClose,
  Settings,
  ShoppingBag,
  Target,
  Wrench,
  Workflow,
  Zap,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { useAuth } from '../../contexts/AuthContext'
import { a2aApi, approvalsApi, messagesApi, missionsApi, modelsApi } from '../../api/client'
import { NotificationCenter } from '../NotificationCenter'
import { ShinyText } from '../reactbits/ShinyText'
import { ThemeToggle } from '../ui/ThemeToggle'
import { OrgSwitcher } from '../org/OrgSwitcher'

type NavItem = {
  to: string
  icon: typeof LayoutDashboard
  label: string
  activePrefixes?: string[]
  badge?: 'approvals' | 'models' | 'messages' | 'missions'
  requiresA2A?: boolean
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
      { to: '/files', icon: FolderOpen, label: 'Files', activePrefixes: ['/files'] },
    ],
  },
  {
    title: 'AI TEAM',
    items: [
      { to: '/agents', icon: Bot, label: 'Agents', activePrefixes: ['/agents'] },
      { to: '/messages', icon: MessageCircle, label: 'Agent Messages', activePrefixes: ['/messages'], badge: 'messages' },
      { to: '/workflows', icon: Workflow, label: 'Processes', activePrefixes: ['/workflows'] },
      { to: '/missions', icon: Target, label: 'Projects', activePrefixes: ['/missions'], badge: 'missions' },
      { to: '/monitoring', icon: BarChart3, label: 'Runs', activePrefixes: ['/monitoring', '/executions'] },
      { to: '/approvals', icon: CheckCircle2, label: 'Approvals', activePrefixes: ['/approvals'], badge: 'approvals' },
    ],
  },
  {
    title: 'TOOLS',
    items: [
      { to: '/integrations', icon: Link2, label: 'Integrations', activePrefixes: ['/integrations'] },
      { to: '/a2a-tasks', icon: Target, label: 'A2A Tasks', activePrefixes: ['/a2a-tasks'], requiresA2A: true },
      { to: '/marketplace', icon: ShoppingBag, label: 'Marketplace', activePrefixes: ['/marketplace'] },
      { to: '/tools', icon: Wrench, label: 'Custom Tools', activePrefixes: ['/tools'] },
      { to: '/memory', icon: Brain, label: 'Memory', activePrefixes: ['/memory'] },
    ],
  },
  {
    title: 'SETTINGS',
    items: [
      { to: '/settings/org', icon: Settings, label: 'Settings', activePrefixes: ['/settings/org', '/company'] },
      { to: '/settings/cto', icon: Zap, label: 'CTO', activePrefixes: ['/settings/cto'] },
      { to: '/settings/notifications', icon: Bell, label: 'Notifications', activePrefixes: ['/settings/notifications'] },
      { to: '/settings/external-agents', icon: Link2, label: 'External Agents', activePrefixes: ['/settings/external-agents'] },
      { to: '/settings/models', icon: Bot, label: 'AI Models', activePrefixes: ['/settings/models'], badge: 'models' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', activePrefixes: ['/analytics'] },
      { to: '/evals', icon: FlaskConical, label: 'Evals', activePrefixes: ['/evals'] },
      { to: '/settings/team', icon: Briefcase, label: 'Team Structure', activePrefixes: ['/settings/team', '/org-chart'] },
    ],
  },
]

function badgeCount(
  item: NavItem,
  counts: {
    approvals: number
    unreadMessages: number
    activeMissions: number
    hasFailedModels: boolean
  },
) {
  if (item.badge === 'approvals') return counts.approvals
  if (item.badge === 'messages') return counts.unreadMessages
  if (item.badge === 'missions') return counts.activeMissions
  if (item.badge === 'models') return counts.hasFailedModels ? 1 : 0
  return 0
}

export function Sidebar({
  mobileOpen = false,
  onCloseMobile,
  onToggleCollapsed,
}: {
  mobileOpen?: boolean
  onCloseMobile?: () => void
  onToggleCollapsed: () => void
}) {
  const auth = useAuth()
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
  const missionsQuery = useQuery({
    queryKey: ['missions', 'sidebar'],
    queryFn: missionsApi.list,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 15_000,
  })
  const a2aTasksQuery = useQuery({
    queryKey: ['a2a', 'sidebar'],
    queryFn: a2aApi.listTasks,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 30_000,
  })

  const unreadMessages = unreadData?.count || 0
  const combinedApprovals = pendingApprovals.length + (agentRequestsQuery.data?.pending_count || 0)
  const hasFailedModels = modelConfigs.some(config => config.test_status === 'failed')
  const activeMissionsCount = (missionsQuery.data || []).filter(mission => mission.status === 'active' || mission.status === 'planning').length
  const a2aEnabled = a2aTasksQuery.data?.enabled !== false

  const counts = {
    approvals: combinedApprovals,
    unreadMessages,
    activeMissions: activeMissionsCount,
    hasFailedModels,
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

  const profileName = auth.email
    ? auth.email
        .split('@')[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : auth.activeOrg?.name || 'Agency Owner'
  const userInitials =
    profileName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('') || 'AO'
  const userRole = auth.activeOrg?.role ? `${auth.activeOrg.role}` : 'Owner'

  return (
    <aside
      className={clsx(
        'sidebar-nav fixed inset-y-0 left-0 z-30 flex h-full w-[248px] flex-col transition-transform duration-200 ease-out lg:relative lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 shadow-[0_0_18px_rgba(99,102,241,0.3)]">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-white">Aethon</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            <ShinyText>Agency OS</ShinyText>
          </div>
        </div>
      </div>

      <div className="px-3 pb-2">
        <OrgSwitcher collapsed={false} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
          {NAV_GROUPS.map(group => (
            <div key={group.title} className="pt-2">
              <div className="nav-group">{group.title}</div>
              <div className="space-y-1">
                {group.items.filter(item => !item.requiresA2A || a2aEnabled).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  const count = badgeCount(item, counts)

                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={handleNavClick}
                      className={`nav-item ${active ? 'active' : ''}`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {count > 0 ? (
                        <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] bg-red-500/15 text-red-400">
                          {count}
                        </span>
                      ) : null}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={onToggleCollapsed}
            className="group mx-2 mb-1 mt-auto flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-all duration-150 hover:bg-white/[0.04]"
          >
            <PanelLeftClose size={16} className="text-t3 transition-colors group-hover:text-white" />
            <span className="text-xs text-t3 transition-colors group-hover:text-white">Hide sidebar</span>
            <span className="ml-auto rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-t3 transition-colors group-hover:text-white">
              ⌘\
            </span>
          </button>
        </nav>

        <div className="mt-auto border-t border-white/[0.07] p-3">
          <div className="sidebar-footer-card p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-xs font-bold text-indigo-300">
                {userInitials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{profileName}</div>
                <div className="truncate text-[11px] text-t3">{userRole}</div>
              </div>
            </div>

            <div className="sidebar-utility-rail" data-testid="sidebar-footer-utilities">
              <NotificationCenter />
              <ThemeToggle />
              <Link
                to="/settings/org"
                onClick={handleNavClick}
                aria-label="Open settings"
                className="btn-icon"
              >
                <Settings size={16} />
              </Link>
              <span className="sidebar-command-pill">
                ⌘K
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

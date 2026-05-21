import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Bot,
  Brain,
  Briefcase,
  Building2,
  CheckCircle2,
  FlaskConical,
  LayoutDashboard,
  Link2,
  MessageCircle,
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
    ],
  },
  {
    title: 'AI TEAM',
    items: [
      { to: '/agents', icon: Bot, label: 'Agents', activePrefixes: ['/agents'] },
      { to: '/messages', icon: MessageCircle, label: 'Agent Messages', activePrefixes: ['/messages'], badge: 'messages' },
      { to: '/workflows', icon: Workflow, label: 'Workflows', activePrefixes: ['/workflows'] },
      { to: '/missions', icon: Target, label: 'Missions', activePrefixes: ['/missions'], badge: 'missions' },
      { to: '/monitoring', icon: BarChart3, label: 'Executions', activePrefixes: ['/monitoring', '/executions'] },
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

  return <span className={clsx('inline-flex items-center justify-center text-[10px] font-semibold', tones[tone], compact ? 'h-5 min-w-5 px-1.5 rounded-full border' : 'min-w-5 px-1.5 py-0.5 rounded-full border')}>{count}</span>
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
  const profileMeta = auth.email || auth.activeOrg?.name || 'Open settings'
  const userInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'AO'

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-30 flex h-full w-[220px] shrink-0 flex-col overflow-visible',
        'shadow-none',
        'transition-transform duration-300 ease-out lg:static',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}
      style={{
        background: 'rgba(5,9,20,0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="relative z-10 flex h-full flex-col overflow-visible">
        <div className="flex min-h-14 items-center gap-3 px-4 py-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              boxShadow: '0 0 18px rgba(99,102,241,0.28)',
            }}
          >
            <Zap size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold tracking-tight text-white">Aethon</div>
            <span className="badge-indigo mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] leading-none">Agency OS</span>
          </div>
          <div className="shrink-0">
            <ThemeToggle />
          </div>
        </div>

        <div className="px-4 pt-2">
          <OrgSwitcher collapsed={false} />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map(group => (
            <div key={group.title} className="pb-3">
              <p
                className="px-3 pb-1 pt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.22em]"
                style={{ color: 'rgba(255,255,255,0.18)' }}
              >
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.filter(item => !item.requiresA2A || a2aEnabled).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={handleNavClick}
                      className={clsx(
                        'group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                        'focus:outline-none focus:ring-2 focus:ring-indigo-500/25',
                        active
                          ? 'border border-indigo-500/15 bg-indigo-500/10 text-indigo-300'
                          : 'border border-transparent text-ink-muted hover:bg-white/[0.04] hover:text-ink-secondary',
                      )}
                    >
                      {active && <div className="absolute left-0 h-5 w-0.5 rounded-r-full bg-indigo-400" />}
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.badge === 'approvals' && (
                        <span className="ml-auto rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-400">
                          {combinedApprovals}
                        </span>
                      )}
                      {item.badge === 'messages' && unreadMessages > 0 && (
                        <span className="ml-auto rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-400">
                          {unreadMessages}
                        </span>
                      )}
                      {item.badge === 'missions' && activeMissionsCount > 0 && (
                        <span className="ml-auto rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-400">
                          {activeMissionsCount}
                        </span>
                      )}
                      {item.badge === 'models' && hasFailedModels && (
                        <span className="ml-auto rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-400">
                          1
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.08] p-3">
          <div className="grid grid-cols-[auto,1fr,auto] items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              }}
            >
              {userInitials}
            </div>
            <Link
              to="/settings/org"
              onClick={handleNavClick}
              className="min-w-0 cursor-pointer focus:outline-none"
            >
              <div className="break-words text-sm font-semibold leading-5 text-white">{profileName}</div>
              <div className="mt-1 break-all text-[11px] leading-4 text-white/35">{profileMeta}</div>
            </Link>
            <div className="flex flex-col gap-2">
              <Link
                to="/settings/org"
                aria-label="Open settings"
                className="btn-icon text-white/45 hover:text-white"
                onClick={handleNavClick}
              >
                <Settings size={16} />
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

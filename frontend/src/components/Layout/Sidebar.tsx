import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageCircle,
  Network,
  Settings,
  ShoppingBag,
  Users,
  Wrench,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { useAuth } from '../../contexts/AuthContext'
import { approvalsApi, modelsApi } from '../../api/client'
import { AgentAvatar } from '../ui/AgentAvatar'
import { OrgSwitcher } from '../org/OrgSwitcher'

type NavItem = {
  to: string
  icon: typeof LayoutDashboard
  label: string
  badge?: string
  comingSoon?: boolean
  activePrefixes?: string[]
}

type NavGroup = {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'COMPANY',
    items: [
      {
        to: '/',
        icon: LayoutDashboard,
        label: 'Command Center',
        activePrefixes: ['/', '/dashboard'],
      },
      {
        to: '/org-chart',
        icon: Network,
        label: 'Org Chart',
        comingSoon: true,
      },
    ],
  },
  {
    title: 'AGENTS',
    items: [
      {
        to: '/agents',
        icon: Users,
        label: 'All Agents',
      },
      {
        to: '/messages',
        icon: MessageCircle,
        label: 'Messages',
        activePrefixes: ['/messages', '/company-chat'],
      },
    ],
  },
  {
    title: 'WORK',
    items: [
      {
        to: '/workflows',
        icon: GitBranch,
        label: 'Workflows',
      },
      {
        to: '/executions',
        icon: Activity,
        label: 'Executions',
        activePrefixes: ['/executions', '/monitoring'],
      },
      {
        to: '/marketplace',
        icon: ShoppingBag,
        label: 'Marketplace',
      },
    ],
  },
  {
    title: 'SETTINGS',
    items: [
      {
        to: '/integrations',
        icon: Link2,
        label: 'Integrations',
      },
      {
        to: '/company',
        icon: Settings,
        label: 'Company Profile',
        activePrefixes: ['/company', '/settings/org'],
      },
    ],
  },
  {
    title: 'CONTROL',
    items: [
      {
        to: '/approvals',
        icon: CheckCircle2,
        label: 'Approvals',
      },
      {
        to: '/analytics',
        icon: BarChart3,
        label: 'Analytics',
      },
      {
        to: '/evals',
        icon: FlaskConical,
        label: 'Eval Lab',
      },
      {
        to: '/tools',
        icon: Wrench,
        label: 'Tools',
      },
      {
        to: '/memory',
        icon: Brain,
        label: 'Memory',
      },
      {
        to: '/settings/models',
        icon: Bot,
        label: 'Models',
      },
      {
        to: '/settings/billing',
        icon: CreditCard,
        label: 'Billing',
      },
      {
        to: '/settings/team',
        icon: Users,
        label: 'Team Settings',
      },
    ],
  },
]

function AethonMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 shadow-card">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className={clsx('flex items-center gap-3', collapsed && 'justify-center')}>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-accent-purple via-accent-purple to-accent-cyan shadow-glow-purple">
          <span className="font-mono text-lg font-semibold text-white">A</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-[0.24em] text-content-primary">AETHON</div>
            <div className="mt-1 text-xs text-content-secondary">AI Operating System</div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Sidebar() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const canLoadOrgScopedSidebarData = auth.isAuthenticated && !auth.isLoading && Boolean(auth.activeOrg?.id)
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: approvalsApi.pending,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 30_000,
  })
  const { data: modelConfigs = [] } = useQuery({
    queryKey: ['model-configs', 'sidebar'],
    queryFn: modelsApi.list,
    enabled: canLoadOrgScopedSidebarData,
    refetchInterval: 60_000,
  })

  const hasFailedModels = modelConfigs.some(config => config.test_status === 'failed')

  const signOut = () => {
    auth.logout()
    navigate('/login')
  }

  const isActive = (item: NavItem) => {
    const prefixes = item.activePrefixes || [item.to]
    if (item.to === '/') {
      return location.pathname === '/' || location.pathname === '/dashboard'
    }
    return prefixes.some(prefix => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))
  }

  return (
    <aside
      className={clsx(
        'relative flex shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-base-200/90 backdrop-blur-xl transition-[width] duration-300 ease-out',
        collapsed ? 'w-[84px]' : 'w-[260px]',
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-accent-purple/[0.10] via-accent-cyan/[0.04] to-transparent" />

      <div className="relative z-10 flex h-full flex-col">
        <div className="px-3 pt-4">
          <AethonMark collapsed={collapsed} />
        </div>

        <div className="px-3 pt-3">
          <OrgSwitcher collapsed={collapsed} />
        </div>

        <nav className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-5">
            {NAV_GROUPS.map(group => (
              <div key={group.title} className="space-y-1.5">
                {!collapsed && (
                  <div className="px-2 text-[10px] font-semibold tracking-[0.28em] text-content-muted">
                    {group.title}
                  </div>
                )}
                {group.items.map(item => {
                  const Icon = item.icon
                  const active = isActive(item)
                  const showApprovalCount = item.to === '/approvals' && pendingApprovals.length > 0
                  const showModelAlert = item.to === '/settings/models' && hasFailedModels

                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={clsx(
                        'group relative flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-transparent px-3 text-sm transition-all duration-150',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-accent-purple/[0.10] text-accent-200 shadow-[inset_3px_0_0_#6C63FF]'
                          : 'text-content-secondary hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-content-primary',
                      )}
                    >
                      <div className={clsx('absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent-purple transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
                      <Icon size={18} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}

                      {!collapsed && item.comingSoon && (
                        <span className="ml-auto rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content-muted">
                          Coming soon
                        </span>
                      )}

                      {!collapsed && showModelAlert && (
                        <span className="ml-auto rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          ⚠
                        </span>
                      )}

                      {collapsed && showModelAlert && (
                        <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-amber-400 px-1 py-0.5 text-center text-[10px] font-bold text-base-100">
                          !
                        </span>
                      )}

                      {showApprovalCount && (
                        <span
                          className={clsx(
                            'rounded-full bg-accent-red px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-glow-red',
                            collapsed ? 'absolute right-1.5 top-1.5 min-w-4' : 'ml-auto min-w-5',
                          )}
                        >
                          {pendingApprovals.length}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        </nav>

        <div className="relative shrink-0 border-t border-white/[0.06] p-3">
          <div
            className={clsx(
              'mb-3 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5',
              collapsed && 'justify-center',
            )}
          >
            <AgentAvatar name={auth.email || auth.userId || 'Founder'} size="sm" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-content-primary">{auth.email || auth.userId}</div>
                <div className="mt-1 inline-flex rounded-full bg-accent-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-cyan">
                  {auth.role || 'ceo'}
                </div>
              </div>
            )}
          </div>

          <div className={clsx('flex gap-2', collapsed && 'flex-col')}>
            <button className="btn-ghost h-9 flex-1 px-2 text-xs" onClick={() => setCollapsed(value => !value)}>
              {collapsed ? (
                <ChevronsRight size={14} />
              ) : (
                <>
                  <ChevronsLeft size={14} />
                  Collapse
                </>
              )}
            </button>
            <button
              className={clsx(
                'btn-ghost h-9 px-2 text-xs text-red-200 hover:bg-red-500/10 hover:text-red-100',
                !collapsed && 'flex-1',
              )}
              onClick={signOut}
              title="Sign out"
            >
              <LogOut size={14} />
              {!collapsed && 'Sign out'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

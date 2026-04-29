import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Brain, CheckCircle2, ChevronsLeft, ChevronsRight,
  CreditCard, FlaskConical, GitBranch, LayoutDashboard, Link2, LogOut, MessageCircle, Settings, Sparkles, Store, TerminalSquare, Users, Wrench,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { clsx } from 'clsx'
import { useAuth } from '../../contexts/AuthContext'
import { approvalsApi } from '../../api/client'
import { AgentAvatar } from '../ui/AgentAvatar'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Command' },
  { to: '/company-chat', icon: MessageCircle, label: 'Company Chat' },
  { to: '/marketplace', icon: Store, label: 'Marketplace', badge: 'New' },
  { to: '/agents', icon: Users, label: 'My Team' },
  { to: '/workflows', icon: GitBranch, label: 'Workflows' },
  { to: '/company-os', icon: TerminalSquare, label: 'Company OS' },
  { to: '/approvals', icon: CheckCircle2, label: 'Approvals' },
  { to: '/integrations', icon: Link2, label: 'Integrations' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/tools', icon: Wrench, label: 'Tools' },
  { to: '/monitoring', icon: Activity, label: 'Monitor' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/evals', icon: FlaskConical, label: 'Eval Lab' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
]

export function Sidebar() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: approvalsApi.pending,
    refetchInterval: 30_000,
  })

  const signOut = () => {
    auth.logout()
    navigate('/login')
  }

  return (
    <aside
      className={clsx(
        'relative flex shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-obsidian-925 transition-[width] duration-300 ease-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-accent-500/[0.08] to-transparent" />

      <div className={clsx('relative flex h-16 items-center border-b border-white/[0.06] px-4', collapsed ? 'justify-center' : 'gap-3')}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-cyan-500 shadow-glow-sm">
          <Sparkles size={17} className="text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-white">Obsidian</div>
            <div className="mt-1 inline-flex rounded-full border border-accent-400/20 bg-accent-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-200">
              AI OS
            </div>
          </div>
        )}
      </div>

      <nav className="relative flex-1 space-y-1 px-2 py-4">
        {nav.map(({ to, icon: Icon, label, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                'group relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all duration-150 ease-out',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-accent-500/[0.08] text-accent-200 shadow-[inset_2px_0_0_#6366f1]'
                  : 'text-obsidian-400 hover:bg-white/[0.04] hover:text-obsidian-100',
              )
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{label}</span>}
            {badge && !collapsed && (
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-200">
                {badge}
              </span>
            )}
            {to === '/approvals' && pendingApprovals.length > 0 && (
              <span className={clsx(
                'rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-glow-red',
                collapsed ? 'absolute right-1 top-1 min-w-4' : 'min-w-5',
              )}>
                {pendingApprovals.length}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="relative border-t border-white/[0.06] p-3">
        <div className={clsx('mb-3 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2', collapsed && 'justify-center')}>
          <AgentAvatar name={auth.email || auth.userId || 'Founder'} size="sm" />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-obsidian-100">{auth.email || auth.userId}</div>
                <div className="mt-0.5 inline-flex rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                  {auth.role || 'operator'}
                </div>
              </div>
              <Settings size={15} className="text-obsidian-500" />
            </>
          )}
        </div>
        <div className={clsx('flex gap-2', collapsed && 'flex-col')}>
          <button className="btn-ghost h-9 flex-1 px-2 text-xs" onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <ChevronsRight size={14} /> : <><ChevronsLeft size={14} /> Collapse</>}
          </button>
          {!collapsed && (
            <button className="btn-ghost h-9 px-2 text-xs" onClick={signOut} title="Sign out">
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Bot, GitBranch, Activity, Layers, Zap, Wrench } from 'lucide-react'
import { clsx } from 'clsx'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/workflows', icon: GitBranch, label: 'Workflows' },
  { to: '/tools', icon: Wrench, label: 'Tools' },
  { to: '/monitoring', icon: Activity, label: 'Monitoring' },
  { to: '/templates', icon: Layers, label: 'Templates' },
]

export function Sidebar() {
  return (
    <aside className="w-60 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
          <Zap size={18} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-slate-100 leading-none">NeuroFlow AI</div>
          <div className="text-xs text-slate-500 mt-0.5">Let intelligence flow</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-violet-600/20 text-violet-400 border border-violet-600/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800">
        <div className="text-xs text-slate-600 text-center">v1.0.0 · Yuno AI Challenge</div>
      </div>
    </aside>
  )
}

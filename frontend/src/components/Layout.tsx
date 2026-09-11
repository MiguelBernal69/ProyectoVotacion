import { ReactNode, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutDashboard, Users, CalendarDays, LogOut,
  ShieldCheck, ChevronLeft, Menu, ClipboardList
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: ReactNode; roles: string[] }

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Inicio',    icon: <LayoutDashboard className="w-4 h-4" />, roles: ['SUPERADMIN','ADMIN','PRESIDENT','AUDITOR','PARTICIPANT'] },
  { to: '/sessions',  label: 'Sesiones',  icon: <CalendarDays className="w-4 h-4" />,    roles: ['SUPERADMIN','ADMIN','PRESIDENT','AUDITOR'] },
  { to: '/users',     label: 'Usuarios',  icon: <Users className="w-4 h-4" />,            roles: ['SUPERADMIN','ADMIN'] },
  { to: '/audit',     label: 'Auditoría', icon: <ClipboardList className="w-4 h-4" />,    roles: ['SUPERADMIN','ADMIN','AUDITOR'] },
]

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN:'Super Admin', ADMIN:'Administrador', PRESIDENT:'Presidente',
  AUDITOR:'Auditor', PARTICIPANT:'Participante',
}

const ROLE_DOT: Record<string, string> = {
  SUPERADMIN:'bg-red-400', ADMIN:'bg-orange-400', PRESIDENT:'bg-yellow-400',
  AUDITOR:'bg-blue-400', PARTICIPANT:'bg-emerald-400',
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const visible = NAV_ITEMS.filter(n => user && n.roles.includes(user.role))

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Sidebar */}
      <aside
        className={`relative flex flex-col border-r border-surface-border bg-surface-card
                    transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'}`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-surface-border">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-primary-600/20 border border-primary-500/30
                          flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-primary-400" />
          </div>
          {!collapsed && (
            <span className="text-xs font-semibold text-slate-300 leading-tight">
              Sistema de<br/>Votación
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {visible.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium
                 transition-all duration-150
                 ${isActive
                   ? 'bg-primary-600/20 text-primary-300 border border-primary-500/20'
                   : 'text-slate-500 hover:text-slate-200 hover:bg-surface'}`
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User + Logout */}
        <div className="border-t border-surface-border p-3 space-y-2">
          {!collapsed && user && (
            <div className="px-2 pb-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${ROLE_DOT[user.role] ?? 'bg-slate-400'}`} />
                <span className="text-xs text-slate-400 truncate">{ROLE_LABELS[user.role]}</span>
              </div>
              <p className="text-xs text-slate-300 font-medium truncate mt-0.5">{user.name}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm
                       text-slate-500 hover:text-red-400 hover:bg-red-500/5
                       transition-all duration-150"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>

        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 w-6 h-6 rounded-full bg-surface-card border border-surface-border
                     flex items-center justify-center text-slate-500 hover:text-slate-200
                     transition-colors duration-150 z-10"
        >
          {collapsed
            ? <Menu className="w-3 h-3" />
            : <ChevronLeft className="w-3 h-3" />
          }
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

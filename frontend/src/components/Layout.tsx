import { ReactNode, useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutDashboard, Users, CalendarDays, LogOut,
  ShieldCheck, ChevronLeft, Menu, ClipboardList, X, User
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: ReactNode; roles: string[] }

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Inicio',    icon: <LayoutDashboard className="w-5 h-5 md:w-4 md:h-4" />, roles: ['SUPERADMIN','ADMIN','PRESIDENT','AUDITOR','PARTICIPANT'] },
  { to: '/sessions',  label: 'Sesiones',  icon: <CalendarDays className="w-5 h-5 md:w-4 md:h-4" />,    roles: ['SUPERADMIN','ADMIN','PRESIDENT','AUDITOR'] },
  { to: '/users',     label: 'Usuarios',  icon: <Users className="w-5 h-5 md:w-4 md:h-4" />,            roles: ['SUPERADMIN','ADMIN'] },
  { to: '/audit',     label: 'Auditoría', icon: <ClipboardList className="w-5 h-5 md:w-4 md:h-4" />,    roles: ['SUPERADMIN','ADMIN','AUDITOR'] },
]

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: 'Super Admin', ADMIN: 'Administrador', PRESIDENT: 'Presidente',
  AUDITOR: 'Auditor', PARTICIPANT: 'Participante',
}

const ROLE_DOT: Record<string, string> = {
  SUPERADMIN: 'bg-red-400', ADMIN: 'bg-orange-400', PRESIDENT: 'bg-yellow-400',
  AUDITOR: 'bg-blue-400', PARTICIPANT: 'bg-emerald-400',
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Auto-close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const visible = NAV_ITEMS.filter(n => user && n.roles.includes(user.role))

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-surface">
      {/* ─── Mobile Header Topbar (Visible only on < md) ─── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-surface-card/90 border-b border-surface-border sticky top-0 z-30 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-surface border border-surface-border/60 transition-colors"
            aria-label="Abrir menú principal"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-primary-400" />
            </div>
            <span className="text-sm font-bold text-slate-200 tracking-tight">
              Sistema de Votación
            </span>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-primary-600/20 text-primary-300 border border-primary-500/30">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* ─── Mobile Sidebar Overlay Drawer ─── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-surface-card border-r border-surface-border flex flex-col md:hidden transition-transform duration-300 ease-out shadow-2xl ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-primary-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-200">Sistema de Votación</h2>
              <p className="text-[11px] text-slate-500">Plataforma Institucional</p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Nav Items */}
        <nav className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          {visible.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-300 border border-primary-500/30 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`
              }
            >
              <span className="shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Drawer User Footer */}
        <div className="border-t border-surface-border p-4 space-y-3 bg-surface/40">
          {user && (
            <div className="flex items-center gap-3 px-1">
              <div className="w-9 h-9 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-primary-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-200 truncate">{user.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${ROLE_DOT[user.role] ?? 'bg-slate-400'}`} />
                  <span className="text-[11px] text-slate-400 truncate">{ROLE_LABELS[user.role]}</span>
                </div>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ─── Desktop Sidebar (Hidden on mobile) ─── */}
      <aside
        className={`hidden md:flex relative flex-col border-r border-surface-border bg-surface-card transition-all duration-300 ${
          collapsed ? 'w-16' : 'w-56 lg:w-60'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-surface-border">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-primary-400" />
          </div>
          {!collapsed && (
            <span className="text-xs font-semibold text-slate-300 leading-tight">
              Sistema de<br />Votación
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1.5 px-2">
          {visible.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-300 border border-primary-500/20'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-surface'
                }`
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
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/5 transition-all duration-150"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>

        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 w-6 h-6 rounded-full bg-surface-card border border-surface-border flex items-center justify-center text-slate-500 hover:text-slate-200 transition-colors duration-150 z-10"
        >
          {collapsed ? <Menu className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* ─── Main Content Container ─── */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {children}
      </main>
    </div>
  )
}

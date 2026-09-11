/**
 * DashboardPage.tsx
 * Dashboard inteligente por rol:
 * - PARTICIPANT → Panel de sesiones activas donde puede votar
 * - PRESIDENT   → Panel de gestión de votaciones
 * - ADMIN/SUPERADMIN → Accesos rápidos a gestión
 * - AUDITOR     → Panel de auditoría e integridad
 */
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ShieldCheck, CalendarDays, Users, Activity, Vote, Clock,
  CheckCircle2, BarChart3, ArrowRight,
  User, LogOut, ClipboardList, Loader2
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: 'Super Administrador', ADMIN: 'Administrador',
  PRESIDENT: 'Presidente', AUDITOR: 'Auditor', PARTICIPANT: 'Participante',
}
const ROLE_COLORS: Record<string, string> = {
  SUPERADMIN: 'text-red-400 bg-red-500/10 border-red-500/20',
  ADMIN: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  PRESIDENT: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  AUDITOR: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  PARTICIPANT: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
}

// ─── Participante: sesiones con votaciones abiertas ───────────────────────────
function ParticipantDashboard() {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API}/sessions?status=ACTIVE`, { credentials: 'include' })
        const d   = await res.json()
        setSessions(d.sessions ?? [])
      } finally { setLoading(false) }
    }
    load()
  }, [])

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Sesiones activas</h2>

      {loading && <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>}

      {!loading && sessions.length === 0 && (
        <div className="card-glass p-8 text-center">
          <Clock className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No hay sesiones activas en este momento.</p>
          <p className="text-slate-600 text-xs mt-1">Te notificaremos cuando se inicie una votación.</p>
        </div>
      )}

      {sessions.map((s: any) => (
        <Link key={s.id} to={`/sessions/${s.id}`}
          className="card-glass p-4 flex items-center justify-between hover:border-primary-500/30 transition-all duration-150 block">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Vote className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{s.title}</p>
              <p className="text-xs text-slate-500">{s.polls?.filter((p: any) => p.status === 'OPEN').length ?? 0} votaciones abiertas</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-600" />
        </Link>
      ))}
    </div>
  )
}

// ─── Admin / Superadmin: accesos rápidos ──────────────────────────────────────
function AdminDashboard() {
  const [stats, setStats] = useState({ sessions: 0, users: 0, polls: 0 })

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, uRes] = await Promise.all([
          fetch(`${API}/sessions`, { credentials: 'include' }),
          fetch(`${API}/users`,    { credentials: 'include' }),
        ])
        const sd = await sRes.json(); const ud = await uRes.json()
        setStats({ sessions: sd.pagination?.total ?? 0, users: ud.pagination?.total ?? 0, polls: 0 })
      } catch {}
    }
    load()
  }, [])

  const cards = [
    { to: '/sessions', icon: <CalendarDays className="w-5 h-5 text-primary-400" />, label: 'Sesiones', value: stats.sessions, color: 'bg-primary-600/10 border-primary-500/20' },
    { to: '/users',    icon: <Users className="w-5 h-5 text-orange-400" />,          label: 'Usuarios',  value: stats.users,    color: 'bg-orange-500/10 border-orange-500/20' },
    { to: '/audit',    icon: <ClipboardList className="w-5 h-5 text-violet-400" />,  label: 'Auditoría', value: 'Ver',           color: 'bg-violet-500/10 border-violet-500/20' },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Accesos rápidos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map(c => (
          <Link key={c.to} to={c.to}
            className={`card-glass p-4 flex items-center gap-3 hover:border-slate-600 transition-all duration-150`}>
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${c.color}`}>{c.icon}</div>
            <div>
              <p className="text-lg font-bold text-slate-100">{c.value}</p>
              <p className="text-xs text-slate-500">{c.label}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="card-glass p-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Sesiones recientes</h3>
        <Link to="/sessions" className="flex items-center justify-between text-sm text-slate-400 hover:text-slate-200 transition-colors">
          <span>Ver todas las sesiones</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}

// ─── Presidente ──────────────────────────────────────────────────────────────
function PresidentDashboard() {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API}/sessions`, { credentials: 'include' })
        const d   = await res.json()
        setSessions((d.sessions ?? []).slice(0, 5))
      } finally { setLoading(false) }
    }
    load()
  }, [])

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Sesiones a presidir</h2>

      {loading && <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>}

      {sessions.map((s: any) => {
        const openPolls   = (s.polls ?? []).filter((p: any) => p.status === 'OPEN').length
        const closedPolls = (s.polls ?? []).filter((p: any) => p.status === 'CLOSED').length
        const status = s.status === 'ACTIVE' ? { label: 'Activa', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' }
          : s.status === 'CLOSED' ? { label: 'Cerrada', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' }
          : { label: 'Pendiente', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }

        return (
          <Link key={s.id} to={`/sessions/${s.id}`}
            className="card-glass p-4 space-y-3 hover:border-primary-500/30 transition-all duration-150 block">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-200">{s.title}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${status.color}`}>{status.label}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              {openPolls   > 0 && <span className="flex items-center gap-1 text-emerald-400"><Activity className="w-3 h-3" /> {openPolls} abiertas</span>}
              {closedPolls > 0 && <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {closedPolls} cerradas</span>}
            </div>
          </Link>
        )
      })}

      <Link to="/sessions" className="flex items-center justify-between text-sm text-slate-500 hover:text-slate-300 transition-colors card-glass p-4">
        Ver todas las sesiones <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  )
}

// ─── Auditor ──────────────────────────────────────────────────────────────────
function AuditorDashboard() {
  const cards = [
    { to: '/audit',    icon: <ClipboardList className="w-5 h-5 text-violet-400" />, label: 'Log de Auditoría',    desc: 'Revisar todos los eventos del sistema',   color: 'bg-violet-500/10 border-violet-500/20' },
    { to: '/sessions', icon: <BarChart3 className="w-5 h-5 text-blue-400" />,       label: 'Resultados',          desc: 'Examinar resultados y actas de votaciones', color: 'bg-blue-500/10 border-blue-500/20' },
    { to: '/audit',    icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,  label: 'Verificar Integridad', desc: 'Verificar cadena criptográfica de hashes',  color: 'bg-emerald-500/10 border-emerald-500/20' },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Panel de auditoría</h2>
      <div className="space-y-3">
        {cards.map((c, i) => (
          <Link key={i} to={c.to}
            className="card-glass p-4 flex items-center gap-4 hover:border-slate-600 transition-all duration-150 block">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${c.color}`}>{c.icon}</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-200">{c.label}</p>
              <p className="text-xs text-slate-500">{c.desc}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600" />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Dashboard principal ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => { await logout(); navigate('/login', { replace: true }) }

  if (!user) return null

  const roleColor = ROLE_COLORS[user.role] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/20'
  const roleLabel = ROLE_LABELS[user.role] ?? user.role

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-6">

      {/* Header de usuario */}
      <div className="card-glass p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
            <User className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200">{user.name}</p>
            <p className="text-xs text-slate-500">{user.identifier}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${roleColor}`}>{roleLabel}</span>
          <button onClick={handleLogout} className="p-2 rounded-xl border border-surface-border text-slate-500 hover:text-red-400 hover:border-red-500/30 transition-all" title="Cerrar sesión">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Banner institucional */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900/40 to-primary-800/20 border border-primary-700/30 p-5">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-primary-600/10 rounded-full blur-2xl" />
        </div>
        <div className="relative flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-primary-400 shrink-0" />
          <div>
            <h1 className="text-base font-bold text-slate-100">Sistema de Votación Institucional</h1>
            <p className="text-xs text-slate-400 mt-0.5">Plataforma segura de votación con auditoría criptográfica</p>
          </div>
        </div>
      </div>

      {/* Contenido por rol */}
      {user.role === 'PARTICIPANT'                          && <ParticipantDashboard />}
      {user.role === 'PRESIDENT'                           && <PresidentDashboard />}
      {(user.role === 'ADMIN' || user.role === 'SUPERADMIN') && <AdminDashboard />}
      {user.role === 'AUDITOR'                             && <AuditorDashboard />}
    </div>
  )
}

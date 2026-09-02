import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { LogOut, User, ShieldCheck, Activity } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN:  'Super Administrador',
  ADMIN:       'Administrador',
  PRESIDENT:   'Presidente',
  AUDITOR:     'Auditor',
  PARTICIPANT: 'Participante',
}

const ROLE_COLORS: Record<string, string> = {
  SUPERADMIN:  'text-red-400 bg-red-500/10 border-red-500/20',
  ADMIN:       'text-orange-400 bg-orange-500/10 border-orange-500/20',
  PRESIDENT:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  AUDITOR:     'text-blue-400 bg-blue-500/10 border-blue-500/20',
  PARTICIPANT: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
}

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  if (!user) return null

  const roleColor = ROLE_COLORS[user.role] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/20'
  const roleLabel = ROLE_LABELS[user.role] ?? user.role

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-surface relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-800/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-slide-up space-y-4">
        {/* Cabecera */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-600/20 border border-primary-500/30 mb-4">
            <ShieldCheck className="w-7 h-7 text-primary-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">
            Sistema de Votación Institucional
          </h1>
        </div>

        {/* Card de bienvenida */}
        <div className="card-glass p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                <User className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">{user.name}</p>
                <p className="text-xs text-slate-500">{user.identifier}</p>
              </div>
            </div>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${roleColor}`}>
              {roleLabel}
            </span>
          </div>

          <hr className="border-surface-border" />

          {/* Estado del sistema */}
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Sesión activa — Autenticación verificada</span>
          </div>

          <div className="rounded-xl bg-surface border border-surface-border p-4 text-xs text-slate-500 space-y-1">
            <p><span className="text-slate-400 font-medium">Fase 3</span> — Autenticación implementada correctamente.</p>
            <p>Las interfaces de votación estarán disponibles en fases posteriores.</p>
          </div>

          {/* Botón de cerrar sesión */}
          <button
            id="btn-logout"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                       border border-surface-border text-slate-400 hover:text-red-400 hover:border-red-500/30
                       text-sm font-medium transition-all duration-200 active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  )
}

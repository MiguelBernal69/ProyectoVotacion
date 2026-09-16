import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, CalendarDays, Users, Loader2, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

type SessionStatus = 'PENDING' | 'ACTIVE' | 'CLOSED'

interface Session {
  id: string
  title: string
  description: string | null
  status: SessionStatus
  createdAt: string
  _count: { participants: number; polls: number }
}

const STATUS_STYLE: Record<SessionStatus, string> = {
  PENDING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ACTIVE:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CLOSED:  'bg-slate-500/10 text-slate-400 border-slate-500/20',
}
const STATUS_LABEL: Record<SessionStatus, string> = {
  PENDING: 'Pendiente', ACTIVE: 'Activa', CLOSED: 'Cerrada',
}

function CreateSessionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle]   = useState('')
  const [desc, setDesc]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim().length < 3) { setError('El título debe tener al menos 3 caracteres.'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/sessions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: desc.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al crear sesión.')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="card-glass w-full max-w-md p-6 space-y-5 animate-slide-up">
        <h2 className="text-lg font-semibold text-slate-200">Nueva Sesión Institucional</h2>
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Título *</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Ej: Sesión Ordinaria de Septiembre"
              className="input-field" maxLength={200} required
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Descripción (opcional)</label>
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Descripción de la sesión..."
              rows={3} maxLength={1000}
              className="input-field resize-none"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 btn-secondary">Cancelar</button>
            <button type="submit" disabled={loading}
              className="flex-1 btn-primary flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Creando…' : 'Crear sesión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SessionsPage() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const canManage = user && ['SUPERADMIN', 'ADMIN', 'PRESIDENT'].includes(user.role)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/sessions`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSessions(data.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando sesiones.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreated = () => { setShowModal(false); load() }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <CalendarDays className="w-5 h-5 sm:w-6 sm:h-6 text-primary-400" />
            Sesiones Institucionales
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Gestión de asambleas y reuniones</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button onClick={load} className="btn-icon" title="Recargar">
            <RefreshCw className="w-4 h-4" />
          </button>
          {canManage && (
            <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Nueva sesión
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
        </div>
      )}

      {/* Empty */}
      {!loading && !error && sessions.length === 0 && (
        <div className="card-glass p-12 text-center space-y-3">
          <CalendarDays className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-slate-500 text-sm">No hay sesiones registradas.</p>
          {canManage && (
            <button onClick={() => setShowModal(true)} className="btn-primary mx-auto flex items-center gap-2">
              <Plus className="w-4 h-4" /> Crear primera sesión
            </button>
          )}
        </div>
      )}

      {/* Sessions list */}
      {!loading && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map(s => (
            <Link
              key={s.id}
              to={`/sessions/${s.id}`}
              className="card-glass p-5 flex items-center gap-4 hover:border-primary-500/30 transition-colors duration-200 group"
            >
              <div className="w-10 h-10 rounded-xl bg-primary-600/10 border border-primary-500/20
                              flex items-center justify-center shrink-0">
                <CalendarDays className="w-5 h-5 text-primary-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-slate-200 truncate">{s.title}</h3>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[s.status]}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                {s.description && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{s.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />{s._count.participants} participantes
                  </span>
                  <span>{new Date(s.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {showModal && <CreateSessionModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  )
}

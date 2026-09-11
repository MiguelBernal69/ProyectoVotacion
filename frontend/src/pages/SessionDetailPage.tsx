import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  CalendarDays, Users, ArrowLeft, Edit3, Trash2,
  Loader2, AlertCircle, CheckCircle2, ChevronDown, X, Plus, BarChart3, Settings
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

type SessionStatus = 'PENDING' | 'ACTIVE' | 'CLOSED'
type PollStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELED'
type UserRole = 'SUPERADMIN' | 'ADMIN' | 'PRESIDENT' | 'AUDITOR' | 'PARTICIPANT'
type PollType = 'NOMINAL' | 'SECRET'

interface Participant {
  userId: string; sessionId: string; isPresent: boolean; joinedAt: string
  user: { id: string; identifier: string; name: string; role: UserRole; isActive: boolean }
}

interface PollSummary {
  id: string; title: string; type: PollType; status: PollStatus
}

interface Session {
  id: string; title: string; description: string | null
  status: SessionStatus; createdAt: string
  participants: Participant[]
  polls: PollSummary[]
  _count: { participants: number; polls: number }
}

interface AvailableUser {
  id: string; identifier: string; name: string; role: UserRole; isActive: boolean
}

const STATUS_STYLE: Record<SessionStatus, string> = {
  PENDING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ACTIVE:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CLOSED:  'bg-slate-500/10 text-slate-400 border-slate-500/20',
}
const STATUS_LABEL: Record<SessionStatus, string> = { PENDING: 'Pendiente', ACTIVE: 'Activa', CLOSED: 'Cerrada' }

const POLL_STATUS_STYLE: Record<PollStatus, string> = {
  PENDING:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  OPEN:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CLOSED:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CANCELED:  'bg-red-500/10 text-red-400 border-red-500/20',
}
const POLL_STATUS_LABEL: Record<PollStatus, string> = {
  PENDING: 'Preparada', OPEN: 'En curso', CLOSED: 'Finalizada', CANCELED: 'Cancelada'
}

const NEXT_STATUS: Partial<Record<SessionStatus, SessionStatus>> = { PENDING: 'ACTIVE', ACTIVE: 'CLOSED' }
const NEXT_LABEL: Partial<Record<SessionStatus, string>> = { PENDING: 'Activar sesión', ACTIVE: 'Cerrar sesión' }
const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN:'Super Admin', ADMIN:'Admin', PRESIDENT:'Presidente', AUDITOR:'Auditor', PARTICIPANT:'Participante'
}

function Alert({ type, msg }: { type: 'error' | 'success'; msg: string }) {
  const s = type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
  const Icon = type === 'error' ? AlertCircle : CheckCircle2
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${s}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" /><span>{msg}</span>
    </div>
  )
}

function CreatePollModal({ sessionId, onClose, onCreated }: { sessionId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [type, setType] = useState<PollType>('NOMINAL')
  const [allowChange, setAllowChange] = useState(false)
  const [showLive, setShowLive] = useState(false)
  const [options, setOptions] = useState<string[]>(['A FAVOR', 'EN CONTRA', 'ABSTENCIÓN'])
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|null>(null)

  const handleAddOption = () => setOptions([...options, ''])
  const handleRemoveOption = (index: number) => setOptions(options.filter((_, i) => i !== index))
  const handleOptionChange = (index: number, val: string) => {
    const newOpts = [...options]
    newOpts[index] = val
    setOptions(newOpts)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanOptions = options.map(o => o.trim()).filter(Boolean)
    if (cleanOptions.length < 2) { setError('Debe proveer al menos 2 opciones válidas.'); return }
    if (new Set(cleanOptions.map(o => o.toUpperCase())).size !== cleanOptions.length) {
      setError('Las opciones no pueden estar duplicadas.'); return
    }
    
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/polls`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), question: question.trim(), type, options: cleanOptions, allowVoteChange: allowChange, showResultsLive: showLive }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onCreated()
    } catch (err) { setError(err instanceof Error ? err.message : 'Error creando votación.') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="card-glass w-full max-w-lg p-6 space-y-5 animate-slide-up my-8">
        <h2 className="text-lg font-semibold text-slate-200">Configurar Nueva Votación</h2>
        {error && <Alert type="error" msg={error} />}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Título de la votación *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Ej: Aprobación del Acta Anterior" className="input-field" required minLength={3} />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Pregunta a votar *</label>
            <textarea value={question} onChange={e => setQuestion(e.target.value)}
              placeholder="¿Está de acuerdo con...?" className="input-field resize-none" rows={2} required minLength={3} />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Tipo de votación *</label>
            <select value={type} onChange={e => setType(e.target.value as PollType)} className="input-field">
              <option value="NOMINAL">Pública Nominal (El voto de cada persona es público)</option>
              <option value="SECRET">Secreta (Garantiza anonimato absoluto)</option>
            </select>
          </div>

          <div className="space-y-3 p-4 rounded-xl bg-surface border border-surface-border">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-300">Opciones de respuesta *</label>
              <button type="button" onClick={handleAddOption} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Añadir
              </button>
            </div>
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={opt} onChange={e => handleOptionChange(i, e.target.value)}
                  placeholder={`Opción ${i + 1}`} className="input-field py-2 text-sm" required />
                <button type="button" onClick={() => handleRemoveOption(i)} disabled={options.length <= 2}
                  className="p-2 text-slate-500 hover:text-red-400 disabled:opacity-30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-3 p-4 rounded-xl bg-surface border border-surface-border">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={allowChange} onChange={e => setAllowChange(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-primary-500 focus:ring-primary-500" />
              <span className="text-sm text-slate-300">Permitir a los participantes cambiar su voto antes del cierre.</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={showLive} onChange={e => setShowLive(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-primary-500 focus:ring-primary-500" />
              <span className="text-sm text-slate-300">Mostrar resultados en vivo mientras la votación está abierta.</span>
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
              Guardar Configuración
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SessionDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [session, setSession]   = useState<Session | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'error'|'success'; msg: string } | null>(null)

  // Edit form
  const [editing, setEditing]   = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc]   = useState('')
  const [saving, setSaving]       = useState(false)

  // Add participant / Poll
  const [showAddUser, setShowAddUser] = useState(false)
  const [showAddPoll, setShowAddPoll] = useState(false)
  const [allUsers, setAllUsers]       = useState<AvailableUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [addingUser, setAddingUser]   = useState(false)

  const isManager = user && ['SUPERADMIN', 'ADMIN'].includes(user.role)
  const isPresident = user && ['SUPERADMIN', 'ADMIN', 'PRESIDENT'].includes(user.role)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/sessions/${id}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
      setEditTitle(data.session.title)
      setEditDesc(data.session.description ?? '')
    } catch (err) { setError(err instanceof Error ? err.message : 'Error cargando sesión.') }
    finally { setLoading(false) }
  }, [id])

  const loadUsers = useCallback(async () => {
    const res = await fetch(`${API}/users?active=true`, { credentials: 'include' })
    const data = await res.json()
    setAllUsers(data.users ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (type: 'error' | 'success', msg: string) => { setFeedback({ type, msg }); setTimeout(() => setFeedback(null), 4000) }

  const handleSaveEdit = async () => {
    if (editTitle.trim().length < 3) { flash('error', 'El título debe tener al menos 3 caracteres.'); return }
    setSaving(true)
    try {
      const res = await fetch(`${API}/sessions/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', 'Sesión actualizada.'); setEditing(false); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error guardando.') }
    finally { setSaving(false) }
  }

  const handleChangeStatus = async () => {
    if (!session) return
    const next = NEXT_STATUS[session.status]
    if (!next) return
    const confirm = window.confirm(`¿Confirmas cambiar el estado a "${STATUS_LABEL[next]}"?`)
    if (!confirm) return
    try {
      const res = await fetch(`${API}/sessions/${id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', `Estado cambiado a ${STATUS_LABEL[next]}.`); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error cambiando estado.') }
  }

  const handleAddParticipant = async () => {
    if (!selectedUserId) return
    setAddingUser(true)
    try {
      const res = await fetch(`${API}/sessions/${id}/participants`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', 'Participante agregado.')
      setShowAddUser(false); setSelectedUserId(''); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error agregando participante.') }
    finally { setAddingUser(false) }
  }

  const handleRemoveParticipant = async (userId: string, name: string) => {
    const confirm = window.confirm(`¿Remover a "${name}" de la sesión?`)
    if (!confirm) return
    try {
      const res = await fetch(`${API}/sessions/${id}/participants/${userId}`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', `${name} removido de la sesión.`); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error removiendo participante.') }
  }

  if (loading) return <div className="flex justify-center min-h-screen pt-20"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>
  if (error || !session) return <div className="p-6"><Alert type="error" msg={error ?? 'Sesión no encontrada.'} /></div>

  const participantIds = new Set(session.participants.map(p => p.userId))
  const available = allUsers.filter(u => !participantIds.has(u.id))
  const nextStatus = NEXT_STATUS[session.status]

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <button onClick={() => navigate('/sessions')} className="btn-icon flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft className="w-4 h-4" /> Volver a sesiones
      </button>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}

      {/* Session Header Card */}
      <div className="card-glass p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-600/10 border border-primary-500/20 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              {editing
                ? <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="input-field text-base font-semibold" maxLength={200} />
                : <h1 className="text-lg font-bold text-slate-100">{session.title}</h1>
              }
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mt-1 ${STATUS_STYLE[session.status]}`}>
                {STATUS_LABEL[session.status]}
              </span>
            </div>
          </div>

          {isPresident && (
            <div className="flex items-center gap-2 flex-wrap">
              {session.status === 'PENDING' && !editing && (
                <button onClick={() => setEditing(true)} className="btn-secondary flex items-center gap-2"><Edit3 className="w-4 h-4" /> Editar</button>
              )}
              {editing && (
                <>
                  <button onClick={() => setEditing(false)} className="btn-secondary flex items-center gap-2"><X className="w-4 h-4" /> Cancelar</button>
                  <button onClick={handleSaveEdit} disabled={saving} className="btn-primary flex items-center gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Guardar
                  </button>
                </>
              )}
              {nextStatus && !editing && (
                <button onClick={handleChangeStatus}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
                    ${nextStatus === 'ACTIVE' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                              : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'}`}
                >
                  <ChevronDown className="w-4 h-4" /> {NEXT_LABEL[session.status]}
                </button>
              )}
            </div>
          )}
        </div>
        {editing
          ? <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} className="input-field resize-none w-full" rows={3} placeholder="Descripción..." />
          : session.description && <p className="text-sm text-slate-400">{session.description}</p>
        }
      </div>

      {/* Grid: Polls & Participants */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Votaciones de la Sesión */}
        <div className="card-glass p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary-400" /> Puntos a Votar
            </h2>
            {isPresident && session.status !== 'CLOSED' && (
              <button onClick={() => setShowAddPoll(true)} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 font-medium">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            )}
          </div>
          
          {session.polls.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-500">No se han configurado votaciones.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {session.polls.map(poll => (
                <Link key={poll.id} to={`/polls/${poll.id}`}
                  className="block p-4 rounded-xl bg-surface border border-surface-border hover:border-primary-500/30 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-200 leading-snug">{poll.title}</h3>
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${POLL_STATUS_STYLE[poll.status]}`}>
                      {POLL_STATUS_LABEL[poll.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500 font-medium">
                    <span className="bg-slate-800 px-2 py-0.5 rounded-md">{poll.type === 'NOMINAL' ? 'NOMINAL' : 'SECRETA'}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Participantes */}
        <div className="card-glass p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary-400" /> Quórum / Participantes
            </h2>
            {isManager && session.status !== 'CLOSED' && (
              <button onClick={() => { setShowAddUser(true); loadUsers() }} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 font-medium">
                <Plus className="w-3 h-3" /> Agregar
              </button>
            )}
          </div>

          {showAddUser && (
            <div className="p-3 rounded-xl bg-surface border border-surface-border space-y-2 mb-3">
              <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="input-field py-1.5 text-xs">
                <option value="">Seleccionar usuario...</option>
                {available.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => { setShowAddUser(false); setSelectedUserId('') }} className="btn-secondary text-xs py-1.5 flex-1">Cancelar</button>
                <button onClick={handleAddParticipant} disabled={!selectedUserId || addingUser} className="btn-primary text-xs py-1.5 flex-1">Agregar</button>
              </div>
            </div>
          )}

          {session.participants.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-500">Sin participantes registrados.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {session.participants.map(p => (
                <div key={p.userId} className={`flex items-center justify-between p-2.5 rounded-lg border ${p.user.isActive ? 'bg-surface border-surface-border' : 'bg-surface/50 border-red-500/10 opacity-75'}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{p.user.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono truncate">{ROLE_LABELS[p.user.role]} — {p.user.isActive ? 'Habilitado' : 'Inactivo'}</p>
                  </div>
                  {isManager && session.status === 'PENDING' && (
                    <button onClick={() => handleRemoveParticipant(p.userId, p.user.name)} className="text-slate-600 hover:text-red-400 p-1" title="Remover">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddPoll && (
        <CreatePollModal sessionId={id!} onClose={() => setShowAddPoll(false)} onCreated={() => { setShowAddPoll(false); load() }} />
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart3, ArrowLeft, Edit3, Loader2, AlertCircle, CheckCircle2, ChevronDown, X,
  Users, CheckSquare, ShieldQuestion, Trash2, Plus, FileText, Vote
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

type PollStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELED'
type PollType = 'NOMINAL' | 'SECRET'

interface PollOption { id: string; text: string }

interface Poll {
  id: string; sessionId: string; title: string; question: string; type: PollType
  status: PollStatus; allowVoteChange: boolean; showResultsLive: boolean; createdAt: string
  options: PollOption[]
  session: { id: string; title: string; status: string }
}

const STATUS_STYLE: Record<PollStatus, string> = {
  PENDING:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  OPEN:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CLOSED:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CANCELED:  'bg-red-500/10 text-red-400 border-red-500/20',
}
const STATUS_LABEL: Record<PollStatus, string> = { PENDING: 'Preparada', OPEN: 'En curso', CLOSED: 'Finalizada', CANCELED: 'Cancelada' }
const NEXT_STATUS: Partial<Record<PollStatus, PollStatus>> = { PENDING: 'OPEN', OPEN: 'CLOSED' }
const NEXT_LABEL: Partial<Record<PollStatus, string>> = { PENDING: 'Abrir votación', OPEN: 'Finalizar votación' }

function Alert({ type, msg }: { type: 'error' | 'success'; msg: string }) {
  const s = type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
  const Icon = type === 'error' ? AlertCircle : CheckCircle2
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${s}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" /><span>{msg}</span>
    </div>
  )
}

export default function PollPreviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [poll, setPoll] = useState<Poll | null>(null)
  const [eligibleCount, setEligibleCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'error'|'success'; msg: string } | null>(null)

  // Edit State
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editQuestion, setEditQuestion] = useState('')
  const [editType, setEditType] = useState<PollType>('NOMINAL')
  const [editAllowChange, setEditAllowChange] = useState(false)
  const [editShowLive, setEditShowLive] = useState(false)
  const [editOptions, setEditOptions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const isPresident = user && ['SUPERADMIN', 'ADMIN', 'PRESIDENT'].includes(user.role)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/polls/${id}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPoll(data.poll)
      setEligibleCount(data.eligibleCount)
      setEditTitle(data.poll.title)
      setEditQuestion(data.poll.question)
      setEditType(data.poll.type)
      setEditAllowChange(data.poll.allowVoteChange)
      setEditShowLive(data.poll.showResultsLive)
      setEditOptions(data.poll.options.map((o: PollOption) => o.text))
    } catch (err) { setError(err instanceof Error ? err.message : 'Error cargando votación.') }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const flash = (type: 'error' | 'success', msg: string) => { setFeedback({ type, msg }); setTimeout(() => setFeedback(null), 4000) }

  const handleSaveEdit = async () => {
    const cleanOptions = editOptions.map(o => o.trim()).filter(Boolean)
    if (editTitle.trim().length < 3) { flash('error', 'El título debe tener al menos 3 caracteres.'); return }
    if (editQuestion.trim().length < 3) { flash('error', 'La pregunta debe tener al menos 3 caracteres.'); return }
    if (cleanOptions.length < 2) { flash('error', 'Debe haber al menos 2 opciones.'); return }
    if (new Set(cleanOptions.map(o => o.toUpperCase())).size !== cleanOptions.length) {
      flash('error', 'Las opciones no pueden estar duplicadas.'); return
    }

    setSaving(true)
    try {
      const res = await fetch(`${API}/polls/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(), question: editQuestion.trim(), type: editType,
          allowVoteChange: editAllowChange, showResultsLive: editShowLive, options: cleanOptions
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', 'Votación actualizada.'); setEditing(false); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error guardando.') }
    finally { setSaving(false) }
  }

  const handleChangeStatus = async () => {
    if (!poll) return
    const next = NEXT_STATUS[poll.status]
    if (!next) return
    if (next === 'OPEN' && poll.session.status !== 'ACTIVE') {
      flash('error', 'No se puede abrir la votación porque la sesión no está activa.'); return
    }
    const confirm = window.confirm(`¿Confirmas cambiar el estado a "${NEXT_LABEL[poll.status]}"?`)
    if (!confirm) return
    try {
      const res = await fetch(`${API}/polls/${id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', `Votación ${next === 'OPEN' ? 'abierta' : 'cerrada'}.`); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error cambiando estado.') }
  }

  const handleCancelPoll = async () => {
    if (!window.confirm('¿Estás seguro de cancelar esta votación? Esta acción es irreversible.')) return
    try {
      const res = await fetch(`${API}/polls/${id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELED' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', 'Votación cancelada.'); load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error cancelando.') }
  }

  if (loading) return <div className="flex justify-center min-h-screen pt-20"><Loader2 className="w-6 h-6 animate-spin text-primary-400" /></div>
  if (error || !poll) return <div className="p-6"><Alert type="error" msg={error ?? 'Votación no encontrada.'} /></div>

  const nextStatus = NEXT_STATUS[poll.status]

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <button onClick={() => navigate(`/sessions/${poll.sessionId}`)} className="btn-icon flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft className="w-4 h-4" /> Volver a Sesión
      </button>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}

      {poll.status === 'PENDING' && poll.session.status !== 'ACTIVE' && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Para abrir esta votación, la sesión debe estar "Activa".
        </div>
      )}

      {/* Header & Configuration Card */}
      <div className="card-glass p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-600/10 border border-primary-500/20 flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              {editing
                ? <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="input-field text-base font-semibold py-1.5" maxLength={200} />
                : <h1 className="text-lg font-bold text-slate-100">{poll.title}</h1>
              }
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[poll.status]}`}>
                  {STATUS_LABEL[poll.status]}
                </span>
                <span className="text-xs text-slate-500 font-medium bg-slate-800 px-2 py-0.5 rounded-full">
                  {poll.type === 'NOMINAL' ? 'Voto Nominal' : 'Voto Secreto'}
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          {isPresident && (
            <div className="flex items-center gap-2 flex-wrap">
              {poll.status === 'PENDING' && !editing && (
                <button onClick={() => setEditing(true)} className="btn-secondary flex items-center gap-2"><Edit3 className="w-4 h-4" /> Editar config.</button>
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
                <button onClick={handleChangeStatus} disabled={nextStatus === 'OPEN' && poll.session.status !== 'ACTIVE'}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all disabled:opacity-50
                    ${nextStatus === 'OPEN' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                            : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'}`}
                >
                  <ChevronDown className="w-4 h-4" /> {NEXT_LABEL[poll.status]}
                </button>
              )}
              {['PENDING', 'OPEN'].includes(poll.status) && !editing && (
                <button onClick={handleCancelPoll} className="btn-secondary text-red-400 hover:text-red-300 hover:border-red-500/30 px-3" title="Cancelar Votación">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-surface-border">
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Participantes</p>
            <p className="text-sm text-slate-300 font-medium flex items-center gap-1.5"><Users className="w-4 h-4 text-slate-400"/> {eligibleCount} habilitados</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Tipo</p>
            <p className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
              <ShieldQuestion className={`w-4 h-4 ${poll.type === 'SECRET' ? 'text-amber-400' : 'text-slate-400'}`}/>
              {poll.type === 'SECRET' ? 'Secreta' : 'Pública'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Modificar Voto</p>
            <p className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-slate-400"/>
              {poll.allowVoteChange ? 'Permitido' : 'No permitido'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Resultados en vivo</p>
            <p className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-slate-400"/>
              {poll.showResultsLive ? 'Visibles' : 'Ocultos al final'}
            </p>
          </div>
        </div>

        {/* Configuration Edit Mode (if active) */}
        {editing && (
          <div className="pt-4 border-t border-surface-border space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-400">Tipo de votación</label>
                <select value={editType} onChange={e => setEditType(e.target.value as PollType)} className="input-field py-2">
                  <option value="NOMINAL">Pública Nominal</option>
                  <option value="SECRET">Secreta</option>
                </select>
              </div>
              <div className="space-y-3 pt-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={editAllowChange} onChange={e => setEditAllowChange(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-primary-500" />
                  <span className="text-sm text-slate-300">Permitir modificar voto</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={editShowLive} onChange={e => setEditShowLive(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-primary-500" />
                  <span className="text-sm text-slate-300">Mostrar resultados en vivo</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview Section */}
      <div className="card-glass p-6 sm:p-10 space-y-8 bg-surface-card/50 relative overflow-hidden">
        {/* Decorative background for preview */}
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none text-9xl font-bold select-none">
          PREVIEW
        </div>

        <div className="relative z-10 text-center space-y-4 max-w-2xl mx-auto">
          {editing ? (
            <textarea value={editQuestion} onChange={e => setEditQuestion(e.target.value)} className="input-field text-center text-xl font-medium resize-none" rows={2} placeholder="Escribe la pregunta..." />
          ) : (
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-100 tracking-tight leading-tight">
              {poll.question}
            </h2>
          )}
          <p className="text-sm text-slate-500">
            {poll.type === 'SECRET' ? 'Esta votación es secreta. Su identidad no será revelada.' : 'Su voto será registrado y visible junto a su nombre.'}
          </p>
        </div>

        <div className="relative z-10 max-w-md mx-auto space-y-3">
          {editing ? (
            <div className="space-y-2">
              {editOptions.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input value={opt} onChange={e => { const no = [...editOptions]; no[i] = e.target.value; setEditOptions(no) }} className="input-field py-2 flex-1 text-center" />
                  <button onClick={() => setEditOptions(editOptions.filter((_, idx) => idx !== i))} disabled={editOptions.length <= 2} className="btn-secondary px-3 text-red-400"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
              <button onClick={() => setEditOptions([...editOptions, ''])} className="btn-secondary w-full flex items-center justify-center gap-2 py-2"><Plus className="w-4 h-4"/> Añadir opción</button>
            </div>
          ) : (
            poll.options.map(o => (
              <label key={o.id} className="flex items-center gap-4 p-4 rounded-xl border border-surface-border bg-surface hover:bg-surface/80 hover:border-primary-500/30 transition-colors cursor-not-allowed opacity-80">
                <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center shrink-0"></div>
                <span className="font-medium text-slate-200">{o.text}</span>
              </label>
            ))
          )}
        </div>
        
        {!editing && (
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            {/* Botón Votar — solo cuando OPEN y el usuario es PARTICIPANT */}
            {poll.status === 'OPEN' && user?.role === 'PARTICIPANT' && (
              <button
                onClick={() => navigate(`/vote/${poll.id}`)}
                className="btn-primary px-8 py-3 text-base flex items-center gap-2"
              >
                <Vote className="w-5 h-5" /> Emitir mi voto
              </button>
            )}

            {/* Botón Ver Acta — cuando CLOSED */}
            {poll.status === 'CLOSED' && isPresident && (
              <button
                onClick={() => navigate(`/polls/${poll.id}/results`)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-all"
              >
                <FileText className="w-4 h-4" /> Ver Acta Oficial
              </button>
            )}

            {/* Placeholder cuando PENDING */}
            {poll.status === 'PENDING' && (
              <span className="text-slate-600 text-sm italic">La votación aún no ha sido abierta</span>
            )}
            {poll.status === 'CANCELED' && (
              <span className="text-red-400/60 text-sm italic">Votación cancelada</span>
            )}
          </div>
        )}
      </div>

    </div>
  )
}

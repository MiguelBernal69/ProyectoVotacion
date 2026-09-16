import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { io, Socket } from 'socket.io-client'
import {
  BarChart3, ArrowLeft, Edit3, Loader2, AlertCircle, CheckCircle2, ChevronDown, X,
  Users, CheckSquare, ShieldQuestion, FileText, Vote, Maximize2, Minimize2, Radio
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

interface VoteResultItem { optionId: string; text?: string; count: number }

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
  const [votedCount, setVotedCount] = useState(0)
  const [counts, setCounts] = useState<VoteResultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'error'|'success'; msg: string } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

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
      setEligibleCount(data.eligibleCount ?? 0)
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

  // ─── WebSockets para actualización en tiempo real ───────────────────────────
  useEffect(() => {
    if (!id) return

    const socket: Socket = io('/voting', {
      path: '/socket.io',
      withCredentials: true,
    })

    socket.on('connect', () => {
      socket.emit('subscribe:poll', id)
    })

    socket.on('poll:sync', (data: any) => {
      if (data.totalEligible !== undefined) setEligibleCount(data.totalEligible)
      if (data.votedCount !== undefined) setVotedCount(data.votedCount)
      if (data.results) setCounts(data.results)
    })

    socket.on('poll:vote_count', (data: { pollId: string; votedCount: number; totalEligible: number }) => {
      if (data.pollId === id) {
        setVotedCount(data.votedCount)
        setEligibleCount(data.totalEligible)
      }
    })

    socket.on('poll:results', (data: { pollId: string; results: VoteResultItem[] }) => {
      if (data.pollId === id) {
        setCounts(data.results)
      }
    })

    socket.on('poll:closed', (data: { pollId: string }) => {
      if (data.pollId === id) {
        setPoll(p => p ? { ...p, status: 'CLOSED' } : p)
      }
    })

    return () => { socket.disconnect() }
  }, [id])

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
  const totalFromResults = counts.reduce((acc, c) => acc + (c.count || 0), 0)
  const totalVotesCast = Math.max(votedCount, totalFromResults)
  const participationPct = eligibleCount > 0 ? Math.round((totalVotesCast / eligibleCount) * 100) : 0

  return (
    <div className={`p-4 sm:p-6 space-y-6 max-w-5xl mx-auto ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-950 p-8 overflow-y-auto max-w-none' : ''}`}>
      {/* Botón de volver y modo proyección */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(`/sessions/${poll.sessionId}`)} className="btn-icon flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200">
          <ArrowLeft className="w-4 h-4" /> Volver a Sesión
        </button>

        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="btn-secondary flex items-center gap-2 text-xs font-semibold px-3 py-1.5"
          title="Modo Proyección (Pantalla Completa)"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4 text-primary-400" /> : <Maximize2 className="w-4 h-4 text-primary-400" />}
          {isFullscreen ? 'Salir de Proyección' : 'Modo Proyección'}
        </button>
      </div>

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
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[poll.status]}`}>
                  {STATUS_LABEL[poll.status]}
                </span>
                <span className="text-xs text-slate-400 font-medium bg-slate-800 px-2.5 py-0.5 rounded-full">
                  {poll.type === 'NOMINAL' ? 'Voto Nominal (Público)' : 'Voto Secreto'}
                </span>
              </div>
            </div>
          </div>

          {/* President Controls */}
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
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border shadow-lg transition-all disabled:opacity-50
                    ${nextStatus === 'OPEN' ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-emerald-900/30'
                                            : 'bg-red-600 hover:bg-red-500 border-red-400 text-white shadow-red-900/30'}`}
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
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Habilitados</p>
            <p className="text-sm text-slate-300 font-medium flex items-center gap-1.5"><Users className="w-4 h-4 text-slate-400"/> {eligibleCount} congresistas</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Tipo de Voto</p>
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
            <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Modo en Vivo</p>
            <p className="text-sm text-emerald-400 font-semibold flex items-center gap-1.5">
              <Radio className="w-4 h-4 animate-pulse text-emerald-400"/>
              WebSockets Activo
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
                  <span className="text-sm text-slate-300">Mostrar resultados en vivo a participantes</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── PANEL DE TRANSMISIÓN / PROYECCIÓN EN TIEMPO REAL ────────────────── */}
      <div className="card-glass p-6 sm:p-10 space-y-8 bg-gradient-to-b from-slate-900/90 to-surface-card border-primary-500/30 relative overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-border pb-4">
          <div>
            <span className="text-xs font-bold text-primary-400 uppercase tracking-widest">Tablero de Proyección Oficial</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight leading-tight mt-1">
              {poll.question}
            </h2>
          </div>

          <div className="shrink-0 text-right">
            {poll.status === 'OPEN' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                VOTACIÓN EN CURSO
              </span>
            )}
            {poll.status === 'CLOSED' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40">
                <CheckCircle2 className="w-4 h-4" /> VOTACIÓN FINALIZADA
              </span>
            )}
            {poll.status === 'PENDING' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <Radio className="w-4 h-4" /> PREPARADA
              </span>
            )}
          </div>
        </div>

        {/* Barra de participación general */}
        <div className="card-glass p-5 space-y-2 bg-surface/70 border-surface-border">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span className="text-slate-300 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary-400" />
              Quórum y Participación
            </span>
            <span className="text-slate-100 font-mono text-base">
              {votedCount} / {eligibleCount} Votos ({participationPct}%)
            </span>
          </div>
          <div className="h-3 bg-surface rounded-full overflow-hidden border border-surface-border p-0.5">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-emerald-400 rounded-full transition-all duration-700"
              style={{ width: `${participationPct}%` }}
            />
          </div>
        </div>

        {/* Desglose de conteo por opción en tiempo real */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Conteo de votos por opción</h3>

          {poll.options.map((opt) => {
            const countObj = counts.find(c => c.optionId === opt.id)
            const c = countObj?.count ?? 0
            const pct = totalVotesCast > 0 ? Math.round((c / totalVotesCast) * 100) : 0

            return (
              <div key={opt.id} className="p-4 rounded-2xl bg-surface/80 border border-surface-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-slate-100">{opt.text}</span>
                  <div className="text-right">
                    <span className="text-xl font-extrabold text-primary-300 font-mono">{c}</span>
                    <span className="text-xs text-slate-400 ml-1.5 font-medium">({pct}%)</span>
                  </div>
                </div>

                <div className="h-4 bg-slate-900/80 rounded-full overflow-hidden border border-surface-border p-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-700 shadow-md"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Acciones principales del Presidente */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 border-t border-surface-border">
          {poll.status === 'OPEN' && user?.role === 'PARTICIPANT' && (
            <button
              onClick={() => navigate(`/vote/${poll.id}`)}
              className="btn-primary px-8 py-3 text-base font-bold flex items-center gap-2"
            >
              <Vote className="w-5 h-5" /> Emitir mi voto
            </button>
          )}

          {poll.status === 'CLOSED' && isPresident && (
            <button
              onClick={() => navigate(`/polls/${poll.id}/results`)}
              className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-base font-bold transition-all shadow-xl shadow-violet-900/30"
            >
              <FileText className="w-5 h-5" /> Ver e Imprimir Acta Oficial
            </button>
          )}
        </div>
      </div>

    </div>
  )
}

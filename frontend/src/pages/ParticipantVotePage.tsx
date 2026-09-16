/**
 * ParticipantVotePage.tsx
 * Vista completa de votación para participantes y congresistas.
 *
 * Maneja los estados:
 *  - WAIT    → La votación aún no está abierta (espera activa via socket)
 *  - VOTE    → Emitir voto (nominal o secreto)
 *  - CONFIRM → Confirmar antes de enviar
 *  - DONE    → Voto registrado exitosamente (Muestra resultados en tiempo real vía Sockets)
 *  - CLOSED  → Votación cerrada
 *  - ERROR   → Error de acceso
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { io, Socket } from 'socket.io-client'
import {
  CheckCircle2, Clock, XCircle, ChevronRight, Loader2,
  ShieldCheck, AlertCircle, RefreshCw, ArrowLeft, Lock, Edit3, BarChart3
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

type PollType   = 'NOMINAL' | 'SECRET'
type PollStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELED'
type ViewState  = 'LOADING' | 'WAIT' | 'VOTE' | 'CONFIRM' | 'DONE' | 'CLOSED' | 'CANCELED' | 'ERROR'

interface PollOption { id: string; text: string }

interface Poll {
  id: string; title: string; question: string
  type: PollType; status: PollStatus
  allowVoteChange: boolean; showResultsLive: boolean
  options: PollOption[]
  session: { title: string }
  openedAt?: string; closedAt?: string
}

interface VoteResultItem { optionId: string; text?: string; count: number }

export default function ParticipantVotePage() {
  const { pollId } = useParams<{ pollId: string }>()
  const navigate   = useNavigate()
  const { user: _user } = useAuth()

  const [view, setView]                 = useState<ViewState>('LOADING')
  const [poll, setPoll]                 = useState<Poll | null>(null)
  const [selected, setSelected]         = useState<string | null>(null)
  const [_hasVoted, setHasVoted]        = useState(false)
  const [voteToken, setVoteToken]       = useState<string | null>(null)
  const [counts, setCounts]             = useState<VoteResultItem[]>([])
  const [error, setError]               = useState<string | null>(null)
  const [submitting, setSubmitting]     = useState(false)
  const [votedCount, setVotedCount]     = useState(0)
  const [totalVoters, setTotalVoters]   = useState(0)

  const socketRef = useRef<Socket | null>(null)

  // ─── Cargar datos de la votación y el voto del usuario ─────────────────────
  const loadPoll = useCallback(async () => {
    try {
      const res = await fetch(`${API}/polls/${pollId}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'No tienes acceso a esta votación.'); setView('ERROR'); return }

      const p: Poll = data.poll
      setPoll(p)
      setTotalVoters(data.eligibleCount ?? 0)

      if (p.type === 'SECRET') {
        const key = `voteToken_${p.id}`
        let token = localStorage.getItem(key)
        if (!token) {
          token = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `token-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
          localStorage.setItem(key, token)
        }
        setVoteToken(token)
      }

      // Cargar el voto actual del usuario y resultados
      const voteRes = await fetch(`${API}/polls/${pollId}/my-vote`, { credentials: 'include' })
      if (voteRes.ok) {
        const vd = await voteRes.json()
        setHasVoted(!!vd.voted)
        if (vd.selectedOptionId) setSelected(vd.selectedOptionId)
        if (vd.results) setCounts(vd.results)
        if (vd.votedCount !== undefined) setVotedCount(vd.votedCount)
        if (vd.totalEligible !== undefined) setTotalVoters(vd.totalEligible)

        if (vd.voted) {
          setView('DONE')
          return
        }
      }

      if (p.status === 'CLOSED')   { setView('CLOSED');   return }
      if (p.status === 'CANCELED') { setView('CANCELED'); return }
      if (p.status === 'PENDING')  { setView('WAIT');     return }

      setView('VOTE')
    } catch {
      setError('Error de conexión. Verifica tu red.')
      setView('ERROR')
    }
  }, [pollId])

  // ─── Socket.IO en tiempo real ─────────────────────────────────────────────
  useEffect(() => {
    const socket = io('/voting', {
      path: '/socket.io',
      withCredentials: true,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('subscribe:poll', pollId)
    })

    socket.on('poll:sync', (data: any) => {
      if (data.totalEligible !== undefined) setTotalVoters(data.totalEligible)
      if (data.votedCount !== undefined) setVotedCount(data.votedCount)
      if (data.results) setCounts(data.results)
    })

    socket.on('poll:opened', (data: { pollId: string }) => {
      if (data.pollId === pollId) {
        loadPoll()
      }
    })

    socket.on('poll:closed', (data: { pollId: string }) => {
      if (data.pollId === pollId) {
        setPoll(p => p ? { ...p, status: 'CLOSED' } : p)
      }
    })

    socket.on('poll:vote_count', (data: { pollId: string; votedCount: number; totalEligible: number }) => {
      if (data.pollId === pollId) {
        setVotedCount(data.votedCount)
        setTotalVoters(data.totalEligible)
      }
    })

    socket.on('poll:results', (data: { pollId: string; results: VoteResultItem[] }) => {
      if (data.pollId === pollId) {
        setCounts(data.results)
      }
    })

    return () => { socket.disconnect() }
  }, [pollId, loadPoll])

  useEffect(() => { loadPoll() }, [loadPoll])

  // ─── Emitir voto ──────────────────────────────────────────────────────────
  const submitVote = async () => {
    if (!selected || !poll) return
    setSubmitting(true)
    setError(null)
    try {
      const body: any = { optionId: selected }
      if (poll.type === 'SECRET') {
        let tokenToSend = voteToken
        if (!tokenToSend) {
          const key = `voteToken_${poll.id}`
          tokenToSend = localStorage.getItem(key)
          if (!tokenToSend) {
            tokenToSend = typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `token-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
            localStorage.setItem(key, tokenToSend)
          }
          setVoteToken(tokenToSend)
        }
        body.voteToken = tokenToSend
      }

      const res = await fetch(`${API}/polls/${poll.id}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Error al registrar el voto.'); return }

      setHasVoted(true)
      setView('DONE')
    } catch {
      setError('Error de red al emitir el voto.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedOption = poll?.options.find(o => o.id === selected)

  // ─── UI Helpers ──────────────────────────────────────────────────────────
  if (view === 'LOADING') return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
    </div>
  )

  const Header = () => (
    <div className="flex items-center gap-3 mb-6">
      <button onClick={() => navigate(-1)} className="p-2 rounded-xl border border-surface-border text-slate-500 hover:text-slate-200 transition-all">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div>
        <p className="text-xs text-slate-500">{poll?.session.title}</p>
        <h1 className="text-sm font-semibold text-slate-200">{poll?.title}</h1>
      </div>
    </div>
  )

  // Estado: WAIT (Votación no iniciada)
  if (view === 'WAIT') return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm animate-slide-up space-y-6 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber-500/10 border-2 border-amber-500/20 flex items-center justify-center">
          <Clock className="w-10 h-10 text-amber-400 animate-pulse" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">Votación no iniciada</h2>
          <p className="text-slate-500 text-sm">Estás habilitado para votar. En cuanto el presidente abra la votación, podrás emitir tu voto.</p>
        </div>
        <div className="card-glass p-4 text-left space-y-1">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Votación</p>
          <p className="text-slate-200 font-medium">{poll?.title}</p>
          <p className="text-slate-400 text-sm">{poll?.question}</p>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
          Conectado — esperando apertura en tiempo real
        </div>
      </div>
    </div>
  )

  // Estado: VOTE
  if (view === 'VOTE') return (
    <div className="min-h-screen bg-surface p-4 sm:p-6">
      <div className="max-w-lg mx-auto animate-slide-up space-y-4">
        <Header />

        {/* Participación en tiempo real si totalVoters > 0 */}
        {totalVoters > 0 && (
          <div className="card-glass p-3">
            <div className="flex justify-between text-xs text-slate-400 mb-1.5 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Votos emitidos
              </span>
              <span>{votedCount} de {totalVoters} congresistas ({Math.round((votedCount / totalVoters) * 100)}%)</span>
            </div>
            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.round((votedCount / totalVoters) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Pregunta y opciones */}
        <div className="card-glass p-5 space-y-4">
          <div className="flex items-start gap-2">
            {poll?.type === 'SECRET'
              ? <Lock className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
              : <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />}
            <div>
              <span className="text-xs font-medium text-slate-500">{poll?.type === 'SECRET' ? 'Votación secreta' : 'Votación nominal'}</span>
              <h2 className="text-base font-semibold text-slate-100 mt-0.5">{poll?.question}</h2>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            {poll?.options.map(opt => (
              <button
                key={opt.id}
                onClick={() => { setSelected(opt.id); setError(null) }}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border text-left transition-all duration-150 text-sm font-medium
                  ${selected === opt.id
                    ? 'bg-primary-600/15 border-primary-500/40 text-primary-300'
                    : 'bg-surface border-surface-border text-slate-400 hover:text-slate-200 hover:border-slate-600'}`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-all
                  ${selected === opt.id ? 'border-primary-400 bg-primary-400' : 'border-slate-600'}`} />
                {opt.text}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => { if (selected) setView('CONFIRM') }}
          disabled={!selected || submitting}
          className="w-full btn-primary py-3 text-base font-semibold flex items-center justify-center gap-2"
        >
          Continuar
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )

  // Estado: CONFIRM
  if (view === 'CONFIRM') return (
    <div className="min-h-screen bg-surface p-4 sm:p-6">
      <div className="max-w-lg mx-auto animate-slide-up space-y-4">
        <Header />
        <div className="card-glass p-6 space-y-5 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-primary-600/15 border border-primary-500/20 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-primary-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 mb-1">Confirmar voto</h2>
            <p className="text-slate-500 text-sm">
              {poll?.allowVoteChange
                ? 'Podrás modificar tu voto mientras la votación permanezca abierta.'
                : 'Una vez enviado, tu voto no se podrá modificar.'}
            </p>
          </div>

          <div className="rounded-xl bg-surface border border-surface-border p-4">
            <p className="text-xs text-slate-500 mb-1">Opción seleccionada</p>
            <p className="text-xl font-bold text-slate-100">{selectedOption?.text}</p>
          </div>

          {poll?.type === 'SECRET' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/8 border border-violet-500/20 text-violet-300 text-xs text-left">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Votación secreta: tu identidad no quedará vinculada a tu opción seleccionada.</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { setView('VOTE'); setError(null) }}
            disabled={submitting}
            className="btn-secondary py-3 text-sm font-medium"
          >
            Cambiar opción
          </button>
          <button
            onClick={submitVote}
            disabled={submitting}
            className="btn-primary py-3 text-sm font-semibold flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {submitting ? 'Emitiendo…' : 'Emitir voto'}
          </button>
        </div>
      </div>
    </div>
  )

  // Estado: DONE (voto registrado - Muestra resultados en vivo via Sockets)
  if (view === 'DONE') {
    const totalVotesInResults = counts.reduce((acc, c) => acc + (c.count || 0), 0)
    const activeTotal = Math.max(votedCount, totalVotesInResults)

    return (
      <div className="min-h-screen bg-surface p-4 sm:p-6">
        <div className="max-w-lg mx-auto animate-slide-up space-y-5">
          <Header />

          {/* Banner de éxito */}
          <div className="card-glass p-6 text-center space-y-3 border-emerald-500/30 bg-emerald-500/5">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">¡Voto emitido correctamente!</h2>
              <p className="text-slate-400 text-xs mt-1">Tu participación ha sido registrada en el sistema.</p>
            </div>
            {selectedOption && (
              <div className="inline-block px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
                Tu elección: {selectedOption.text}
              </div>
            )}
          </div>

          {/* Resultados en tiempo real vía Socket.IO */}
          <div className="card-glass p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary-400" />
                <h3 className="text-sm font-bold text-slate-200">Resultados en tiempo real</h3>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                En vivo
              </span>
            </div>

            {/* Participación total */}
            <div className="flex items-center justify-between text-xs text-slate-400 bg-surface p-2.5 rounded-lg border border-surface-border">
              <span>Participación general</span>
              <span className="font-semibold text-slate-200">
                {votedCount} de {totalVoters} congresistas {totalVoters > 0 && `(${Math.round((votedCount / totalVoters) * 100)}%)`}
              </span>
            </div>

            {/* Barras de porcentaje por opción */}
            <div className="space-y-3 pt-1">
              {poll?.options.map(opt => {
                const countObj = counts.find(c => c.optionId === opt.id)
                const c = countObj?.count ?? 0
                const pct = activeTotal > 0 ? Math.round((c / activeTotal) * 100) : 0
                const isMyChoice = opt.id === selected

                return (
                  <div key={opt.id} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-medium flex items-center gap-1.5 ${isMyChoice ? 'text-emerald-300 font-bold' : 'text-slate-300'}`}>
                        {opt.text}
                        {isMyChoice && <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.2 rounded">Tú</span>}
                      </span>
                      <span className="text-slate-400 font-mono">
                        {c} {c === 1 ? 'voto' : 'votos'} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2.5 bg-surface rounded-full overflow-hidden border border-surface-border p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          isMyChoice ? 'bg-emerald-500' : 'bg-primary-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Opción de modificar voto si está permitido */}
          {poll?.allowVoteChange && poll.status === 'OPEN' && (
            <button
              onClick={() => setView('VOTE')}
              className="w-full flex items-center justify-center gap-2 btn-secondary py-3 text-sm font-medium"
            >
              <Edit3 className="w-4 h-4 text-primary-400" />
              Modificar mi voto
            </button>
          )}

          <div className="text-center pt-2">
            <button onClick={() => navigate('/sessions')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Volver al listado de sesiones
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Estado: CLOSED o CANCELED
  if (view === 'CLOSED' || view === 'CANCELED') return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm animate-slide-up space-y-6 text-center">
        <div className={`w-20 h-20 mx-auto rounded-full border-2 flex items-center justify-center
          ${view === 'CANCELED'
            ? 'bg-red-500/10 border-red-500/20'
            : 'bg-blue-500/10 border-blue-500/20'}`}>
          {view === 'CANCELED'
            ? <XCircle className="w-10 h-10 text-red-400" />
            : <Lock className="w-10 h-10 text-blue-400" />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {view === 'CANCELED' ? 'Votación cancelada' : 'Votación finalizada'}
          </h2>
          <p className="text-slate-500 text-sm">
            {view === 'CANCELED'
              ? 'La votación ha sido cancelada por el presidente.'
              : 'La votación ha concluido. Los resultados han sido registrados de forma inmutable.'}
          </p>
        </div>
        <button onClick={() => navigate('/sessions')} className="w-full btn-secondary py-3">
          Volver a las sesiones
        </button>
      </div>
    </div>
  )

  // Estado: ERROR
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-lg font-bold text-slate-100">Acceso denegado</h2>
        <p className="text-slate-500 text-sm">{error ?? 'No tienes acceso a esta votación.'}</p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={loadPoll} className="btn-secondary py-2.5 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
          <button onClick={() => navigate('/sessions')} className="btn-primary py-2.5">Inicio</button>
        </div>
      </div>
    </div>
  )
}

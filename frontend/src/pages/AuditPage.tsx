import { useEffect, useState, useCallback } from 'react'
import {
  ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  ChevronLeft, ChevronRight, Search, Clock, User, Hash, Activity
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string
  action: string
  userId: string | null
  details: Record<string, any>
  hash: string
  previousHash: string
  createdAt: string
  user?: { identifier: string; name: string } | null
}

interface PaginatedLogs {
  events: AuditEvent[]
  total: number
  page: number
  pages: number
}

interface VerifyResult {
  valid: boolean
  totalEvents: number
  firstCorruptedId?: string
  firstCorruptedIndex?: number
  message: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  USER_CREATED:               'text-emerald-400 bg-emerald-400/10 border-emerald-500/20',
  USER_UPDATED:               'text-blue-400   bg-blue-400/10   border-blue-500/20',
  USER_ACTIVATED:             'text-emerald-400 bg-emerald-400/10 border-emerald-500/20',
  USER_DEACTIVATED:           'text-red-400    bg-red-400/10    border-red-500/20',
  SESSION_CREATED:            'text-violet-400 bg-violet-400/10 border-violet-500/20',
  SESSION_UPDATED:            'text-blue-400   bg-blue-400/10   border-blue-500/20',
  SESSION_ACTIVE:             'text-emerald-400 bg-emerald-400/10 border-emerald-500/20',
  SESSION_CLOSED:             'text-slate-400  bg-slate-400/10  border-slate-500/20',
  SESSION_PARTICIPANT_ADDED:  'text-cyan-400   bg-cyan-400/10   border-cyan-500/20',
  SESSION_PARTICIPANT_REMOVED:'text-orange-400 bg-orange-400/10 border-orange-500/20',
  POLL_CREATED:               'text-violet-400 bg-violet-400/10 border-violet-500/20',
  POLL_UPDATED:               'text-blue-400   bg-blue-400/10   border-blue-500/20',
  POLL_OPEN:                  'text-emerald-400 bg-emerald-400/10 border-emerald-500/20',
  POLL_CLOSED:                'text-slate-400  bg-slate-400/10  border-slate-500/20',
  POLL_CANCELED:              'text-red-400    bg-red-400/10    border-red-500/20',
  VOTE_CAST:                  'text-amber-400  bg-amber-400/10  border-amber-500/20',
}

const ACTION_LABELS: Record<string, string> = {
  USER_CREATED:               'Usuario creado',
  USER_UPDATED:               'Usuario editado',
  USER_ACTIVATED:             'Usuario activado',
  USER_DEACTIVATED:           'Usuario desactivado',
  SESSION_CREATED:            'Sesión creada',
  SESSION_UPDATED:            'Sesión editada',
  SESSION_ACTIVE:             'Sesión abierta',
  SESSION_CLOSED:             'Sesión cerrada',
  SESSION_PARTICIPANT_ADDED:  'Participante añadido',
  SESSION_PARTICIPANT_REMOVED:'Participante removido',
  POLL_CREATED:               'Votación creada',
  POLL_UPDATED:               'Votación editada',
  POLL_OPEN:                  'Votación abierta',
  POLL_CLOSED:                'Votación cerrada',
  POLL_CANCELED:              'Votación cancelada',
  VOTE_CAST:                  'Voto emitido',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function shortHash(h: string) {
  return h === 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000'
    ? 'GÉNESIS'
    : `${h.slice(0, 8)}…${h.slice(-8)}`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [logs, setLogs]               = useState<PaginatedLogs | null>(null)
  const [loading, setLoading]         = useState(false)
  const [page, setPage]               = useState(1)
  const [search, setSearch]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [expanded, setExpanded]       = useState<string | null>(null)

  const [verifying, setVerifying]     = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' })
      if (search) params.set('action', search)
      const res = await fetch(`/api/audit?${params}`, { credentials: 'include' })
      if (res.ok) {
        const body = await res.json()
        // Backend returns: { data: [...], pagination: { page, limit, total, pages } }
        setLogs({
          events: body.data,
          total:  body.pagination.total,
          page:   body.pagination.page,
          pages:  body.pagination.pages,
        })
      }
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim().toUpperCase())
  }

  const handleVerify = async () => {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetch('/api/audit/verify', { credentials: 'include' })
      const data = await res.json()
      setVerifyResult(data)
    } catch {
      setVerifyResult({ valid: false, totalEvents: 0, message: 'Error al conectar con el servidor.' })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-4 sm:space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Auditoría del Sistema</h1>
            <p className="text-xs text-slate-500">Registro criptográfico e inmutable de todos los eventos</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-400
                       hover:text-slate-200 hover:bg-surface-card border border-surface-border
                       transition-all duration-150 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                       bg-violet-600 hover:bg-violet-500 text-white border border-violet-500/40
                       transition-all duration-150 disabled:opacity-50 shadow-lg shadow-violet-900/20"
          >
            <ShieldCheck className={`w-4 h-4 ${verifying ? 'animate-pulse' : ''}`} />
            {verifying ? 'Verificando…' : 'Verificar Integridad'}
          </button>
        </div>
      </div>

      {/* Integrity Banner */}
      {verifyResult && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 transition-all
          ${verifyResult.valid
            ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300'
            : 'bg-red-500/8 border-red-500/25 text-red-300'}`}>
          {verifyResult.valid
            ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400" />
            : <XCircle className="w-5 h-5 mt-0.5 shrink-0 text-red-400" />}
          <div>
            <p className="font-semibold text-sm">
              {verifyResult.valid ? '✅ Cadena de auditoría íntegra' : '🚨 ¡Integridad comprometida!'}
            </p>
            <p className="text-xs mt-0.5 opacity-80">{verifyResult.message}</p>
            {verifyResult.firstCorruptedId && (
              <p className="text-xs mt-1 font-mono opacity-70">
                Evento corrompido #{(verifyResult.firstCorruptedIndex ?? 0) + 1} — ID: {verifyResult.firstCorruptedId}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      {logs && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total eventos', value: logs.total, icon: <Activity className="w-4 h-4 text-violet-400" />, color: 'text-violet-400' },
            { label: 'Página actual', value: `${logs.page} / ${logs.pages}`, icon: <Hash className="w-4 h-4 text-blue-400" />, color: 'text-blue-400' },
            { label: 'Eventos / página', value: logs.events.length, icon: <Clock className="w-4 h-4 text-amber-400" />, color: 'text-amber-400' },
            { label: 'Algoritmo', value: 'SHA-256', icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, color: 'text-emerald-400' },
          ].map(s => (
            <div key={s.label} className="bg-surface-card border border-surface-border rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center shrink-0">{s.icon}</div>
              <div>
                <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Filtrar por acción: VOTE_CAST, POLL_OPEN, SESSION_CREATED…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface-card border border-surface-border
                       text-slate-200 placeholder-slate-600 text-sm focus:outline-none
                       focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-surface-card border border-surface-border text-sm
                     text-slate-300 hover:text-slate-100 hover:border-violet-500/40 transition-all"
        >
          Buscar
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
            className="px-3 py-2.5 rounded-xl text-sm text-slate-500 hover:text-red-400 transition-all"
          >
            Limpiar
          </button>
        )}
      </form>

      {/* Events Table */}
      <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-sm">Cargando eventos…</span>
          </div>
        ) : !logs || logs.events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <AlertTriangle className="w-8 h-8 mb-3" />
            <p className="text-sm">No se encontraron eventos de auditoría.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Acción</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Actor</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Hash</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {logs.events.map(ev => (
                <>
                  <tr
                    key={ev.id}
                    className="hover:bg-surface/50 transition-colors cursor-pointer"
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border
                        ${ACTION_COLORS[ev.action] ?? 'text-slate-400 bg-slate-400/10 border-slate-500/20'}`}>
                        {ACTION_LABELS[ev.action] ?? ev.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {ev.user ? (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-slate-500 shrink-0" />
                          <span className="text-slate-300 font-medium text-xs">{ev.user.name}</span>
                          <span className="text-slate-600 text-xs">({ev.user.identifier})</span>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs">Sistema</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="font-mono text-xs text-slate-500">{shortHash(ev.hash)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-400">{formatDate(ev.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-slate-500 text-xs transition-transform inline-block
                        ${expanded === ev.id ? 'rotate-90' : ''}`}>▶</span>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expanded === ev.id && (
                    <tr key={`${ev.id}-detail`} className="bg-surface/60">
                      <td colSpan={5} className="px-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div className="space-y-2">
                            <p className="text-slate-500 font-semibold uppercase tracking-wide">Detalles del evento</p>
                            <pre className="bg-surface rounded-lg p-3 text-slate-300 font-mono overflow-x-auto leading-relaxed border border-surface-border">
                              {JSON.stringify(ev.details, null, 2)}
                            </pre>
                          </div>
                          <div className="space-y-3">
                            <p className="text-slate-500 font-semibold uppercase tracking-wide">Cadena de hashes</p>
                            <div className="space-y-2">
                              <div className="bg-surface rounded-lg p-3 border border-surface-border">
                                <p className="text-slate-500 mb-1">Hash anterior (previousHash)</p>
                                <p className="font-mono text-slate-400 break-all leading-relaxed">{ev.previousHash}</p>
                              </div>
                              <div className="bg-surface rounded-lg p-3 border border-emerald-500/20">
                                <p className="text-emerald-500 mb-1">Hash de este evento</p>
                                <p className="font-mono text-emerald-400 break-all leading-relaxed">{ev.hash}</p>
                              </div>
                            </div>
                            <p className="text-slate-600 leading-relaxed">
                              ID: <span className="font-mono text-slate-500">{ev.id}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {logs && logs.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {logs.total} eventos · página {logs.page} de {logs.pages}
          </p>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-card
                         disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-surface-border"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(logs.pages, 7) }, (_, i) => {
              const p = i + 1
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${p === page
                      ? 'bg-violet-600 text-white border-violet-500'
                      : 'text-slate-500 hover:text-slate-200 hover:bg-surface-card border-surface-border'}`}
                >
                  {p}
                </button>
              )
            })}
            <button
              disabled={page === logs.pages}
              onClick={() => setPage(p => p + 1)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-card
                         disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-surface-border"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

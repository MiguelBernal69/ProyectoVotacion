/**
 * ResultsPage.tsx
 * Página de visualización del acta oficial de resultados.
 * Disponible para ADMIN, PRESIDENT y AUDITOR.
 * Permite generar el acta, ver datos de integridad y descargar PDF.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  FileText, Download, ShieldCheck, XCircle, CheckCircle2, Loader2,
  ArrowLeft, BarChart3, Users, Clock, Hash, AlertTriangle, RefreshCw, ExternalLink
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

interface OptionResult {
  optionId: string
  text: string
  count: number
  voters?: { name: string; identifier: string; votedAt: string }[]
}

interface ResultData {
  id: string
  pollId: string
  contentHash: string
  generatedAt: string
  generatedBy: { name: string; identifier: string }
  resultJson: {
    pollId: string; title: string; question: string; type: 'NOMINAL' | 'SECRET'
    sessionTitle: string; openedAt: string; closedAt: string; totalVotes: number
    summary: OptionResult[]; note?: string
  }
}

interface IntegrityInfo {
  valid: boolean
  storedHash: string
  currentHash: string
}

export default function ResultsPage() {
  const { pollId } = useParams<{ pollId: string }>()
  const navigate   = useNavigate()
  const { user }   = useAuth()

  const [result, setResult]       = useState<ResultData | null>(null)
  const [integrity, setIntegrity] = useState<IntegrityInfo | null>(null)
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [feedback, setFeedback]   = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const canGenerate = user && ['SUPERADMIN', 'ADMIN', 'PRESIDENT'].includes(user.role)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`${API}/polls/${pollId}/results`, { credentials: 'include' })
      const data = await res.json()
      if (res.status === 404) { setResult(null) }
      else if (!res.ok)      { throw new Error(data.error) }
      else {
        setResult(data.data)
        setIntegrity(data.integrity)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar resultados.')
    } finally {
      setLoading(false)
    }
  }, [pollId])

  useEffect(() => { load() }, [load])

  const generate = async () => {
    setGenerating(true); setFeedback(null)
    try {
      const res  = await fetch(`${API}/polls/${pollId}/results`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { setFeedback({ type: 'err', msg: data.error ?? 'Error al generar.' }); return }
      setFeedback({ type: 'ok', msg: 'Acta generada exitosamente.' })
      await load()
    } catch {
      setFeedback({ type: 'err', msg: 'Error de red.' })
    } finally {
      setGenerating(false)
    }
  }

  const downloadPdf = () => {
    window.open(`${API}/polls/${pollId}/results/pdf`, '_blank')
  }

  const openVerify = () => {
    if (result) window.open(`/verify/${result.id}`, '_blank')
  }

  if (loading) return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
    </div>
  )

  const d = result?.resultJson
  const total = d?.totalVotes ?? 0
  const maxCount = d ? Math.max(...d.summary.map(s => s.count), 1) : 1

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl border border-surface-border text-slate-500 hover:text-slate-200 transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-violet-400" />
            Acta Oficial
          </h1>
          <p className="text-xs text-slate-500">{d?.sessionTitle} — {d?.title}</p>
        </div>
        {result && (
          <div className="flex items-center gap-2">
            <button onClick={openVerify} className="p-2 rounded-xl border border-surface-border text-slate-500 hover:text-blue-400 transition-all" title="Verificación pública">
              <ExternalLink className="w-4 h-4" />
            </button>
            <button onClick={downloadPdf} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all">
              <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-start gap-2 p-3 rounded-xl border text-sm animate-slide-up
          ${feedback.type === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {feedback.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Sin acta generada */}
      {!result && !error && (
        <div className="card-glass p-8 text-center space-y-4">
          <FileText className="w-12 h-12 text-slate-600 mx-auto" />
          <div>
            <h2 className="text-base font-semibold text-slate-300 mb-1">Acta no generada</h2>
            <p className="text-slate-500 text-sm">El acta oficial de esta votación aún no ha sido generada.</p>
          </div>
          {canGenerate && (
            <button onClick={generate} disabled={generating} className="btn-primary px-6 py-2.5 flex items-center gap-2 mx-auto">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {generating ? 'Generando…' : 'Generar Acta Oficial'}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="card-glass p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-slate-400 text-sm">{error}</p>
          <button onClick={load} className="btn-secondary flex items-center gap-2 mx-auto px-4 py-2">
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      )}

      {result && d && (
        <>
          {/* Banner de integridad */}
          {integrity && (
            <div className={`rounded-xl border p-4 flex items-start gap-3 animate-fade-in
              ${integrity.valid
                ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300'
                : 'bg-red-500/8 border-red-500/25 text-red-300'}`}>
              {integrity.valid
                ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400" />
                : <XCircle className="w-5 h-5 mt-0.5 shrink-0 text-red-400" />}
              <div>
                <p className="font-semibold text-sm">
                  {integrity.valid ? '✅ Acta íntegra — No ha sido alterada' : '🚨 ¡ALERTA! Integridad comprometida'}
                </p>
                <p className="text-xs mt-0.5 opacity-80 font-mono break-all">
                  SHA-256: {result.contentHash.slice(0, 32)}…
                </p>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: <BarChart3 className="w-4 h-4 text-violet-400" />, label: 'Total votos', value: total, color: 'text-violet-400' },
              { icon: <Users className="w-4 h-4 text-blue-400" />, label: 'Tipo', value: d.type === 'NOMINAL' ? 'Nominal' : 'Secreta', color: 'text-blue-400' },
              { icon: <Clock className="w-4 h-4 text-amber-400" />, label: 'Generada', value: new Date(result.generatedAt).toLocaleDateString('es-ES'), color: 'text-amber-400' },
              { icon: <Hash className="w-4 h-4 text-emerald-400" />, label: 'ID', value: result.id.slice(0, 8) + '…', color: 'text-emerald-400' },
            ].map(s => (
              <div key={s.label} className="card-glass p-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center shrink-0">{s.icon}</div>
                <div>
                  <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-slate-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Resultados */}
          <div className="card-glass p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Resultados</h2>
            <p className="text-base text-slate-400">{d.question}</p>

            <div className="space-y-3">
              {d.summary.map((opt) => {
                const pct = total > 0 ? Math.round((opt.count / total) * 100) : 0
                const barPct = Math.round((opt.count / maxCount) * 100)
                return (
                  <div key={opt.optionId} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-200">{opt.text}</span>
                      <span className="text-slate-400">{opt.count} votos ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all duration-700"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detalle nominal */}
          {d.type === 'NOMINAL' && d.summary.some(s => s.voters && s.voters.length > 0) && (
            <div className="card-glass p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Detalle de votos nominales</h2>
              {d.summary.map(opt => opt.voters && opt.voters.length > 0 && (
                <div key={opt.optionId}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    {opt.text} ({opt.count})
                  </p>
                  <div className="space-y-1">
                    {opt.voters.map((v, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-surface-border/50 last:border-0">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary-600/20 border border-primary-500/20 flex items-center justify-center text-xs text-primary-400 font-medium">
                            {v.name[0]}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-slate-300">{v.name}</p>
                            <p className="text-xs text-slate-600">{v.identifier}</p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-600">
                          {new Date(v.votedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Nota de privacidad para secretas */}
          {d.type === 'SECRET' && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-violet-500/8 border border-violet-500/20">
              <ShieldCheck className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-violet-300">Privacidad garantizada</p>
                <p className="text-xs text-violet-400/70 mt-0.5">{d.note}</p>
              </div>
            </div>
          )}

          {/* Firmante y hash completo */}
          <div className="card-glass p-4 space-y-2 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>Generado por</span>
              <span className="text-slate-400">{result.generatedBy.name} ({result.generatedBy.identifier})</span>
            </div>
            <div className="flex justify-between">
              <span>Fecha</span>
              <span className="text-slate-400">{new Date(result.generatedAt).toLocaleString('es-ES')}</span>
            </div>
            <div>
              <span className="block mb-1">Hash SHA-256</span>
              <span className="font-mono text-slate-600 break-all leading-relaxed">{result.contentHash}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

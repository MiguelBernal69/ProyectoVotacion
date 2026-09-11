/**
 * VerifyPage.tsx
 * Página pública de verificación de actas.
 * Accesible sin autenticación — diseñada para ser escaneada desde el QR del PDF.
 * Muestra el acta y verifica la integridad criptográfica del contenido.
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  ShieldCheck, XCircle, CheckCircle2, Loader2, AlertTriangle,
  BarChart3, Lock, Hash, Clock, User, FileText
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL ?? '/api'

interface OptionResult {
  optionId: string; text: string; count: number
  voters?: { name: string; identifier: string; votedAt: string }[]
}

interface ActaData {
  id: string
  contentHash: string
  generatedAt: string
  generatedBy: { name: string; identifier: string }
  resultJson: {
    title: string; question: string; type: 'NOMINAL' | 'SECRET'
    sessionTitle: string; openedAt: string; closedAt: string
    totalVotes: number; summary: OptionResult[]; note?: string
  }
}

interface VerifyResponse {
  valid: boolean
  acta: ActaData
  recomputedHash: string
  storedHash: string
}

export default function VerifyPage() {
  const { actaId } = useParams<{ actaId: string }>()

  const [data, setData]       = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const verify = async () => {
      try {
        const res = await fetch(`${API}/verify/${actaId}`)
        if (res.status === 404) { setNotFound(true); return }
        const json = await res.json()
        setData(json)
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    verify()
  }, [actaId])

  if (loading) return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="w-10 h-10 text-primary-400 animate-spin mx-auto" />
        <p className="text-slate-500 text-sm">Verificando integridad del acta…</p>
      </div>
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="text-center space-y-4 max-w-sm">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
        <h1 className="text-xl font-bold text-slate-100">Acta no encontrada</h1>
        <p className="text-slate-500 text-sm">El identificador de acta no existe en el sistema.</p>
        <p className="text-xs text-slate-600 font-mono break-all">{actaId}</p>
      </div>
    </div>
  )

  if (!data) return null

  const { acta, valid } = data
  const d = acta.resultJson
  const total = d.totalVotes
  const maxCount = Math.max(...d.summary.map(s => s.count), 1)

  return (
    <div className="min-h-screen bg-surface">
      {/* Integrity Hero Banner */}
      <div className={`w-full py-10 px-6 text-center
        ${valid
          ? 'bg-gradient-to-b from-emerald-950 to-surface border-b border-emerald-900/30'
          : 'bg-gradient-to-b from-red-950 to-surface border-b border-red-900/30'}`}>
        <div className="max-w-md mx-auto space-y-4 animate-slide-up">
          {valid ? (
            <>
              <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-emerald-300">Acta Íntegra</h1>
                <p className="text-emerald-400/70 text-sm mt-1">El contenido de esta acta no ha sido alterado desde su generación.</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 mx-auto rounded-full bg-red-500/15 border-2 border-red-500/30 flex items-center justify-center">
                <XCircle className="w-10 h-10 text-red-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-red-300">⚠️ Integridad Comprometida</h1>
                <p className="text-red-400/70 text-sm mt-1">Esta acta ha sido modificada. Los datos mostrados no coinciden con el original.</p>
              </div>
            </>
          )}

          {/* Hash compacto */}
          <div className={`rounded-xl p-3 text-left mx-auto max-w-sm
            ${valid ? 'bg-emerald-500/8 border border-emerald-500/20' : 'bg-red-500/8 border border-red-500/20'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Hash className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-500">Hash SHA-256 almacenado</span>
            </div>
            <p className="font-mono text-xs break-all text-slate-400 leading-relaxed">{acta.contentHash}</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">

        {/* Info de la sesión y votación */}
        <div className="card-glass p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Datos del Acta</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-500 text-xs">Sesión</p>
              <p className="text-slate-200 font-medium">{d.sessionTitle}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Votación</p>
              <p className="text-slate-200 font-medium">{d.title}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Pregunta</p>
              <p className="text-slate-300">{d.question}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Tipo</p>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium
                ${d.type === 'SECRET'
                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                {d.type === 'SECRET' ? <Lock className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                {d.type === 'SECRET' ? 'Secreta' : 'Nominal'}
              </span>
            </div>
            <div>
              <p className="text-slate-500 text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> Apertura</p>
              <p className="text-slate-400 text-xs">{d.openedAt ? new Date(d.openedAt).toLocaleString('es-ES') : '—'}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> Cierre</p>
              <p className="text-slate-400 text-xs">{d.closedAt ? new Date(d.closedAt).toLocaleString('es-ES') : '—'}</p>
            </div>
          </div>
        </div>

        {/* Resultados */}
        <div className="card-glass p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Resultados — {total} votos emitidos</h2>
          </div>

          <div className="space-y-3">
            {d.summary.map(opt => {
              const pct    = total > 0 ? Math.round((opt.count / total) * 100) : 0
              const barPct = Math.round((opt.count / maxCount) * 100)
              return (
                <div key={opt.optionId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-200">{opt.text}</span>
                    <span className="text-slate-400 tabular-nums">{opt.count} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 bg-surface rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Detalle nominal (si aplica) */}
        {d.type === 'NOMINAL' && d.summary.some(s => s.voters && s.voters.length > 0) && (
          <div className="card-glass p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Detalle nominal</h2>
            {d.summary.map(opt => opt.voters && opt.voters.length > 0 && (
              <div key={opt.optionId}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{opt.text} ({opt.count})</p>
                <div className="space-y-1">
                  {opt.voters.map((v, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-surface-border/30 last:border-0">
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-slate-600" />
                        <span className="text-xs text-slate-300">{v.name} <span className="text-slate-600">({v.identifier})</span></span>
                      </div>
                      <span className="text-xs text-slate-600 tabular-nums">
                        {new Date(v.votedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Nota privacidad secretas */}
        {d.type === 'SECRET' && d.note && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-violet-500/8 border border-violet-500/20">
            <Lock className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
            <p className="text-xs text-violet-300 leading-relaxed">{d.note}</p>
          </div>
        )}

        {/* Firmante */}
        <div className="card-glass p-4 space-y-2 text-xs text-slate-500">
          <div className="flex items-center gap-2 mb-2">
            <User className="w-3.5 h-3.5" />
            <span className="font-semibold uppercase tracking-wide">Generado por</span>
          </div>
          <div className="flex justify-between">
            <span>Responsable</span>
            <span className="text-slate-400">{acta.generatedBy.name} ({acta.generatedBy.identifier})</span>
          </div>
          <div className="flex justify-between">
            <span>Fecha</span>
            <span className="text-slate-400">{new Date(acta.generatedAt).toLocaleString('es-ES')}</span>
          </div>
          <div className="flex justify-between">
            <span>ID de Acta</span>
            <span className="font-mono text-slate-600">{acta.id}</span>
          </div>
        </div>

        {/* Footer institucional */}
        <div className="text-center text-xs text-slate-700 pb-6 space-y-1">
          <p>Sistema de Votación Institucional — Verificación de Integridad</p>
          <p className="text-slate-800">Este documento fue generado automáticamente y es verificable criptográficamente.</p>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Server,
  Globe,
  ShieldCheck,
  Activity,
} from 'lucide-react'

// ─── Tipos ────────────────────────────────────────────────────────────────────
type ServiceStatus = 'loading' | 'ok' | 'error'

interface HealthData {
  status: string
  timestamp: string
  environment: string
  database: {
    status: string
    latencyMs: number
  }
  sistema: string
  fase: string
}

interface ServiceCheck {
  name: string
  status: ServiceStatus
  detail: string
  latency?: number
}

// ─── Variables de entorno ─────────────────────────────────────────────────────
// En dev: Vite proxea /api → http://localhost:4000/api (sin CORS)
// En prod: apuntar a la URL real del backend
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// ─── Componentes auxiliares ───────────────────────────────────────────────────
function StatusIcon({ status }: { status: ServiceStatus }) {
  if (status === 'loading') return <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
  if (status === 'ok')      return <CheckCircle className="w-5 h-5 text-emerald-400" />
  return <XCircle className="w-5 h-5 text-red-400" />
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const cls =
    status === 'ok'    ? 'badge-ok'      :
    status === 'error' ? 'badge-error'   :
                         'badge-loading'
  const dot =
    status === 'ok'    ? 'bg-emerald-400' :
    status === 'error' ? 'bg-red-400'     :
                         'bg-amber-400'
  const label =
    status === 'ok'    ? 'Operativo'  :
    status === 'error' ? 'Error'      :
                         'Verificando'

  return (
    <span className={cls}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${status === 'loading' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

function ServiceRow({
  service,
  icon,
}: {
  service: ServiceCheck
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-surface border border-surface-border transition-all hover:border-primary-600/50">
      <div className="flex items-center gap-3">
        <div className="text-primary-400">{icon}</div>
        <div>
          <p className="text-sm font-medium text-slate-200">{service.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{service.detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {service.latency !== undefined && (
          <span className="text-xs text-slate-500 tabular-nums">{service.latency}ms</span>
        )}
        <StatusIcon status={service.status} />
      </div>
    </div>
  )
}

// ─── Estado inicial ────────────────────────────────────────────────────────────
const INITIAL_CHECKS: ServiceCheck[] = [
  { name: 'Servidor Backend',  status: 'loading', detail: 'Verificando API REST…' },
  { name: 'Base de Datos',     status: 'loading', detail: 'Verificando PostgreSQL…' },
  { name: 'Frontend (Vite)',   status: 'ok',      detail: 'React 19 + Vite en ejecución' },
]

// ─── Página principal ─────────────────────────────────────────────────────────
export default function HealthDashboard() {
  const [health, setHealth]       = useState<HealthData | null>(null)
  const [globalStatus, setGlobal] = useState<ServiceStatus>('loading')
  const [lastChecked, setLast]    = useState<string>('')
  const [checks, setChecks]       = useState<ServiceCheck[]>(INITIAL_CHECKS)

  const runCheck = useCallback(async () => {
    setGlobal('loading')
    setChecks([
      { name: 'Servidor Backend', status: 'loading', detail: 'Conectando con el backend…' },
      { name: 'Base de Datos',    status: 'loading', detail: 'Verificando PostgreSQL…' },
      { name: 'Frontend (Vite)',  status: 'ok',      detail: 'React 19 + Vite en ejecución' },
    ])

    try {
      const res = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: HealthData = await res.json()
      setHealth(data)
      setLast(new Date().toLocaleTimeString('es'))

      const dbOk = data.database.status === 'connected'
      setChecks([
        {
          name: 'Servidor Backend',
          status: 'ok',
          detail: `Express + Node.js · Entorno: ${data.environment}`,
        },
        {
          name: 'Base de Datos',
          status: dbOk ? 'ok' : 'error',
          detail: dbOk ? 'PostgreSQL · Prisma conectado' : 'PostgreSQL sin conexión',
          latency: data.database.latencyMs,
        },
        { name: 'Frontend (Vite)', status: 'ok', detail: 'React 19 + Vite en ejecución' },
      ])
      setGlobal(dbOk ? 'ok' : 'error')
    } catch {
      setLast(new Date().toLocaleTimeString('es'))
      setChecks([
        {
          name: 'Servidor Backend',
          status: 'error',
          detail: '¿Está corriendo? → cd backend && npm run dev',
        },
        { name: 'Base de Datos',   status: 'error', detail: 'Sin datos (backend inaccesible)' },
        { name: 'Frontend (Vite)', status: 'ok',    detail: 'React 19 + Vite en ejecución' },
      ])
      setGlobal('error')
    }
  }, [])

  // Verificar al montar y cada 30 segundos
  useEffect(() => {
    runCheck()
    const id = setInterval(runCheck, 30_000)
    return () => clearInterval(id)
  }, [runCheck])

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Fondo decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-800/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-900/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg animate-slide-up">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-600/20 border border-primary-500/30 mb-4">
            <ShieldCheck className="w-8 h-8 text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
            Sistema de Votación Institucional
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Plataforma de votaciones electrónicas seguras
          </p>
        </div>

        {/* Card */}
        <div className="card-glass p-6 space-y-5">
          {/* Estado global */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary-400" />
              <span className="text-sm font-medium text-slate-300">Estado del sistema</span>
            </div>
            <StatusBadge status={globalStatus} />
          </div>

          <hr className="border-surface-border" />

          {/* Servicios */}
          <div className="space-y-2">
            {checks.map((s, i) => (
              <ServiceRow
                key={s.name}
                service={s}
                icon={
                  i === 0 ? <Server className="w-4 h-4" /> :
                  i === 1 ? <Database className="w-4 h-4" /> :
                            <Globe className="w-4 h-4" />
                }
              />
            ))}
          </div>

          {/* Respuesta JSON del backend */}
          {health && (
            <>
              <hr className="border-surface-border" />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                  Respuesta del backend
                </p>
                <pre className="rounded-lg bg-surface border border-surface-border p-4 font-mono text-xs text-slate-400 leading-relaxed overflow-auto">
                  {JSON.stringify(health, null, 2)}
                </pre>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-slate-600">
              {lastChecked ? `Última verificación: ${lastChecked}` : 'Verificando…'}
            </p>
            <button
              id="btn-recheck"
              onClick={runCheck}
              disabled={globalStatus === 'loading'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500
                         disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium
                         transition-all duration-200 active:scale-95"
            >
              {globalStatus === 'loading'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Activity className="w-3.5 h-3.5" />
              }
              Verificar ahora
            </button>
          </div>
        </div>

        {/* Info de fase */}
        <div className="mt-4 text-center">
          <span className="text-xs text-slate-600">
            Fase 1 — Infraestructura base · React 19 + Vite ·{' '}
            <span className="text-primary-600">{API_BASE}/health</span>
          </span>
        </div>
      </div>
    </main>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Edit3, ToggleLeft, ToggleRight, Loader2, AlertCircle, CheckCircle2, X, Search } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL ?? '/api'

type UserRole = 'SUPERADMIN' | 'ADMIN' | 'PRESIDENT' | 'AUDITOR' | 'PARTICIPANT'

interface User {
  id: string; identifier: string; name: string
  role: UserRole; isActive: boolean; createdAt: string
  _count: { sessions: number }
}

const ROLES: UserRole[] = ['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR', 'PARTICIPANT']
const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN:'Super Admin', ADMIN:'Administrador', PRESIDENT:'Presidente',
  AUDITOR:'Auditor', PARTICIPANT:'Participante',
}
const ROLE_STYLE: Record<string, string> = {
  SUPERADMIN:'text-red-400 bg-red-500/10 border-red-500/20',
  ADMIN:'text-orange-400 bg-orange-500/10 border-orange-500/20',
  PRESIDENT:'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  AUDITOR:'text-blue-400 bg-blue-500/10 border-blue-500/20',
  PARTICIPANT:'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
}

function Alert({ type, msg }: { type: 'error' | 'success'; msg: string }) {
  const s = type === 'error'
    ? 'bg-red-500/10 border-red-500/20 text-red-400'
    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
  const Icon = type === 'error' ? AlertCircle : CheckCircle2
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${s}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" /><span>{msg}</span>
    </div>
  )
}

interface UserFormProps {
  user?: User
  currentUserRole: UserRole
  onClose: () => void
  onSaved: () => void
}

function UserFormModal({ user, currentUserRole, onClose, onSaved }: UserFormProps) {
  const isEdit = !!user
  const [identifier, setIdentifier] = useState(user?.identifier ?? '')
  const [name, setName]             = useState(user?.name ?? '')
  const [role, setRole]             = useState<UserRole>(user?.role ?? 'PARTICIPANT')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // ADMIN cannot set SUPERADMIN role
  const availableRoles = currentUserRole === 'SUPERADMIN' ? ROLES : ROLES.filter(r => r !== 'SUPERADMIN')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isEdit) {
      if (!identifier.trim()) { setError('El identificador es requerido.'); return }
      if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    }
    if (name.trim().length < 2) { setError('El nombre debe tener al menos 2 caracteres.'); return }

    setLoading(true); setError(null)
    try {
      const url  = isEdit ? `${API}/users/${user!.id}` : `${API}/users`
      const body = isEdit
        ? { name: name.trim(), role, ...(password ? { password } : {}) }
        : { identifier: identifier.trim(), name: name.trim(), role, password }

      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Error inesperado.') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="card-glass w-full max-w-md p-6 space-y-5 animate-slide-up">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-200">
            {isEdit ? 'Editar Usuario' : 'Nuevo Usuario'}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <Alert type="error" msg={error} />}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-400">Identificador *</label>
              <input value={identifier} onChange={e => setIdentifier(e.target.value)}
                placeholder="Ej: usuario.apellido o 12345" className="input-field"
                maxLength={50} pattern="[a-zA-Z0-9._-]+" required />
              <p className="text-xs text-slate-600">Solo letras, números, puntos, guiones y guiones bajos.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Nombre completo *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Nombre y apellido" className="input-field" maxLength={100} required />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Rol *</label>
            <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="input-field">
              {availableRoles.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">
              {isEdit ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={isEdit ? '(sin cambios)' : 'Mínimo 6 caracteres'}
              className="input-field" minLength={isEdit ? 0 : 6} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Guardando…' : isEdit ? 'Actualizar' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers]     = useState<User[]>([])
  const [filtered, setFiltered] = useState<User[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'error'|'success'; msg: string } | null>(null)
  const [search, setSearch]     = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [modal, setModal]       = useState<{ open: boolean; user?: User }>({ open: false })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/users`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setUsers(data.users)
    } catch (err) { setError(err instanceof Error ? err.message : 'Error cargando usuarios.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let list = users
    if (roleFilter !== 'all') list = list.filter(u => u.role === roleFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(u => u.name.toLowerCase().includes(q) || u.identifier.toLowerCase().includes(q))
    }
    setFiltered(list)
  }, [users, search, roleFilter])

  const flash = (type: 'error' | 'success', msg: string) => {
    setFeedback({ type, msg }); setTimeout(() => setFeedback(null), 4000)
  }

  const handleToggleStatus = async (u: User) => {
    const action = u.isActive ? 'desactivar' : 'activar'
    if (!window.confirm(`¿Confirmas ${action} a "${u.name}"?`)) return
    try {
      const res = await fetch(`${API}/users/${u.id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !u.isActive }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash('success', data.message)
      load()
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Error.') }
  }

  const handleSaved = () => { setModal({ open: false }); load() }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Users className="w-6 h-6 text-primary-400" /> Gestión de Usuarios
          </h1>
          <p className="text-sm text-slate-500 mt-1">Participantes y personal del sistema</p>
        </div>
        <button onClick={() => setModal({ open: true })} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nuevo usuario
        </button>
      </div>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}
      {error    && <Alert type="error" msg={error} />}

      {/* Filters */}
      <div className="card-glass p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o identificador…"
            className="input-field pl-9 w-full" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-field w-auto">
          <option value="all">Todos los roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
        </div>
      ) : (
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-xs text-slate-500">
                  <th className="text-left px-4 py-3">Nombre</th>
                  <th className="text-left px-4 py-3">Identificador</th>
                  <th className="text-left px-4 py-3">Rol</th>
                  <th className="text-left px-4 py-3">Sesiones</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-right px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-500">No se encontraron usuarios.</td></tr>
                )}
                {filtered.map(u => (
                  <tr key={u.id} className={`hover:bg-surface/50 transition-colors ${!u.isActive ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-200">{u.name}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{u.identifier}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_STYLE[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u._count.sessions}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                        ${u.isActive
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        {u.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setModal({ open: true, user: u })}
                          className="p-1.5 text-slate-500 hover:text-primary-400 transition-colors" title="Editar">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {u.id !== currentUser?.id && (
                          <button onClick={() => handleToggleStatus(u)}
                            className={`p-1.5 transition-colors ${u.isActive
                              ? 'text-slate-500 hover:text-red-400'
                              : 'text-slate-500 hover:text-emerald-400'}`}
                            title={u.isActive ? 'Desactivar' : 'Activar'}>
                            {u.isActive
                              ? <ToggleRight className="w-4 h-4" />
                              : <ToggleLeft className="w-4 h-4" />
                            }
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-surface-border">
            <p className="text-xs text-slate-600">
              {filtered.length} usuario(s) — {filtered.filter(u => u.isActive).length} activos
            </p>
          </div>
        </div>
      )}

      {modal.open && currentUser && (
        <UserFormModal
          user={modal.user}
          currentUserRole={currentUser.role}
          onClose={() => setModal({ open: false })}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

const API = import.meta.env.VITE_API_URL ?? '/api'

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type Role = 'SUPERADMIN' | 'ADMIN' | 'PRESIDENT' | 'AUDITOR' | 'PARTICIPANT'

export interface AuthUser {
  id:         string
  identifier: string
  name:       string
  role:       Role
  isActive:   boolean
}

interface AuthContextValue {
  user:     AuthUser | null
  loading:  boolean
  login:    (identifier: string, password: string) => Promise<void>
  logout:   () => Promise<void>
}

// ─── Contexto ─────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Al montar, consulta /api/auth/me para restaurar sesión activa
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch(`${API}/auth/me`, {
        credentials: 'include', // Envía la cookie HttpOnly automáticamente
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkSession()
  }, [checkSession])

  // Login: el token se guarda en la cookie HttpOnly por el backend (no llega al JS)
  const login = async (identifier: string, password: string) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ identifier, password }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Error al iniciar sesión.')
    setUser(data.user)
  }

  const logout = async () => {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Hook de acceso seguro al contexto
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SocketProvider } from './contexts/SocketContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import Layout from './components/Layout'

import LoginPage             from './pages/LoginPage'
import DashboardPage         from './pages/DashboardPage'
import SessionsPage          from './pages/SessionsPage'
import SessionDetailPage     from './pages/SessionDetailPage'
import PollPreviewPage       from './pages/PollPreviewPage'
import UsersPage             from './pages/UsersPage'
import AuditPage             from './pages/AuditPage'
import ParticipantVotePage   from './pages/ParticipantVotePage'
import ResultsPage           from './pages/ResultsPage'
import VerifyPage            from './pages/VerifyPage'

function AppLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <Routes>

            {/* ─── Pública (sin auth) ─── */}
            <Route path="/login"           element={<LoginPage />} />
            <Route path="/verify/:actaId"  element={<VerifyPage />} />

            {/* ─── Todas las rutas protegidas ─── */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <AppLayout><DashboardPage /></AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Participante: votar en una votación */}
            <Route
              path="/vote/:pollId"
              element={
                <ProtectedRoute allowedRoles={['PARTICIPANT', 'SUPERADMIN', 'ADMIN', 'PRESIDENT']}>
                  <ParticipantVotePage />
                </ProtectedRoute>
              }
            />

            {/* Sesiones */}
            <Route
              path="/sessions"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR', 'PARTICIPANT']}>
                  <AppLayout><SessionsPage /></AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/sessions/:id"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR', 'PARTICIPANT']}>
                  <AppLayout><SessionDetailPage /></AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Votación (vista previa / gestión) */}
            <Route
              path="/polls/:id"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR', 'PARTICIPANT']}>
                  <AppLayout><PollPreviewPage /></AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Acta de resultados */}
            <Route
              path="/polls/:pollId/results"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'PRESIDENT', 'AUDITOR']}>
                  <AppLayout><ResultsPage /></AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Usuarios */}
            <Route
              path="/users"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN']}>
                  <AppLayout><UsersPage /></AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Auditoría */}
            <Route
              path="/audit"
              element={
                <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'AUDITOR']}>
                  <AppLayout><AuditPage /></AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Acceso denegado */}
            <Route
              path="/unauthorized"
              element={
                <div className="min-h-screen flex items-center justify-center bg-surface text-slate-300 text-center p-8">
                  <div>
                    <h1 className="text-4xl font-bold text-red-400 mb-3">403</h1>
                    <p className="text-slate-400">No tienes permiso para acceder a esta página.</p>
                  </div>
                </div>
              }
            />

            <Route path="/"  element={<Navigate to="/dashboard" replace />} />
            <Route path="*"  element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  )
}

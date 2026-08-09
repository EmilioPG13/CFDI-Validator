import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router'
import Home from './pages/Home'
import Auditoria from './pages/Auditoria'
import { AdminAuthProvider } from '@/lib/adminAuth'
import { ProtectedRoute } from '@/components/admin/ProtectedRoute'
import { AdminLayout } from '@/components/admin/AdminLayout'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'

// Route-level code splitting: the admin console is a separate audience (site operator,
// not the accountant-facing product) from Home/Auditoria, and nothing here needs to be
// in the initial bundle for a first-time visitor auditing a ZIP.
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const ModelCatalogPage = lazy(() => import('./pages/admin/ModelCatalogPage'))
const PromptVersionsPage = lazy(() => import('./pages/admin/PromptVersionsPage'))
const JobsPage = lazy(() => import('./pages/admin/JobsPage'))
const JobDetailPage = lazy(() => import('./pages/admin/JobDetailPage'))
const LlmCallsPage = lazy(() => import('./pages/admin/LlmCallsPage'))

function AdminRouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  )
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auditoria" element={<Auditoria />} />

        <Route path="/admin" element={<AdminAuthProvider><Outlet /></AdminAuthProvider>}>
          <Route
            path="login"
            element={
              <Suspense fallback={<AdminRouteFallback />}>
                <AdminLogin />
              </Suspense>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/models" replace />} />
            <Route
              path="models"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <ModelCatalogPage />
                </Suspense>
              }
            />
            <Route
              path="prompts"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <PromptVersionsPage />
                </Suspense>
              }
            />
            <Route
              path="jobs"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <JobsPage />
                </Suspense>
              }
            />
            <Route
              path="jobs/:id"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <JobDetailPage />
                </Suspense>
              }
            />
            <Route
              path="llm-calls"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <LlmCallsPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </>
  )
}

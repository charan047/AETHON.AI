import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { dashboardApi, onboardingApi } from './api/client'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/AuthContext'
import { WsProvider } from './contexts/WebSocketContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { CommandCenter } from './pages/CommandCenter'
import { Agents } from './pages/Agents'
import { Workflows } from './pages/Workflows'
import { Monitoring } from './pages/Monitoring'
import { Templates } from './pages/Templates'
import { WorkflowChat } from './pages/WorkflowChat'
import { Tools } from './pages/Tools'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Approvals } from './pages/Approvals'
import { Memory } from './pages/Memory'
import { Analytics } from './pages/Analytics'
import { Evaluations } from './pages/Evaluations'
import { Billing } from './pages/Billing'
import { Marketplace } from './pages/Marketplace'
import { MarketplaceDetail } from './pages/MarketplaceDetail'
import { PublishListing } from './pages/PublishListing'
import { Onboarding } from './pages/Onboarding'
import { CompanyOS } from './pages/CompanyOS'
import { Integrations } from './pages/Integrations'
import { CompanyChat } from './pages/CompanyChat'
import { UpgradeModal } from './components/plans/UpgradeModal'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import type { PlanLimitHitDetail } from './types'

function OnboardingLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-obsidian-950 text-slate-300">
      <div className="rounded-2xl border border-white/10 bg-obsidian-900 px-6 py-5 text-center shadow-glow-sm">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Loading company OS</p>
      </div>
    </div>
  )
}

function useOnboardingStatus() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['onboarding-status'],
    queryFn: onboardingApi.status,
    enabled: isAuthenticated,
    staleTime: 5_000,
  })
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, isLoading } = useOnboardingStatus()

  if (isLoading) return <OnboardingLoader />

  if (data && !data.onboarding_complete && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}

function OnboardingRoute() {
  const { data, isLoading } = useOnboardingStatus()

  if (isLoading) return <OnboardingLoader />
  if (data?.onboarding_complete) return <Navigate to="/" replace />

  return <Onboarding />
}

function DocumentTitleManager() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()
  const { data } = useQuery({
    queryKey: ['dashboard-summary', 'title'],
    queryFn: dashboardApi.summary,
    enabled: isAuthenticated && !['/login', '/register', '/onboarding'].includes(location.pathname),
    staleTime: 30_000,
  })

  const company = data?.company_profile.name || 'Obsidian'
  const pageTitle =
    location.pathname === '/' ? 'Command Center'
    : location.pathname.startsWith('/company-chat') ? 'Company Chat'
    : location.pathname.startsWith('/company-os') ? 'Company OS'
    : location.pathname.startsWith('/agents') ? 'My Team'
    : location.pathname.startsWith('/workflows') ? 'Workflows'
    : location.pathname.startsWith('/approvals') ? 'Approvals'
    : location.pathname.startsWith('/integrations') ? 'Integrations'
    : location.pathname.startsWith('/memory') ? 'Memory'
    : location.pathname.startsWith('/tools') ? 'Tools'
    : location.pathname.startsWith('/monitoring') ? 'Monitor'
    : location.pathname.startsWith('/analytics') ? 'Analytics'
    : location.pathname.startsWith('/evals') ? 'Eval Lab'
    : location.pathname.startsWith('/billing') ? 'Billing'
    : location.pathname.startsWith('/marketplace') ? 'Marketplace'
    : location.pathname.startsWith('/login') ? 'Login'
    : location.pathname.startsWith('/register') ? 'Register'
    : location.pathname.startsWith('/onboarding') ? 'Onboarding'
    : 'Company OS'

  useDocumentTitle(`${pageTitle} — ${company}`)
  return null
}

function UpgradeModalHost() {
  const [limitHit, setLimitHit] = useState<PlanLimitHitDetail | null>(null)

  useEffect(() => {
    const handlePlanLimit = (event: Event) => {
      setLimitHit((event as CustomEvent<PlanLimitHitDetail>).detail)
    }
    window.addEventListener('plan-limit-hit', handlePlanLimit)
    return () => window.removeEventListener('plan-limit-hit', handlePlanLimit)
  }, [])

  return (
    <UpgradeModal
      open={Boolean(limitHit)}
      onClose={() => setLimitHit(null)}
      resource={limitHit?.resource}
      message={limitHit?.detail}
      currentPlan={limitHit?.current_plan}
    />
  )
}

export default function App() {
  return (
    <AuthProvider>
      <WsProvider>
        <BrowserRouter>
          <DocumentTitleManager />
          <UpgradeModalHost />
          <Routes>
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="marketplace" element={<Marketplace />} />
            <Route path="marketplace/:slug" element={<MarketplaceDetail />} />
            <Route
              path="marketplace/publish"
              element={
                <ProtectedRoute>
                  <PublishListing />
                </ProtectedRoute>
              }
            />
            <Route
              path="onboarding"
              element={
                <ProtectedRoute>
                  <OnboardingRoute />
                </ProtectedRoute>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <Layout />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            >
              <Route index element={<CommandCenter />} />
              <Route path="company-os" element={<CompanyOS />} />
              <Route path="company-chat" element={<CompanyChat />} />
              <Route path="agents" element={<Agents />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="memory" element={<Memory />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="evals" element={<Evaluations />} />
              <Route path="billing" element={<Billing />} />
              <Route path="monitoring" element={<Monitoring />} />
              <Route path="templates" element={<Templates />} />
              <Route path="chat/:workflowId" element={<WorkflowChat />} />
              <Route path="tools" element={<Tools />} />
              <Route path="integrations" element={<Integrations />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WsProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#111118',
            color: '#f7f7fb',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 0 20px rgba(99,102,241,0.18)',
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#0a0a0f' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#0a0a0f' } },
        }}
      />
    </AuthProvider>
  )
}

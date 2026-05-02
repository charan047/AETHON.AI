import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { dashboardApi, onboardingApi } from './api/client'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/AuthContext'
import { WsProvider } from './contexts/WebSocketContext'
import { CommandPalette } from './components/CommandPalette'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Agents } from './pages/Agents'
import { Workflows } from './pages/Workflows'
import { Monitoring } from './pages/Monitoring'
import { Templates } from './pages/Templates'
import { WorkflowChat } from './pages/WorkflowChat'
import { ExecutionPage } from './pages/ExecutionPage'
import { Tools } from './pages/Tools'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Approvals } from './pages/Approvals'
import { Memory } from './pages/Memory'
import { Analytics } from './pages/Analytics'
import { Evaluations } from './pages/Evaluations'
import { Billing } from './pages/Billing'
import { Pricing } from './pages/Pricing'
import { Marketplace } from './pages/Marketplace'
import { MarketplaceDetail } from './pages/MarketplaceDetail'
import { PublishListing } from './pages/PublishListing'
import { TeamManagement } from './pages/TeamManagement'
import { OrgSettings } from './pages/OrgSettings'
import { AcceptInvite } from './pages/AcceptInvite'
import { OnboardingWizard } from './pages/OnboardingWizard'
import { CompanyOS } from './pages/CompanyOS'
import { Integrations } from './pages/Integrations'
import { CompanyChat } from './pages/CompanyChat'
import { ModelsPage } from './pages/ModelsPage'
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
  const { isAuthenticated, activeOrg, isLoading } = useAuth()
  return useQuery({
    queryKey: ['onboarding-status'],
    queryFn: onboardingApi.status,
    enabled: isAuthenticated && !!activeOrg?.id && !isLoading,
    staleTime: 5_000,
  })
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, activeOrg, isLoading: authLoading } = useAuth()
  const location = useLocation()
  const { data, isLoading } = useOnboardingStatus()

  if (authLoading || (isAuthenticated && !activeOrg) || isLoading) return <OnboardingLoader />

  if (data && !data.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}

function OnboardingRoute() {
  const { isAuthenticated, activeOrg, isLoading: authLoading } = useAuth()
  const { data, isLoading } = useOnboardingStatus()

  if (authLoading || (isAuthenticated && !activeOrg) || isLoading) return <OnboardingLoader />
  if (data?.onboarding_completed) return <Navigate to="/" replace />

  return <OnboardingWizard />
}

function DocumentTitleManager() {
  const location = useLocation()
  const { isAuthenticated, activeOrg, isLoading } = useAuth()
  const { data } = useQuery({
    queryKey: ['dashboard-summary', 'title'],
    queryFn: dashboardApi.summary,
    enabled: isAuthenticated && !!activeOrg?.id && !isLoading && !['/login', '/register', '/onboarding'].includes(location.pathname),
    staleTime: 30_000,
  })

  const company = data?.company_profile.name || 'Obsidian'
  const pageTitle =
    location.pathname === '/' ? 'Command Center'
    : location.pathname.startsWith('/company-chat') ? 'Company Chat'
    : location.pathname.startsWith('/company-os') ? 'Company OS'
    : location.pathname.startsWith('/agents') ? 'My Team'
    : location.pathname.startsWith('/workflows') ? 'Workflows'
    : location.pathname.startsWith('/executions') ? 'Execution'
    : location.pathname.startsWith('/approvals') ? 'Approvals'
    : location.pathname.startsWith('/integrations') ? 'Integrations'
    : location.pathname.startsWith('/memory') ? 'Memory'
    : location.pathname.startsWith('/tools') ? 'Tools'
    : location.pathname.startsWith('/monitoring') ? 'Monitor'
    : location.pathname.startsWith('/analytics') ? 'Analytics'
    : location.pathname.startsWith('/evals') ? 'Eval Lab'
    : location.pathname.startsWith('/pricing') ? 'Pricing'
    : location.pathname.startsWith('/settings/billing') || location.pathname.startsWith('/billing') ? 'Billing'
    : location.pathname.startsWith('/settings/models') ? 'Models'
    : location.pathname.startsWith('/settings/team') ? 'Team Settings'
    : location.pathname.startsWith('/settings/org') ? 'Org Settings'
    : location.pathname.startsWith('/marketplace') ? 'Marketplace'
    : location.pathname.startsWith('/invite') ? 'Invitation'
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
          <CommandPalette />
          <Toaster
            position="bottom-right"
            expand={false}
            richColors={false}
            toastOptions={{
              style: {
                background: '#0F1520',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#F0F4FF',
                borderRadius: '12px',
                fontSize: '14px',
              },
              classNames: {
                success: '!border-l-4 !border-l-emerald-500',
                error: '!border-l-4 !border-l-red-500',
                info: '!border-l-4 !border-l-accent-purple',
                warning: '!border-l-4 !border-l-amber-500',
              },
            }}
          />
          <Routes>
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="invite/:token" element={<AcceptInvite />} />
            <Route path="marketplace" element={<Marketplace />} />
            <Route path="marketplace/:slug" element={<MarketplaceDetail />} />
            <Route path="pricing" element={<Pricing />} />
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
              <Route index element={<Dashboard />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="company-os" element={<CompanyOS />} />
              <Route path="company-chat" element={<CompanyChat />} />
              <Route path="messages" element={<CompanyChat />} />
              <Route path="agents" element={<Agents />} />
              <Route path="org-chart" element={<TeamManagement />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="executions" element={<Navigate to="/monitoring" replace />} />
              <Route path="executions/:executionId" element={<ExecutionPage />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="memory" element={<Memory />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="evals" element={<Evaluations />} />
              <Route path="billing" element={<Navigate to="/settings/billing" replace />} />
              <Route path="monitoring" element={<Monitoring />} />
              <Route path="templates" element={<Templates />} />
              <Route path="chat/:workflowId" element={<WorkflowChat />} />
              <Route path="tools" element={<Tools />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="company" element={<OrgSettings />} />
              <Route path="settings/billing" element={<Billing />} />
              <Route path="settings/models" element={<ModelsPage />} />
              <Route path="settings/team" element={<TeamManagement />} />
              <Route path="settings/org" element={<OrgSettings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WsProvider>
    </AuthProvider>
  )
}

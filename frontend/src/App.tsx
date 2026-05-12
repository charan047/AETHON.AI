import React from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AlertTriangle } from 'lucide-react'
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
import { WorkflowChat } from './pages/WorkflowChat'
import { ExecutionPage } from './pages/ExecutionPage'
import { Tools } from './pages/Tools'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Approvals } from './pages/Approvals'
import { Memory } from './pages/Memory'
import { Analytics } from './pages/Analytics'
import { Evaluations } from './pages/Evaluations'
import { Marketplace } from './pages/Marketplace'
import { MarketplaceDetail } from './pages/MarketplaceDetail'
import { PublishListing } from './pages/PublishListing'
import { TeamManagement } from './pages/TeamManagement'
import { OrgSettings } from './pages/OrgSettings'
import { AcceptInvite } from './pages/AcceptInvite'
import { OnboardingWizard } from './pages/OnboardingWizard'
import { Integrations } from './pages/Integrations'
import { CompanyChat } from './pages/CompanyChat'
import { DirectMessages } from './pages/DirectMessages'
import { ModelsPage } from './pages/ModelsPage'
import { Clients } from './pages/Clients'
import { ClientPortal } from './pages/ClientPortal'
import { useDocumentTitle } from './hooks/useDocumentTitle'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected error occurred',
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AETHON] Unhandled render error:', error)
    console.error('[AETHON] Component stack:', info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-items-center bg-obsidian-950 p-6 text-white">
          <div className="max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-300">
                <AlertTriangle size={28} />
              </div>
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              Something went wrong
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/40">
              {this.state.errorMessage}
            </p>
            <div className="mt-8 flex gap-3 justify-center">
              <button
                className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-medium text-white"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
              <button
                className="rounded-xl border border-white/10 bg-white/[0.04] px-6 py-2.5 text-sm text-white/70"
                onClick={() => window.location.href = '/'}
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function OnboardingLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-obsidian-950 text-slate-300">
      <div className="rounded-2xl border border-white/10 bg-obsidian-900 px-6 py-5 text-center shadow-glow-sm">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Loading agency workspace</p>
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
    location.pathname === '/' || location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/company-os') ? 'Dashboard'
    : /^\/portal\/[^/]+/.test(location.pathname) ? 'Client Portal'
    : /^\/clients\/[^/]+/.test(location.pathname) ? 'Client Detail'
    : location.pathname.startsWith('/clients') ? 'Clients'
    : location.pathname.startsWith('/company-chat') ? 'Agency Chat'
    : location.pathname.startsWith('/agents') ? 'AI Team'
    : location.pathname.startsWith('/messages') ? 'Agent Messages'
    : location.pathname.startsWith('/workflows') ? 'Workflows'
    : location.pathname.startsWith('/executions') ? 'Executions'
    : location.pathname.startsWith('/approvals') ? 'Approvals'
    : location.pathname.startsWith('/integrations') ? 'Integrations'
    : location.pathname.startsWith('/memory') ? 'Memory'
    : location.pathname.startsWith('/tools') ? 'Custom Tools'
    : location.pathname.startsWith('/monitoring') ? 'Executions'
    : location.pathname.startsWith('/analytics') ? 'Analytics'
    : location.pathname.startsWith('/evals') ? 'Evals'
    : location.pathname.startsWith('/settings/models') ? 'AI Models'
    : location.pathname.startsWith('/settings/team') ? 'Team Structure'
    : location.pathname.startsWith('/settings/org') || location.pathname.startsWith('/company') ? 'Settings'
    : location.pathname.startsWith('/marketplace') ? 'Marketplace'
    : location.pathname.startsWith('/invite') ? 'Invitation'
    : location.pathname.startsWith('/login') ? 'Login'
    : location.pathname.startsWith('/register') ? 'Register'
    : location.pathname.startsWith('/onboarding') ? 'Onboarding'
    : 'Aethon Agency OS'

  useDocumentTitle(`${pageTitle} — ${company}`)
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <WsProvider>
        <ErrorBoundary>
          <BrowserRouter>
            <DocumentTitleManager />
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
                  info: '!border-l-4 !border-l-blue-500',
                  warning: '!border-l-4 !border-l-amber-500',
                },
              }}
            />
            <Routes>
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="invite/:token" element={<AcceptInvite />} />
              <Route path="portal/:token" element={<ClientPortal />} />
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
                <Route index element={<Dashboard />} />
                <Route path="dashboard" element={<Navigate to="/" replace />} />
                <Route path="company-os" element={<Navigate to="/" replace />} />
                <Route path="company-chat" element={<CompanyChat />} />
                <Route path="company-chat/:conversationId" element={<CompanyChat />} />
                <Route path="clients" element={<Clients />} />
                <Route path="clients/:clientId" element={<Clients />} />
                <Route path="messages" element={<DirectMessages />} />
                <Route path="messages/:agentId" element={<DirectMessages />} />
                <Route path="agents" element={<Agents />} />
                <Route path="org-chart" element={<Navigate to="/settings/team" replace />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="executions" element={<Navigate to="/monitoring" replace />} />
                <Route path="executions/:executionId" element={<ExecutionPage />} />
                <Route path="approvals" element={<Approvals />} />
                <Route path="memory" element={<Memory />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="evals" element={<Evaluations />} />
                <Route path="monitoring" element={<Monitoring />} />
                <Route path="templates" element={<Navigate to="/marketplace" replace />} />
                <Route path="chat/:workflowId" element={<WorkflowChat />} />
                <Route path="tools" element={<Tools />} />
                <Route path="integrations" element={<Integrations />} />
                <Route path="company" element={<Navigate to="/settings/org" replace />} />
                <Route path="settings/models" element={<ModelsPage />} />
                <Route path="settings/team" element={<TeamManagement />} />
                <Route path="settings/org" element={<OrgSettings />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </WsProvider>
    </AuthProvider>
  )
}

import axios from 'axios'
import type {
  Agent,
  AgentTrustScoreDetail,
  Workflow,
  ScheduledWorkflow,
  AutomationTemplate,
  WorkflowWebhookUrl,
  Execution,
  ExecutionRunResponse,
  Stats,
  Template,
  ApprovalRequest,
  AgentApprovalRequestItem,
  AgentApprovalRequestsResponse,
  AgentMemoryConfig,
  AgentMemoryStats,
  AgentMemoryItem,
  OnboardingStatus,
  OnboardingHireResponse,
  CompanyProfile,
  CompanyProfileInput,
  CompanyState,
  CompanyYamlApplySummary,
  CompanyYamlPreview,
  CompanyYamlValidation,
  BusinessSummary,
  UserIntegration,
  AgentFeedback,
  AgentReputation,
  AgencyOverview,
  FeedbackType,
  DashboardSummary,
  WorkflowVersion,
  WorkflowVersionDetail,
  WorkflowVersionDiff,
  AnalyticsCosts,
  AnalyticsOverview,
  AnalyticsPerformance,
  AnalyticsTools,
  EvalCase,
  EvalInsights,
  EvalRun,
  EvalRunsResponse,
  EvalModelComparisonHistoryResponse,
  EvalModelComparisonResult,
  EvalQuickTestResponse,
  EvalSuite,
  InviteDetails,
  LongTaskStatus,
  MarketplaceCategory,
  MarketplaceInstall,
  MarketplaceListing,
  MarketplaceListingType,
  MarketplaceSearchResponse,
  ModelConfigRecord,
  ModelTemplate,
  ModelTestResult,
  Organization,
  OrgInvite,
  OrgMember,
  OrgMemberRole,
  ScoringMethod,
  CEOInboxResponse,
  InboxMessage,
  ConversationsResponse,
  ThreadResponse,
  DirectMessage,
  TeamConversation,
  CompanyConversationDetailResponse,
  CompanyConversationListResponse,
  CompanyConversationSearchResponse,
  Client,
  ClientActivityResponse,
  ClientCreateInput,
  ClientDetail,
  ClientListResponse,
  NotificationPreference,
} from '../types'

export const api = axios.create({ baseURL: '/api', withCredentials: true })
export const apiClient = api
export const ACTIVE_ORG_STORAGE_KEY = 'ai-company-os-active-org-id'
const SESSION_HINT_STORAGE_KEY = 'ai-company-os-has-session'

export function extractApiError(error: unknown): string {
  if (!error) return 'An unexpected error occurred'
  const axiosError = error as {
    response?: { data?: { detail?: string | { msg?: string }[]; message?: string } }
    message?: string
  }
  const data = axiosError.response?.data
  if (typeof data?.detail === 'string') return data.detail
  if (Array.isArray(data?.detail)) {
    return data.detail.map(d => d.msg || JSON.stringify(d)).join(', ')
  }
  if (data?.message) return data.message
  if (axiosError.message) return axiosError.message
  return 'An unexpected error occurred'
}

const storedOrgId = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) : null
if (storedOrgId) {
  api.defaults.headers.common['X-Org-Id'] = storedOrgId
}

let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback)
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(callback => callback(token))
  refreshSubscribers = []
}

api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean }

    if (
      error?.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/')
    ) {
      if (isRefreshing) {
        return new Promise(resolve => {
          subscribeTokenRefresh(token => {
            originalRequest.headers = originalRequest.headers ?? {}
            originalRequest.headers.Authorization = `Bearer ${token}`
            resolve(api(originalRequest))
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const { data } = await api.post('/auth/refresh', {})
        const newToken = data.access_token as string
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`
        localStorage.setItem(SESSION_HINT_STORAGE_KEY, '1')
        onRefreshed(newToken)
        originalRequest.headers = originalRequest.headers ?? {}
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch {
        delete api.defaults.headers.common.Authorization
        localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY)
        localStorage.removeItem(SESSION_HINT_STORAGE_KEY)
        window.location.href = '/login'
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }
    return Promise.reject(error)
  },
)

// Agents
export const agentsApi = {
  list: () => api.get<Agent[]>('/agents').then(r => r.data),
  get: (id: string) => api.get<Agent>(`/agents/${id}`).then(r => r.data),
  getTrustScore: (id: string) => api.get<AgentTrustScoreDetail>(`/roles/agents/${id}/trust-score`).then(r => r.data),
  create: (data: Partial<Agent>) => api.post<Agent>('/agents', data).then(r => r.data),
  update: (id: string, data: Partial<Agent>) => api.put<Agent>(`/agents/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  assignModel: (id: string, modelConfigId: string | null) =>
    api.patch<Agent>(`/agents/${id}/model`, { model_config_id: modelConfigId }).then(r => r.data),
  getModels: () => api.get<{id: string; name: string; provider: string}[]>('/agents/meta/models').then(r => r.data),
  getTools: () => api.get<{id: string; name: string; description: string}[]>('/agents/meta/tools').then(r => r.data),
  getMemoryConfig: (id: string) => api.get<AgentMemoryConfig>(`/agents/${id}/memory-config`).then(r => r.data),
  updateMemoryConfig: (id: string, data: Partial<AgentMemoryConfig>) =>
    api.put<AgentMemoryConfig>(`/agents/${id}/memory-config`, data).then(r => r.data),
  startLongTask: (id: string, data: { task: string; max_duration_hours?: number }) =>
    api.post<{ task_id: string; status: string }>(`/agents/${id}/long-tasks`, data).then(r => r.data),
  getLongTaskStatus: (taskId: string) => api.get<LongTaskStatus>(`/agents/long-tasks/${taskId}`).then(r => r.data),
  pauseLongTask: (taskId: string) => api.post<{ paused: boolean }>(`/agents/long-tasks/${taskId}/pause`).then(r => r.data),
  cancelLongTask: (taskId: string) => api.post<{ cancelled: boolean }>(`/agents/long-tasks/${taskId}/cancel`).then(r => r.data),
}

export const clientsApi = {
  list: () =>
    api.get<ClientListResponse>('/clients').then(r => r.data),
  get: (id: string) =>
    api.get<ClientDetail>(`/clients/${id}`).then(r => r.data),
  create: (data: ClientCreateInput) =>
    api.post<Client>('/clients', data).then(r => r.data),
  update: (id: string, data: Partial<ClientCreateInput>) =>
    api.put<Client>(`/clients/${id}`, data).then(r => r.data),
  archive: (id: string) =>
    api.delete(`/clients/${id}`).then(r => r.data),
  enablePortal: (id: string) =>
    api.post<{ portal_token: string; portal_url: string }>(
      `/clients/${id}/portal/enable`,
    ).then(r => r.data),
  disablePortal: (id: string) =>
    api.post(`/clients/${id}/portal/disable`).then(r => r.data),
  regenerateToken: (id: string) =>
    api.get<{ portal_token: string }>(`/clients/${id}/portal/regenerate-token`)
      .then(r => r.data),
  getActivity: (id: string) =>
    api.get<ClientActivityResponse>(`/clients/${id}/activity`).then(r => r.data),
  assignAgent: (agentId: string, clientId: string | null) =>
    api.post(`/agents/${agentId}/assign-client`, { client_id: clientId })
      .then(r => r.data),
}

export const portalApi = {
  get: (token: string) => api.get(`/portal/${token}`).then(r => r.data),
}

// Workflows
export const workflowsApi = {
  list: () => api.get<Workflow[]>('/workflows').then(r => r.data),
  listScheduled: () => api.get<ScheduledWorkflow[]>('/workflows/scheduled').then(r => r.data),
  get: (id: string) => api.get<Workflow>(`/workflows/${id}`).then(r => r.data),
  create: (data: Partial<Workflow>) => api.post<Workflow>('/workflows', data).then(r => r.data),
  update: (id: string, data: Partial<Workflow>) => api.put<Workflow>(`/workflows/${id}`, data).then(r => r.data),
  setSchedule: (id: string, schedule: string, scheduleEnabled: boolean, scheduleTimezone: string) =>
    api.patch<ScheduledWorkflow>(`/workflows/${id}/schedule`, {
      schedule,
      schedule_enabled: scheduleEnabled,
      schedule_timezone: scheduleTimezone,
    }).then(r => r.data),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  getTemplates: () => api.get<Template[]>('/workflows/templates').then(r => r.data),
  automationTemplates: () => api.get<AutomationTemplate[]>('/workflows/automation-templates').then(r => r.data),
  enableAutomationTemplate: (id: string) => api.post(`/workflows/automation-templates/${id}/enable`).then(r => r.data),
  webhookUrl: (id: string) => api.get<WorkflowWebhookUrl>(`/workflows/${id}/webhook-url`).then(r => r.data),
  versions: (id: string) => api.get<WorkflowVersion[]>(`/workflows/${id}/versions`).then(r => r.data),
  version: (id: string, version: number) =>
    api.get<WorkflowVersionDetail>(`/workflows/${id}/versions/${version}`).then(r => r.data),
  diff: (id: string, a: number, b: number) =>
    api.get<WorkflowVersionDiff>(`/workflows/${id}/versions/diff`, { params: { a, b } }).then(r => r.data),
  rollback: (id: string, targetVersion: number) =>
    api.post<Workflow>(`/workflows/${id}/rollback`, { target_version: targetVersion, confirm: true }).then(r => r.data),
}

// Executions
export const executionsApi = {
  list: (workflowId?: string) =>
    api.get<Execution[]>('/executions', { params: { workflow_id: workflowId } }).then(r => r.data),
  get: (id: string) => api.get<Execution>(`/executions/${id}`).then(r => r.data),
  run: (workflowId: string, input: string) =>
    api.post<ExecutionRunResponse>(`/executions/workflows/${workflowId}/run`, { input_message: input }).then(r => r.data),
  cancel: (id: string) =>
    api.delete(`/executions/${id}`).then(r => r.data),
  getMessages: (id: string) =>
    api.get(`/executions/${id}/messages`).then(r => r.data),
}

export const modelsApi = {
  templates: () => api.get<ModelTemplate[]>('/models/templates').then(r => r.data),
  list: () => api.get<ModelConfigRecord[]>('/models').then(r => r.data),
  get: (id: string) => api.get<ModelConfigRecord>(`/models/${id}`).then(r => r.data),
  create: (data: {
    provider: string
    model_id: string
    display_name: string
    api_key?: string | null
    base_url?: string | null
    notes?: string | null
    set_as_default?: boolean
    context_window?: number | null
    supports_tools?: boolean
    supports_vision?: boolean
    cost_per_million_input_tokens?: number | null
    cost_per_million_output_tokens?: number | null
  }) => api.post<ModelConfigRecord>('/models', data).then(r => r.data),
  test: (data: { provider: string; model_id: string; api_key?: string | null; base_url?: string | null }) =>
    api.post<ModelTestResult>('/models/test', data).then(r => r.data),
  update: (id: string, data: { display_name?: string; notes?: string | null; is_active?: boolean }) =>
    api.put<ModelConfigRecord>(`/models/${id}`, data).then(r => r.data),
  rotateKey: (id: string, apiKey: string) =>
    api.patch<{ success: boolean }>(`/models/${id}/rotate-key`, { api_key: apiKey }).then(r => r.data),
  setDefault: (id: string) =>
    api.post<{ success: boolean }>(`/models/${id}/set-default`).then(r => r.data),
  testSaved: (id: string) =>
    api.post<ModelTestResult>(`/models/${id}/test`).then(r => r.data),
  delete: (id: string) =>
    api.delete<{ success: boolean }>(`/models/${id}`).then(r => r.data),
}

// Custom Tools
export const customToolsApi = {
  list: () => api.get('/tools').then(r => r.data),
  get: (id: string) => api.get(`/tools/${id}`).then(r => r.data),
  create: (data: { name: string; description: string; code: string }) =>
    api.post('/tools', data).then(r => r.data),
  update: (id: string, data: Partial<{ name: string; description: string; code: string; is_active: boolean }>) =>
    api.put(`/tools/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/tools/${id}`),
  parseParams: (code: string) =>
    api.post('/tools/parse-params', { code }).then(r => r.data as { params: ToolParam[] }),
  test: (id: string, params: Record<string, unknown>) =>
    api.post(`/tools/${id}/test`, { params }).then(r => r.data),
}

export interface ToolParam {
  name: string
  type: string
  required: boolean
  default: unknown
}

// Monitoring
export const monitoringApi = {
  stats: () => api.get<Stats>('/monitoring/stats').then(r => r.data),
  recentExecutions: (limit = 10) =>
    api.get('/monitoring/recent-executions', { params: { limit } }).then(r => r.data),
  logs: (params?: { limit?: number; execution_id?: string }) =>
    api.get('/monitoring/logs', { params }).then(r => r.data),
}

// HITL Approvals
export const approvalsApi = {
  pending: () => api.get<ApprovalRequest[]>('/approvals/pending').then(r => r.data),
  history: (limit = 50, offset = 0) =>
    api.get<ApprovalRequest[]>('/approvals/history', { params: { limit, offset } }).then(r => r.data),
  approve: (id: string, comment?: string) =>
    api.post<ApprovalRequest>(`/approvals/${id}/approve`, { comment }).then(r => r.data),
  reject: (id: string, comment?: string) =>
    api.post<ApprovalRequest>(`/approvals/${id}/reject`, { comment }).then(r => r.data),
  agentRequests: () =>
    api.get<AgentApprovalRequestsResponse>('/approvals/agent-requests').then(r => r.data),
  approveAgentRequest: (id: string, note?: string) =>
    api.post<AgentApprovalRequestItem>(`/approvals/agent-requests/${id}/approve`, { note }).then(r => r.data),
  rejectAgentRequest: (id: string, note: string) =>
    api.post<AgentApprovalRequestItem>(`/approvals/agent-requests/${id}/reject`, { note }).then(r => r.data),
}

// Agent memory
export const memoryApi = {
  stats: (agentId: string) => api.get<AgentMemoryStats>(`/memory/agents/${agentId}/stats`).then(r => r.data),
  history: (agentId: string, lastN = 10) =>
    api.get<AgentMemoryItem[]>(`/memory/agents/${agentId}/history`, { params: { last_n: lastN } }).then(r => r.data),
  clearAgent: (agentId: string) => api.delete<{deleted: number}>(`/memory/agents/${agentId}`).then(r => r.data),
}

// First-run onboarding
export const onboardingApi = {
  status: () => api.get<OnboardingStatus>('/onboarding/status').then(r => r.data),
  saveCompany: (data: {
    agency_name: string
    what_you_do: string
    how_many_clients: string
    biggest_time_sink: string
  }) =>
    api.post<{ success: boolean; next_step: string }>('/onboarding/company', data).then(r => r.data),
  hireFirstAgent: (data: {
    listing_slug: string
    competitors: string
    delivery_method: string
    persona_name?: string | null
  }) =>
    api.post<OnboardingHireResponse>('/onboarding/hire-first-agent', data).then(r => r.data),
  skip: () =>
    api.post<{ success: boolean }>('/onboarding/skip').then(r => r.data),
  saveCompanyProfile: (data: CompanyProfileInput) =>
    api.post<CompanyProfile>('/onboarding/company-profile', data).then(r => r.data),
  generateTeam: (companyProfileId: string, selectedRoles: string[]) =>
    api.post<Agent[]>('/onboarding/generate-team', {
      company_profile_id: companyProfileId,
      selected_roles: selectedRoles,
    }).then(r => r.data),
  complete: () =>
    api.post<{ success?: boolean; onboarding_complete?: boolean; redirect: string }>('/onboarding/complete').then(r => r.data),
}

// Company OS
export const companyApi = {
  profile: () => api.get<CompanyState>('/company/profile').then(r => r.data),
  updateProfile: (data: Partial<CompanyProfile>) =>
    api.put<CompanyProfile>('/company/profile', data).then(r => r.data),
  exportYaml: () => api.get<string>('/company/yaml', { responseType: 'text' }).then(r => r.data),
  validateYaml: (yamlContent: string) =>
    api.post<CompanyYamlValidation>('/company/yaml/validate', { yaml_content: yamlContent }).then(r => r.data),
  previewYaml: (yamlContent: string) =>
    api.post<CompanyYamlPreview>('/company/yaml/preview', { yaml_content: yamlContent }).then(r => r.data),
  applyYaml: (yamlContent: string) =>
    api.post<CompanyYamlApplySummary>('/company/yaml/apply', { yaml_content: yamlContent }).then(r => r.data),
}

export const companyChatApi = {
  authHeaders: () => {
    const authorization = api.defaults.headers.common.Authorization
    const orgId = api.defaults.headers.common['X-Org-Id']
    return {
      ...(authorization ? { Authorization: String(authorization) } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    }
  },
  send: async (payload: {
    message: string
    conversation_id?: string
    attachments?: Array<Record<string, unknown>>
  }) => fetch('/api/company/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...companyChatApi.authHeaders(),
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  }),
  history: (conversationId: string) =>
    api.get<CompanyConversationDetailResponse>(`/company/conversations/${conversationId}/messages`).then(r => r.data),
  conversations: () =>
    api.get<CompanyConversationListResponse>('/company/conversations').then(r => r.data),
  searchConversations: (q: string) =>
    api.get<CompanyConversationSearchResponse>('/company/chat/search', { params: { q } }).then(r => r.data),
  pinConversation: (id: string) =>
    api.post<{ id: string; pinned: boolean }>(`/company/conversations/${id}/pin`).then(r => r.data),
  renameConversation: (id: string, title: string) =>
    api.post<{ id: string; title: string }>(`/company/conversations/${id}/rename`, { title }).then(r => r.data),
  deleteConversation: (id: string) =>
    api.delete<{ deleted: boolean }>(`/company/conversations/${id}`).then(r => r.data),
}

// Business context engine
export const businessApi = {
  context: () => api.get<{ context: string }>('/business/context').then(r => r.data),
  summary: () => api.get<BusinessSummary>('/business/summary').then(r => r.data),
  updateRevenue: (data: { monthly_revenue: number; runway_months?: number | null }) =>
    api.put<BusinessSummary>('/business/revenue', data).then(r => r.data),
  addGoal: (goal: string) => api.post<BusinessSummary>('/business/goals', { goal }).then(r => r.data),
  updateGoal: (index: number, goal: string) =>
    api.put<BusinessSummary>(`/business/goals/${index}`, { goal }).then(r => r.data),
  deleteGoal: (index: number) => api.delete<BusinessSummary>(`/business/goals/${index}`).then(r => r.data),
}

export const integrationsApi = {
  list: () => api.get<UserIntegration[]>('/integrations').then(r => r.data),
  startGmailOAuth: () =>
    api.get<{ oauth_url: string }>('/integrations/oauth/gmail/start').then(r => r.data),
  startSlackOAuth: () =>
    api.get<{ oauth_url: string }>('/integrations/oauth/slack/start').then(r => r.data),
  oauthCallback: (data: { code: string; state: string }) =>
    api.post<{
      success: boolean
      provider: 'gmail' | 'slack'
      email?: string
      workspace?: string
      integration: UserIntegration
    }>('/integrations/oauth/callback', data).then(r => r.data),
  refreshGmailOAuth: () =>
    api.get<{ success: boolean; provider: 'gmail'; email: string; expires_at?: string | null }>(
      '/integrations/oauth/gmail/refresh',
    ).then(r => r.data),
  createGitHub: (data: { name: string; access_token: string; default_repo?: string }) =>
    api.post<UserIntegration>('/integrations/github', data).then(r => r.data),
  createEmail: (data: {
    name: string
    smtp_host: string
    smtp_port: number
    smtp_user: string
    smtp_password: string
    imap_host: string
    imap_port: number
    from_name?: string
  }) => api.post<UserIntegration>('/integrations/email', data).then(r => r.data),
  test: (id: string) => api.post<UserIntegration>(`/integrations/${id}/test`).then(r => r.data),
  delete: (id: string) => api.delete(`/integrations/${id}`),
}

export const notificationsApi = {
  list: (unreadOnly = true) => api.get('/notifications', { params: { unread_only: unreadOnly } }).then(r => r.data),
  count: () => api.get<{ unread: number }>('/notifications/count').then(r => r.data),
  preferences: () => api.get<NotificationPreference>('/notifications/preferences').then(r => r.data),
  updatePreferences: (data: NotificationPreference) =>
    api.put<NotificationPreference>('/notifications/preferences', data).then(r => r.data),
}

export const feedbackApi = {
  record: (
    executionId: string,
    agentId: string,
    data: { feedback_type: FeedbackType; edited_output?: string; comment?: string },
  ) => api.post<AgentReputation>(`/feedback/executions/${executionId}/agents/${agentId}`, data).then(r => r.data),
  reputation: (agentId: string) => api.get<AgentReputation>(`/feedback/agents/${agentId}/reputation`).then(r => r.data),
  history: (agentId: string, limit = 20) =>
    api.get<AgentFeedback[]>(`/feedback/agents/${agentId}/history`, { params: { limit } }).then(r => r.data),
  learnings: (agentId: string) =>
    api.get<{ learning_notes: AgentReputation['learning_notes'] }>(`/feedback/agents/${agentId}/learnings`).then(r => r.data),
}

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary').then(r => r.data),
}

export const agencyApi = {
  overview: () => api.get<AgencyOverview>('/agency/overview').then(r => r.data),
}

export const analyticsApi = {
  overview: (periodDays = 30) =>
    api.get<AnalyticsOverview>('/analytics/overview', { params: { period_days: periodDays } }).then(r => r.data),
  costs: (periodDays = 30) =>
    api.get<AnalyticsCosts>('/analytics/costs', { params: { period_days: periodDays } }).then(r => r.data),
  performance: () => api.get<AnalyticsPerformance>('/analytics/performance').then(r => r.data),
  tools: (periodDays = 30) =>
    api.get<AnalyticsTools>('/analytics/tools', { params: { period_days: periodDays } }).then(r => r.data),
}

export const toolsApi = {
  toolsHealth: () => api.get('/tools/health').then(r => r.data),
  providerHealth: () => api.get('/tools/provider-health').then(r => r.data),
  catalog: () => api.get('/tools/catalog').then(r => r.data),
  analytics: (periodDays = 7) =>
    api.get('/tools/analytics', { params: { period_days: periodDays } }).then(r => r.data),
}

export const evalsApi = {
  suites: () => api.get<EvalSuite[]>('/evals/suites').then(r => r.data),
  createSuite: (data: { name: string; description?: string; agent_id: string; pass_threshold: number }) =>
    api.post<EvalSuite>('/evals/suites', data).then(r => r.data),
  suite: (id: string) => api.get<EvalSuite>(`/evals/suites/${id}`).then(r => r.data),
  updateSuite: (id: string, data: Partial<Pick<EvalSuite, 'name' | 'description' | 'status' | 'pass_threshold'>>) =>
    api.put<EvalSuite>(`/evals/suites/${id}`, data).then(r => r.data),
  deleteSuite: (id: string) => api.delete(`/evals/suites/${id}`),
  createCase: (suiteId: string, data: {
    name: string
    description?: string
    input: string
    expected_output?: string
    scoring_method: ScoringMethod
    scoring_config?: Record<string, unknown>
    weight: number
    tags?: string
  }) => api.post<EvalCase>(`/evals/suites/${suiteId}/cases`, data).then(r => r.data),
  updateCase: (suiteId: string, caseId: string, data: Partial<EvalCase>) =>
    api.put<EvalCase>(`/evals/suites/${suiteId}/cases/${caseId}`, data).then(r => r.data),
  deleteCase: (suiteId: string, caseId: string) => api.delete(`/evals/suites/${suiteId}/cases/${caseId}`),
  bulkCases: (suiteId: string, cases: unknown[]) =>
    api.post<{ created: number; cases: EvalCase[] }>(`/evals/suites/${suiteId}/cases/bulk`, { cases }).then(r => r.data),
  generateFromHistory: (suiteId: string, data: { agent_id?: string; count?: number }) =>
    api.post<{ created: number; cases: EvalCase[] }>(`/evals/suites/${suiteId}/cases/generate-from-history`, data).then(r => r.data),
  runSuite: (suiteId: string, data: { triggered_by?: string; notes?: string }) =>
    api.post<EvalRun | { run_id: string; task_id: string; status: string; message: string }>(`/evals/suites/${suiteId}/run`, data).then(r => r.data),
  runCase: (suiteId: string, caseId: string) =>
    api.post<EvalRun>(`/evals/suites/${suiteId}/cases/${caseId}/run`).then(r => r.data),
  run: (runId: string) => api.get<EvalRun>(`/evals/runs/${runId}`).then(r => r.data),
  runs: (suiteId: string, limit = 20) =>
    api.get<EvalRunsResponse>(`/evals/suites/${suiteId}/runs`, { params: { limit } }).then(r => r.data),
  insights: (suiteId: string) => api.get<EvalInsights>(`/evals/suites/${suiteId}/insights`).then(r => r.data),
  compareModels: (suiteId: string, modelAId: string, modelBId: string) =>
    api.post<EvalModelComparisonResult>(`/evals/${suiteId}/compare`, {
      model_a_id: modelAId,
      model_b_id: modelBId,
    }).then(r => r.data),
  compareHistory: (suiteId: string) =>
    api.get<EvalModelComparisonHistoryResponse>(`/evals/${suiteId}/compare-history`).then(r => r.data),
  quickTest: (agentId: string) =>
    api.post<EvalQuickTestResponse>(`/evals/quick-test/${agentId}`).then(r => r.data),
  ciToken: () => api.get<{ ci_token: string; key_prefix: string; message: string }>('/evals/ci/token').then(r => r.data),
}

export const organizationsApi = {
  mine: () => api.get<Organization[]>('/organizations/me').then(r => r.data),
  create: (data: { name: string; slug?: string }) => api.post<Organization>('/organizations', data).then(r => r.data),
  get: (orgId: string) => api.get<Organization & { members: OrgMember[] }>(`/organizations/${orgId}`).then(r => r.data),
  update: (orgId: string, data: Partial<Pick<Organization, 'name' | 'slug' | 'timezone' | 'logo_url' | 'agent_message_retention_days'>>) =>
    api.put<Organization>(`/organizations/${orgId}`, data).then(r => r.data),
  delete: (orgId: string) => api.delete(`/organizations/${orgId}`),
  members: (orgId: string) => api.get<OrgMember[]>(`/organizations/${orgId}/members`).then(r => r.data),
  invites: (orgId: string) => api.get<OrgInvite[]>(`/organizations/${orgId}/invites`).then(r => r.data),
  invite: (orgId: string, data: { email: string; role: Exclude<OrgMemberRole, 'owner'>; message?: string }) =>
    api.post<OrgInvite>(`/organizations/${orgId}/invites`, data).then(r => r.data),
  resendInvite: (orgId: string, inviteId: string) =>
    api.post<OrgInvite>(`/organizations/${orgId}/invites/${inviteId}/resend`).then(r => r.data),
  revokeInvite: (orgId: string, inviteId: string) => api.delete(`/organizations/${orgId}/invites/${inviteId}`),
  updateMemberRole: (orgId: string, userId: string, role: OrgMemberRole) =>
    api.put<OrgMember>(`/organizations/${orgId}/members/${userId}/role`, { role }).then(r => r.data),
  removeMember: (orgId: string, userId: string) => api.delete(`/organizations/${orgId}/members/${userId}`),
  inviteDetails: (token: string) => api.get<InviteDetails>(`/invites/${token}`).then(r => r.data),
  acceptInvite: (token: string) => api.post<{ accepted: boolean; org_id: string; org_name?: string | null }>(`/invites/${token}/accept`).then(r => r.data),
}

export const messagesApi = {
  // ── New direct-messaging endpoints ──────────────────────────────────────
  conversations: () =>
    api.get<ConversationsResponse>('/messages/conversations').then(r => r.data),
  thread: (agentId: string, params?: { before?: string; limit?: number }) =>
    api.get<ThreadResponse>(`/messages/thread/${agentId}`, { params }).then(r => r.data),
  send: (body: {
    to_agent_id: string
    content: string
    message_type?: string
    priority?: string
    schedule_reply_in_minutes?: number | null
  }) => api.post<DirectMessage>('/messages/send', body).then(r => r.data),
  markRead: (id: string) =>
    api.post<{ read: boolean; read_at: string }>(`/messages/${id}/read`).then(r => r.data),
  resolve: (id: string) =>
    api.post<{ resolved: boolean }>(`/messages/${id}/resolve`).then(r => r.data),
  cancelScheduledReply: (id: string) =>
    api.delete<{ cancelled: boolean }>(`/messages/${id}/scheduled-reply`).then(r => r.data),
  unreadCount: () =>
    api.get<{ count: number }>('/messages/unread-count').then(r => r.data),
  setRetention: (retentionDays: number | null) =>
    api.put<{ retention_days: number | null; updated: boolean }>('/messages/retention', { retention_days: retentionDays }).then(r => r.data),
  teamConversations: (limit = 20) =>
    api.get<{ conversations: TeamConversation[] }>('/messages/team-conversations', { params: { limit } }).then(r => r.data),
  // ── Legacy CEO-inbox endpoints (backward compat) ─────────────────────────
  ceoInbox: (unreadOnly = false) =>
    api.get<CEOInboxResponse>('/messages/ceo-inbox', { params: { unread_only: unreadOnly } }).then(r => r.data),
  ceoRespond: (data: { thread_id: string; content: string; resolve: boolean }) =>
    api.post<{ sent: boolean; resolved: boolean; message_id: string }>('/messages/ceo-respond', data).then(r => r.data),
  ceoSend: (data: { to_agent_id: string; content: string; message_type: string }) =>
    api.post<{ sent: boolean; thread_id: string; message_id: string }>('/messages/ceo-send', data).then(r => r.data),
}

export const marketplaceApi = {
  search: (params: {
    query?: string
    category?: MarketplaceCategory | 'all'
    type?: MarketplaceListingType | 'all'
    sort_by?: 'popular' | 'newest' | 'rating'
    limit?: number
    offset?: number
  }) => api.get<MarketplaceSearchResponse>('/marketplace', {
    params: {
      ...params,
      category: params.category === 'all' ? undefined : params.category,
      type: params.type === 'all' ? undefined : params.type,
    },
  }).then(r => r.data),
  detail: (slug: string) => api.get<MarketplaceListing>(`/marketplace/${slug}`).then(r => r.data),
  install: (listingId: string, data?: { agent_id?: string; reinstall?: boolean; agent_name?: string; workflow_name?: string; configured_inputs?: Record<string, unknown> }) =>
    api.post<{
      installed?: boolean
      reinstalled?: boolean
      already_installed?: boolean
      resource_id?: string | null
      type?: MarketplaceListingType
      success?: boolean
      agent_id?: string
      workflow_id?: string
      agent_name?: string
      role?: string
      autonomy_level?: string
      trust_score?: number
      what_they_can_do?: string[]
      needs_configuration?: boolean
      next_step?: 'configure' | 'ready'
    }>(`/marketplace/${listingId}/install`, data || {}).then(r => r.data),
  myInstalls: () => api.get<MarketplaceInstall[]>('/marketplace/my-installs').then(r => r.data),
  publishAgent: (agentId: string, data: Record<string, unknown>) =>
    api.post<MarketplaceListing>(`/marketplace/publish/agent/${agentId}`, data).then(r => r.data),
  publishWorkflow: (workflowId: string, data: Record<string, unknown>) =>
    api.post<MarketplaceListing>(`/marketplace/publish/workflow/${workflowId}`, data).then(r => r.data),
  publishTool: (toolId: string, data: Record<string, unknown>) =>
    api.post<MarketplaceListing>(`/marketplace/publish/tool/${toolId}`, data).then(r => r.data),
  myListings: () => api.get<MarketplaceListing[]>('/marketplace/my-listings').then(r => r.data),
  review: (listingId: string, data: { rating: number; title?: string; body?: string }) =>
    api.post(`/marketplace/${listingId}/review`, data).then(r => r.data),
}

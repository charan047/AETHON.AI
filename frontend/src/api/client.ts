import axios from 'axios'
import type {
  Agent,
  Workflow,
  Execution,
  ExecutionRunResponse,
  Stats,
  Template,
  ApprovalRequest,
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
  EvalSuite,
  BillingPlan,
  BillingPlansResponse,
  BillingInvoice,
  BillingPaymentMethod,
  BillingSubscriptionResponse,
  BillingUpcomingInvoice,
  BillingUsageSummary,
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
  OrgPlan,
  OrgMember,
  OrgMemberRole,
  ScoringMethod,
} from '../types'

export const api = axios.create({ baseURL: '/api', withCredentials: true })
export const apiClient = api
export const ACTIVE_ORG_STORAGE_KEY = 'ai-company-os-active-org-id'

const storedOrgId = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) : null
if (storedOrgId) {
  api.defaults.headers.common['X-Org-Id'] = storedOrgId
}

api.interceptors.response.use(
  response => response,
  error => {
    const payload = error?.response?.data
    const limitPayload = payload?.code === 'plan_limit_reached'
      ? payload
      : payload?.detail?.code === 'plan_limit_reached'
        ? payload.detail
        : null
    if ((error?.response?.status === 429 || error?.response?.status === 403) && limitPayload) {
      window.dispatchEvent(new CustomEvent('plan-limit-hit', { detail: limitPayload }))
    }
    return Promise.reject(error)
  },
)

// Agents
export const agentsApi = {
  list: () => api.get<Agent[]>('/agents').then(r => r.data),
  get: (id: string) => api.get<Agent>(`/agents/${id}`).then(r => r.data),
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

// Workflows
export const workflowsApi = {
  list: () => api.get<Workflow[]>('/workflows').then(r => r.data),
  get: (id: string) => api.get<Workflow>(`/workflows/${id}`).then(r => r.data),
  create: (data: Partial<Workflow>) => api.post<Workflow>('/workflows', data).then(r => r.data),
  update: (id: string, data: Partial<Workflow>) => api.put<Workflow>(`/workflows/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  getTemplates: () => api.get<Template[]>('/workflows/templates').then(r => r.data),
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
  logs: () => api.get('/monitoring/logs').then(r => r.data),
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
  saveCompany: (data: { company_name: string; company_description: string; primary_challenge: string }) =>
    api.post<{ success: boolean; next_step: string }>('/onboarding/company', data).then(r => r.data),
  hireFirstAgent: (data: { listing_slug: string; competitors: string; delivery_method: string }) =>
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

export const analyticsApi = {
  overview: (periodDays = 30) =>
    api.get<AnalyticsOverview>('/analytics/overview', { params: { period_days: periodDays } }).then(r => r.data),
  costs: (periodDays = 30) =>
    api.get<AnalyticsCosts>('/analytics/costs', { params: { period_days: periodDays } }).then(r => r.data),
  performance: () => api.get<AnalyticsPerformance>('/analytics/performance').then(r => r.data),
  tools: (periodDays = 30) =>
    api.get<AnalyticsTools>('/analytics/tools', { params: { period_days: periodDays } }).then(r => r.data),
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
  ciToken: () => api.get<{ ci_token: string; key_prefix: string; message: string }>('/evals/ci/token').then(r => r.data),
}

export const billingApi = {
  usage: () => api.get<BillingUsageSummary>('/billing/usage').then(r => r.data),
  subscription: () => api.get<BillingSubscriptionResponse>('/billing/subscription').then(r => r.data),
  plan: () => api.get<BillingSubscriptionResponse>('/billing/plan').then(r => r.data),
  plans: () => api.get<BillingPlansResponse>('/billing/plans').then(r => r.data),
  invoices: () => api.get<BillingInvoice[]>('/billing/invoices').then(r => r.data),
  upcomingInvoice: () => api.get<BillingUpcomingInvoice>('/billing/upcoming-invoice').then(r => r.data),
  setupIntent: () => api.post<{ client_secret: string }>('/billing/setup-intent').then(r => r.data),
  paymentMethods: () => api.get<BillingPaymentMethod[]>('/billing/payment-methods').then(r => r.data),
  setDefaultPaymentMethod: (paymentMethodId: string) =>
    api.post<{ updated: boolean }>(`/billing/payment-methods/${paymentMethodId}/set-default`).then(r => r.data),
  deletePaymentMethod: (paymentMethodId: string) =>
    api.delete<{ deleted: boolean }>(`/billing/payment-methods/${paymentMethodId}`).then(r => r.data),
  subscribe: (plan: OrgPlan, paymentMethodId: string) =>
    api.post('/billing/subscribe', { plan, payment_method_id: paymentMethodId }).then(r => r.data),
  upgrade: (plan: OrgPlan) =>
    api.post('/billing/upgrade', { plan }).then(r => r.data),
  cancel: (immediately = false) =>
    api.post('/billing/cancel', { immediately }).then(r => r.data),
}

export const organizationsApi = {
  mine: () => api.get<Organization[]>('/organizations/me').then(r => r.data),
  create: (data: { name: string; slug?: string }) => api.post<Organization>('/organizations', data).then(r => r.data),
  get: (orgId: string) => api.get<Organization & { members: OrgMember[] }>(`/organizations/${orgId}`).then(r => r.data),
  update: (orgId: string, data: Partial<Pick<Organization, 'name' | 'slug' | 'timezone' | 'logo_url'>>) =>
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

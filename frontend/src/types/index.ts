export interface Agent {
  id: string
  name: string
  role: string
  role_slug?: string | null
  seniority_level?: number
  autonomy_level?: string | null
  trust_score?: number | null
  description: string
  system_prompt: string
  model: string
  model_config_id?: string | null
  tools: string[]
  memory_enabled: boolean
  memory_window: number
  max_tokens: number
  temperature: number
  max_iterations: number
  timeout: number
  max_retries: number
  retry_delay_seconds: number
  retry_backoff_multiplier: number
  retry_on_timeout: boolean
  telegram_enabled: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LongTaskStatus {
  task_id: string
  agent_id?: string
  user_id?: string
  org_id?: string
  task?: string
  status: string
  progress: number
  current_step: string
  intermediate_outputs: string[]
  elapsed_seconds: number
  task_preview?: string
  error?: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    agent_id?: string
    agent_ids?: string[]
    role?: string
    [key: string]: unknown
  }
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  animated?: boolean
  label?: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  status: 'draft' | 'active' | 'paused'
  trigger: string
  schedule: string | null
  input_template?: string
  input_variables?: Array<Record<string, unknown>>
  configured_inputs?: Record<string, unknown>
  template_id: string | null
  execution_mode: 'sequential' | 'orchestrator'
  orchestration_prompt: string
  max_cycles: number
  created_at: string
  updated_at: string
}

export interface WorkflowVersion {
  id: string
  workflow_id: string
  version_number: number
  changelog: string | null
  created_by_user_id: string | null
  created_by?: string | null
  created_at: string
}

export interface WorkflowVersionDetail extends WorkflowVersion {
  definition: Partial<Workflow>
}

export interface WorkflowVersionDiff {
  nodes_added: WorkflowNode[]
  nodes_removed: WorkflowNode[]
  nodes_modified: {
    id: string
    before: WorkflowNode
    after: WorkflowNode
  }[]
  edges_added: WorkflowEdge[]
  edges_removed: WorkflowEdge[]
  settings_changed: Record<string, { before: unknown; after: unknown }>
}

export interface Execution {
  id: string
  workflow_id: string
  workflow_name?: string
  agent_name?: string
  model_name?: string
  duration_seconds?: number | null
  trigger: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval' | 'rejected' | 'timed_out'
  input?: string
  input_message: string
  output_message: string
  started_at: string
  completed_at: string | null
  token_count: number
  cost: number
  error: string | null
  messages: Message[]
  steps?: ExecutionStep[]
}

export interface ExecutionStep {
  id: string
  execution_id: string
  org_id: string
  step_type: 'thought' | 'action' | 'observation' | 'final_answer' | 'error' | 'human_input_required' | 'retry'
  content: string
  tool_name?: string | null
  tool_input?: unknown
  tool_output?: unknown
  tool_success?: boolean | null
  step_index: number
  duration_ms?: number | null
  tokens_used?: number | null
  timestamp?: string
  created_at: string
}

export interface ExecutionRunResponse {
  execution_id: string
  status: string
  websocket_channel: string
  message: string
}

export interface ModelTemplate {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom'
  model_id: string
  display_name: string
  context_window?: number | null
  supports_tools: boolean
  supports_vision: boolean
  cost_per_million_input_tokens?: number | null
  cost_per_million_output_tokens?: number | null
  description: string
  recommended_for: string[]
  speed: string
  tier: string
  requires_api_key: boolean
  requires_base_url: boolean
  requires_ollama: boolean
}

export interface ModelConfigRecord {
  id: string
  org_id: string
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom'
  model_id: string
  display_name: string
  base_url?: string | null
  context_window?: number | null
  supports_tools: boolean
  supports_vision: boolean
  cost_per_million_input_tokens?: number | null
  cost_per_million_output_tokens?: number | null
  is_active: boolean
  is_default: boolean
  test_status?: 'untested' | 'ok' | 'failed' | null
  test_error?: string | null
  last_tested_at?: string | null
  notes?: string | null
  created_at: string
  updated_at?: string | null
  agent_count: number
  masked_api_key?: string | null
}

export interface ModelTestResult {
  success: boolean
  response_preview?: string | null
  latency_ms?: number | null
  error?: string | null
}

export interface ApprovalRequest {
  id: string
  workflow_id: string
  execution_id: string
  node_id: string
  title: string
  description?: string | null
  context_data?: string | Record<string, unknown> | null
  status: 'pending' | 'approved' | 'rejected' | 'timed_out'
  workflow_name?: string
  agent_name?: string | null
  requested_at: string
  expires_at?: string | null
  reviewed_at?: string | null
  reviewed_by_user_id?: string | null
  reviewer_comment?: string | null
  reviewer?: string | null
}

export interface AgentMemoryConfig {
  id: string
  agent_id: string
  memory_enabled: boolean
  max_memories_per_query: number
  memory_window_days: number
  auto_summarize: boolean
  created_at: string
  updated_at: string | null
}

export interface AgentMemoryStats {
  total_memories: number
  oldest_memory?: string | null
  newest_memory?: string | null
  session_count: number
}

export interface AgentMemoryItem {
  content: string
  metadata: Record<string, unknown>
}

export interface OnboardingStatus {
  onboarding_completed: boolean
  onboarding_complete?: boolean
  current_step: string
  company_name: string
  has_agents: boolean
  has_integrations: boolean
  has_workflows?: boolean
  has_company_profile?: boolean
}

export interface OnboardingHireResponse {
  agent_id: string
  workflow_id: string
  next_step: string
}

export interface CompanyProfileInput {
  company_name: string
  mission?: string
  industry?: string
  stage?: string
  monthly_revenue: number
  team_size_goal?: number
  primary_tools: string[]
}

export interface CompanyProfile {
  id: string
  user_id: string
  company_name: string
  mission: string | null
  industry: string | null
  stage: string | null
  monthly_revenue: number
  monthly_budget_usd?: number | null
  runway_months: number | null
  primary_tech_stack: string[]
  goals: string[]
  onboarding_complete: boolean
  created_at: string
  updated_at: string | null
}

export interface CompanyState {
  company_profile: CompanyProfile | null
  agents: Agent[]
  workflows: Workflow[]
}

export interface CompanyYamlValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface CompanyYamlPreview {
  agents_to_create: string[]
  agents_to_update: string[]
  agents_unchanged: string[]
  workflows_to_create: string[]
  workflows_to_update: string[]
  validation: CompanyYamlValidation
}

export interface CompanyYamlApplySummary {
  created_agents: string[]
  updated_agents: string[]
  created_workflows: string[]
  updated_workflows: string[]
  errors: string[]
}

export interface BusinessSummary {
  company_profile: {
    id: string
    company_name: string
    mission: string | null
    industry: string | null
    stage: string | null
    monthly_revenue: number
    runway_months: number | null
    goals: string[]
    primary_tech_stack: string[]
    onboarding_complete: boolean
  } | null
  activity: {
    workflows_run_count: number
    success_rate: number
    most_active_agents: string[]
  }
}

export interface UserIntegration {
  id: string
  integration_type: 'github' | 'email_smtp' | 'slack' | 'notion' | 'linear'
  name: string
  is_active: boolean
  last_tested_at: string | null
  last_test_result: string | null
  created_at: string | null
  default_repo?: string | null
}

export type FeedbackType = 'approved' | 'rejected' | 'edited' | 'flagged'

export interface AgentReputation {
  id: string
  agent_id: string
  total_tasks: number
  approved_count: number
  rejected_count: number
  edited_count: number
  approval_rate: number
  avg_edit_distance: number
  specializations: string | null
  learning_notes: ({ note: string; created_at: string } | string)[]
  last_updated: string | null
}

export interface AgentFeedback {
  id: string
  agent_id: string
  execution_id: string
  user_id: string
  feedback_type: FeedbackType
  original_output: string
  edited_output: string | null
  comment: string | null
  task_description: string | null
  created_at: string
}

export interface DashboardSummary {
  company_profile: {
    name: string
    industry: string | null
    stage: string | null
    monthly_revenue: number
    runway_months: number | null
  }
  overview: {
    agents_active: number
    agent_count: number
    tasks_today: number
    pending_approvals: number
    average_trust_score: number
  }
  this_week: {
    workflows_run: number
    success_rate: number
    tasks_completed: number
    artifacts_produced: number
  }
  team_status: {
    agent_id: string
    name: string
    role: string
    role_slug?: string | null
    seniority_level?: number | null
    autonomy_level?: string | null
    trust_score?: number | null
    status: 'working' | 'idle' | 'waiting_approval'
    current_task: string | null
    last_active: string | null
    approval_rate: number | null
  }[]
  pending_attention: {
    id?: string
    type: string
    title: string
    description: string
    priority: 'urgent' | 'normal'
    agent_name: string
    created_at: string | null
    action_url: string | null
  }[]
  recent_artifacts: {
    type: 'github_pr' | 'email' | 'report' | 'document' | string
    title: string
    agent_name: string
    created_at: string | null
    url: string | null
  }[]
  notifications?: {
    unread: number
  }
}

export interface AnalyticsCosts {
  total_cost: number
  by_agent: Record<string, number>
  by_model: Record<string, number>
  by_workflow: Record<string, number>
  daily_breakdown: { date: string; cost: number }[]
  projected_monthly: number
  period_days: number
}

export interface AnalyticsPerformance {
  workflows: {
    workflow_id: string
    workflow_name: string
    runs: number
    success: number
    failed: number
    success_rate: number
    avg_duration_seconds: number
    avg_cost: number
  }[]
  agent_utilization: {
    agent_id: string
    agent_name: string
    utilization_percent: number
    retry_count: number
  }[]
  retry_rates: Record<string, number>
}

export interface AnalyticsTools {
  tools: {
    tool_name: string
    calls: number
    success_rate: number
    avg_duration_ms: number
    error_rate: number
  }[]
  most_expensive_tool_calls: { model: string; cost_usd: number }[]
}

export interface AnalyticsOverview {
  costs: AnalyticsCosts
  workflow_runs: number
  workflow_success_rate: number
  tool_calls: number
  api_calls_last_minute: number
}

export type OrgPlan = 'free' | 'solo' | 'team' | 'business' | 'enterprise'
export type OrgMemberRole = 'owner' | 'admin' | 'member'

export interface Organization {
  id: string
  name: string
  slug: string
  plan: OrgPlan
  owner_user_id: string
  max_members: number
  max_agents: number
  max_workflows: number
  max_monthly_executions: number
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  stripe_subscription_status?: string | null
  stripe_current_period_end?: string | null
  stripe_trial_end?: string | null
  cancellation_date?: string | null
  billing_email?: string | null
  monthly_budget_usd?: number | null
  current_period_executions: number
  timezone: string
  logo_url?: string | null
  custom_domain?: string | null
  is_active: boolean
  created_at: string
  updated_at?: string | null
  role?: OrgMemberRole | null
  member_count?: number | null
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  email: string | null
  full_name: string | null
  role: OrgMemberRole
  invited_by_user_id?: string | null
  joined_at: string
  last_active_at?: string | null
}

export interface OrgInvite {
  id: string
  org_id: string
  email: string
  role: Exclude<OrgMemberRole, 'owner'>
  token?: string
  invited_by_user_id: string
  invited_by?: string | null
  accepted_at?: string | null
  created_at: string
  expires_at: string
  invite_url?: string
}

export interface InviteDetails {
  org_id: string
  org_name: string
  org_slug: string
  email: string
  role: Exclude<OrgMemberRole, 'owner'>
  inviter_name: string
  expires_at: string
}

export interface PlanUsageItem {
  used: number
  limit: number
  percent: number
}

export interface BillingUsageSummary {
  plan: OrgPlan
  members: PlanUsageItem
  agents: PlanUsageItem
  workflows: PlanUsageItem
  executions: PlanUsageItem
  custom_tools: PlanUsageItem
  integrations: PlanUsageItem
  api_keys: PlanUsageItem
  webhooks: PlanUsageItem
  eval_suites: PlanUsageItem
  monthly_budget: PlanUsageItem
  features: Record<string, { allowed: boolean; upgrade_to: OrgPlan | null }>
}

export interface BillingPlan {
  plan: OrgPlan
  price_id: string
  limits: Record<string, string | number | boolean>
  features: Record<string, boolean>
}

export interface BillingPlansResponse {
  publishable_key: string
  plans: BillingPlan[]
}

export interface BillingSubscriptionStatus {
  status: string
  current_plan: OrgPlan | string
  current_period_end: string | null
  cancel_at_period_end: boolean
  trial_end: string | null
  next_invoice_amount: number | null
}

export interface BillingSubscriptionResponse {
  organization: {
    id: string
    name: string
    plan: OrgPlan
  }
  subscription: BillingSubscriptionStatus
  usage: BillingUsageSummary
}

export interface BillingPaymentMethod {
  id: string
  brand: string | null
  last4: string | null
  exp_month: number | null
  exp_year: number | null
  is_default: boolean
}

export interface BillingInvoice {
  id: string
  date: string | null
  amount: number
  status: string
  pdf_url: string | null
}

export interface BillingUpcomingInvoiceLineItem {
  description: string | null
  amount: number
  quantity: number | null
}

export interface BillingUpcomingInvoice {
  amount_due: number
  period_end: string | null
  line_items: BillingUpcomingInvoiceLineItem[]
}

export interface PlanLimitHitDetail {
  detail: string
  code: 'plan_limit_reached'
  resource: string
  current_plan: OrgPlan
}

export type MarketplaceCategory =
  | 'productivity'
  | 'development'
  | 'marketing'
  | 'finance'
  | 'customer_support'
  | 'research'
  | 'hr'
  | 'operations'
  | 'data'
  | 'other'

export type MarketplaceListingType = 'agent' | 'workflow' | 'tool_config' | 'eval_suite'
export type MarketplaceListingStatus = 'draft' | 'pending' | 'published' | 'rejected' | 'archived'

export interface MarketplaceListing {
  id: string
  publisher_user_id: string
  publisher_org_id: string | null
  listing_type: MarketplaceListingType
  category: MarketplaceCategory
  status: MarketplaceListingStatus
  name: string
  slug: string
  tagline: string
  description?: string
  readme?: string | null
  template_data?: Record<string, unknown>
  tags: string[]
  preview_image_url?: string | null
  demo_video_url?: string | null
  source_url?: string | null
  install_count: number
  rating_avg: number
  rating_count: number
  view_count: number
  is_free: boolean
  price_usd: number
  version: string
  created_at: string
  updated_at?: string | null
  published_at?: string | null
  publisher?: { id: string; name: string } | null
  publisher_org?: { id: string; name: string; slug: string } | null
  publisher_other_listing_count?: number
  version_history?: {
    version: string
    status?: string
    published_at?: string | null
    created_at?: string | null
    note?: string
  }[]
  reviews?: MarketplaceReview[]
}

export interface MarketplaceReview {
  id: string
  listing_id: string
  reviewer_user_id: string
  reviewer?: { id: string; name: string } | null
  rating: number
  title?: string | null
  body?: string | null
  helpful_count: number
  created_at: string
}

export interface MarketplaceSearchResponse {
  items: MarketplaceListing[]
  total: number
  limit: number
  offset: number
}

export interface MarketplaceInstall {
  id: string
  installed_resource_id: string | null
  installed_at: string
  listing: MarketplaceListing
  installed_by_current_user: boolean
}

export type ScoringMethod =
  | 'exact_match'
  | 'contains'
  | 'regex'
  | 'llm_judge'
  | 'rouge_l'
  | 'semantic_similarity'
  | 'json_schema'
  | 'custom_function'

export interface EvalSuite {
  id: string
  user_id: string
  agent_id: string
  agent_name?: string | null
  name: string
  description?: string | null
  status: 'draft' | 'active' | 'archived'
  pass_threshold: number
  version: number
  case_count?: number | null
  last_run_score?: number | null
  last_run_passed?: boolean | null
  cases?: EvalCase[]
  created_at: string
  updated_at?: string | null
}

export interface EvalCase {
  id: string
  suite_id: string
  name: string
  description?: string | null
  input: string
  expected_output?: string | null
  scoring_method: ScoringMethod
  scoring_config: Record<string, unknown>
  weight: number
  tags?: string | null
  last_score?: number | null
  created_at: string
}

export interface EvalCaseResult {
  id: string
  run_id: string
  case_id: string
  case?: EvalCase
  actual_output?: string | null
  score?: number | null
  passed?: boolean | null
  scoring_details?: Record<string, unknown>
  error_message?: string | null
  duration_seconds?: number | null
  tokens_used: number
  cost_usd: number
  created_at: string
}

export interface EvalRun {
  id: string
  suite_id: string
  user_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  triggered_by: string
  total_cases: number
  passed_cases: number
  failed_cases: number
  error_cases: number
  suite_score?: number | null
  passed?: boolean | null
  duration_seconds?: number | null
  total_cost_usd: number
  git_commit?: string | null
  notes?: string | null
  created_at: string
  completed_at?: string | null
  results?: EvalCaseResult[] | null
}

export interface EvalRunsResponse {
  runs: EvalRun[]
  score_trend: { date: string; score?: number | null; passed?: boolean | null }[]
}

export interface EvalInsights {
  score_trend: { date: string; score?: number | null; passed?: boolean | null }[]
  hardest_cases: { case_id: string; case_name?: string; failures?: number; avg_score?: number }[]
  most_improved_cases: { case_id: string; case_name?: string; delta: number }[]
  regression_cases: { case_id: string; case_name?: string }[]
}

export interface CompanyChatStreamEvent {
  type: 'meta' | 'text' | 'action' | 'done'
  conversation_id?: string
  content?: string
  action?: {
    type: string
    success?: boolean
    label?: string
    page?: string
    execution_id?: string
    agent_id?: string
    workflow_id?: string
    notification_id?: string
    message?: string
  }
}

export interface Message {
  id: string
  execution_id: string
  from_agent: string
  to_agent: string | null
  content: string
  role: string
  token_count: number
  timestamp: string
  msg_metadata: Record<string, unknown>
}

export interface Stats {
  agents: number
  workflows: number
  executions: number
  active_executions: number
  total_tokens: number
  total_cost: number
  success_rate: number
  ws_connections: number
}

export interface WsEvent {
  type: string
  timestamp: string
  event?: string
  execution_id?: string
  agent?: string
  content?: string
  tool?: string
  input?: string
  output?: string
  error?: string
  tokens?: number
  cost?: number
  workflow?: string
  node_id?: string
  response?: string
  step?: ExecutionStep
  [key: string]: unknown
}

export interface CustomTool {
  id: string
  name: string
  description: string
  code: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Template {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  suggested_agents: {
    role: string
    name: string
    system_prompt: string
    tools: string[]
  }[]
}

export interface Agent {
  id: string
  name: string
  persona_name?: string | null
  client_id?: string | null
  client_name?: string | null
  client_color?: string | null
  role: string
  role_slug?: string | null
  seniority_level?: number
  autonomy_level?: string | null
  trust_score?: number | null
  current_status?: string
  current_task_summary?: string | null
  total_tasks_completed?: number
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

export interface AgentTrustScoreDetail {
  id: string
  agent_id: string
  overall_score: number
  autonomy_level: string
  trajectory: string
  trajectory_delta: number
  skill_scores: Record<string, number>
  eval_pass_rate: number
  eval_runs_count: number
  components: {
    task_success_rate: number
    review_pass_rate: number
    risky_action_rate: number
    on_time_rate: number
    cost_efficiency: number
    eval_pass_rate: number
  }
  counters: {
    total_tasks: number
    successful_tasks: number
    failed_tasks: number
  }
  next_level: {
    level: string
    points_needed: number
  } | null
  autonomy_history: Array<{
    from: string
    to: string
    direction: string
    score_at_change: number
    at: string
  }>
  last_calculated: string | null
}

export interface Client {
  id: string
  name: string
  company_name: string | null
  contact_email: string | null
  description: string | null
  service_type: string | null
  status: 'active' | 'paused' | 'completed'
  color: string
  portal_enabled: boolean
  portal_token: string | null
  created_at: string
  updated_at: string
}

export interface ClientWithStats extends Client {
  agent_count: number
  execution_count_30d: number
  last_activity: string | null
}

export interface ClientDetail extends ClientWithStats {
  org_id: string
  notes: string | null
}

export interface ClientCreateInput {
  name: string
  company_name?: string | null
  contact_email?: string | null
  description?: string | null
  service_type?: string | null
  notes?: string | null
  color?: string | null
}

export interface ClientListResponse {
  clients: ClientWithStats[]
  total: number
}

export interface ClientActivityItem {
  execution_id: string
  agent_name: string | null
  status: string
  input_message_preview: string
  started_at: string | null
}

export interface ClientActivityResponse {
  client_id: string
  activity: ClientActivityItem[]
}

export interface ClientKnowledgeRecord {
  id: string
  org_id: string
  client_id: string
  content: string
  category?: string | null
  confidence: number
  source_agent_id?: string | null
  source_execution_id?: string | null
  created_at: string
  last_seen_at: string
}

export interface ClientIntakeField {
  name: string
  label: string
  type?: 'text' | 'textarea' | 'select'
  required?: boolean
  options?: string[]
}

export interface ClientIntakeFormRecord {
  id: string
  org_id: string
  client_id: string
  client_name?: string | null
  client_company_name?: string | null
  title: string
  workflow_id?: string | null
  fields: ClientIntakeField[]
  token: string
  is_active: boolean
  created_at: string
  public_url: string
}

export interface ClientIntakeSubmissionRecord {
  id: string
  form_id: string
  org_id: string
  submitted_data: Record<string, string>
  execution_id?: string | null
  submitted_at: string
}

export type OrgFileStatus = 'pending' | 'uploading' | 'ready' | 'deleted' | 'error'
export type OrgFileType = 'document' | 'pdf' | 'docx' | 'image' | 'markdown' | 'text' | 'other'

export interface OrgFileRecord {
  id: string
  org_id: string
  client_id?: string | null
  agent_id?: string | null
  execution_id?: string | null
  mission_id?: string | null
  name: string
  description?: string | null
  file_type: OrgFileType
  status: OrgFileStatus
  storage_key?: string | null
  size_bytes: number
  content_type?: string | null
  checksum_sha256?: string | null
  extracted_text?: string | null
  version: number
  parent_file_id?: string | null
  is_latest: boolean
  collab_room?: string | null
  yjs_storage_key?: string | null
  tags: string[]
  created_by?: string | null
  created_at: string
  updated_at: string
  last_accessed_at?: string | null
  download_url?: string | null
}

export interface OrgFileListResponse {
  files: OrgFileRecord[]
  total: number
  limit: number
  offset: number
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

export interface WorkflowInputVariable {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number'
  required: boolean
  default?: string
  options?: string[]
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
  schedule_enabled?: boolean
  schedule_timezone?: string
  last_run_at?: string | null
  requires_review?: boolean
  input_template?: string
  input_variables?: WorkflowInputVariable[]
  configured_inputs?: Record<string, unknown>
  template_id: string | null
  execution_mode: 'sequential' | 'orchestrator'
  orchestration_prompt: string
  max_cycles: number
  created_at: string
  updated_at: string
}

export interface ScheduledWorkflow {
  workflow_id: string
  name: string
  schedule: string
  schedule_enabled: boolean
  schedule_timezone: string
  next_run_at?: string | null
  last_run_at?: string | null
}

export interface AutomationTemplate {
  id: string
  name: string
  cron: string
  description: string
  enabled: boolean
  workflow_id?: string | null
}

export interface WorkflowWebhookUrl {
  workflow_id: string
  webhook_url: string
  curl_example: string
}

export type MissionStatus = 'planning' | 'active' | 'paused' | 'completed' | 'failed'
export type MissionTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface MissionTask {
  id: string
  mission_id: string
  org_id: string
  sequence: number
  title: string
  description?: string | null
  agent_id?: string | null
  depends_on?: string | null
  status: MissionTaskStatus
  output_summary?: string | null
  execution_id?: string | null
  started_at?: string | null
  completed_at?: string | null
}

export interface MissionStats {
  total: number
  pending: number
  running: number
  completed: number
  failed: number
  skipped: number
}

export interface Mission {
  id: string
  org_id: string
  client_id?: string | null
  client_name?: string | null
  goal: string
  title?: string | null
  status: MissionStatus
  report?: string | null
  report_delivered: boolean
  created_by?: string | null
  created_at: string
  completed_at?: string | null
  stats: MissionStats
  tasks: MissionTask[]
}

export interface MissionReportResponse {
  mission_id: string
  status: MissionStatus
  report?: string | null
}

export type A2ATaskStatus = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed'
export type A2ATaskDirection = 'incoming' | 'outgoing'

export interface A2ATaskRecord {
  id: string
  agent_id: string
  agent_name: string
  direction: A2ATaskDirection
  external_agent_id?: string | null
  external_agent_name?: string | null
  status: A2ATaskStatus
  caller_identity?: string | null
  input_text: string
  output_text?: string | null
  execution_id?: string | null
  payment_amount?: number | null
  payment_currency?: string | null
  created_at: string
  completed_at?: string | null
  duration_seconds?: number | null
}

export interface A2ATasksResponse {
  enabled: boolean
  active_count: number
  tasks: A2ATaskRecord[]
}

export interface ExternalAgentRecord {
  id: string
  agent_card_url: string
  name: string
  description?: string | null
  provider_name?: string | null
  provider_url?: string | null
  task_endpoint: string
  skills: Array<Record<string, unknown>>
  trust_status: 'pending' | 'trusted' | 'blocked'
  agent_did?: string | null
  tool_name: string
  total_calls: number
  successful_calls: number
  total_cost_usd: number
  has_api_key: boolean
  added_at: string
  last_used_at?: string | null
}

export interface ExternalAgentsResponse {
  items: ExternalAgentRecord[]
}

export interface NotificationPreference {
  email_on_approval_needed: boolean
  email_on_execution_complete: boolean
  email_on_autonomy_change: boolean
  daily_digest_enabled: boolean
  daily_digest_time: string
  notification_email?: string | null
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
  client_id?: string | null
  client_name?: string | null
  parent_execution_id?: string | null
  workflow_name?: string
  agent_name?: string
  model_name?: string
  duration_seconds?: number | null
  trigger: string
  status: 'pending' | 'running' | 'pending_review' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval' | 'rejected' | 'timed_out'
  input?: string
  input_message: string
  output?: string | null
  output_message: string
  revision_number?: number
  ceo_feedback?: string | null
  started_at: string
  completed_at: string | null
  approved_by?: string | null
  approved_at?: string | null
  approval_note?: string | null
  delivered_at?: string | null
  delivery_method?: 'email' | 'google_doc' | 'portal' | null
  delivery_target?: string | null
  token_count: number
  cost: number
  error: string | null
  status_label?: string
  review_state?: 'needs_review' | null
  review_stage?: 'final_review' | 'workflow_pause' | null
  requires_ceo_action?: boolean
  messages: Message[]
  steps?: ExecutionStep[]
}

export interface ExecutionDeliveryResponse {
  delivered: boolean
  method: 'email' | 'google_doc' | 'portal'
  target: string
  delivered_at: string
}

export interface ExecutionStep {
  id: string
  execution_id: string
  org_id: string
  step_type: 'thought' | 'action' | 'observation' | 'tool_call' | 'final_answer' | 'speaking' | 'update' | 'error' | 'human_input_required' | 'retry'
  content: string
  tool_name?: string | null
  tool_input?: unknown
  tool_output?: unknown
  tool_success?: boolean | null
  step_index: number
  duration_ms?: number | null
  tokens_used?: number | null
  timestamp?: string
  agent_id?: string | null
  agent_name?: string | null
  created_at: string
}

export interface ExecutionRunResponse {
  execution_id: string
  status: string
  websocket_channel: string
  message: string
}

export interface ExecutionRegenerateResponse {
  revision_id: string
  revision_number: number
  status: string
}

export interface ExecutionRevisionSummary {
  id: string
  revision_number: number
  status: string
  status_label?: string
  review_state?: 'needs_review' | null
  review_stage?: 'final_review' | 'workflow_pause' | null
  requires_ceo_action?: boolean
  ceo_feedback?: string | null
  output?: string | null
  started_at: string
  approved_at?: string | null
  approved_by?: string | null
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

export interface AgentApprovalRequestItem {
  id: string
  title: string
  description: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  approval_type: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  execution_id?: string | null
  decision_note?: string | null
  decided_by?: string | null
  decided_at?: string | null
  expires_in_minutes: number | null
  expires_at?: string | null
  created_at: string
  agent: {
    id: string
    name: string | null
    persona_name: string | null
    role: string | null
    role_slug: string | null
    trust_score: number | null
  }
}

export interface AgentApprovalRequestsResponse {
  pending_count: number
  requests: AgentApprovalRequestItem[]
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

export interface AgentPreference {
  id: string
  agent_id: string
  org_id: string
  content_preview?: string | null
  memory_type: string
  importance_score: number
  always_inject: boolean
  source?: string | null
  created_at: string
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
  latest_agent_id?: string | null
  latest_workflow_id?: string | null
  latest_execution_id?: string | null
  latest_execution_status?: string | null
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
  integration_type: 'github' | 'email_smtp' | 'gmail' | 'slack' | 'search_api' | 'notion' | 'linear'
  name: string
  connected_account?: string | null
  is_supported?: boolean
  support_note?: string | null
  needs_reauth?: boolean
  reauth_reason?: string | null
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
    status_label?: string
    requires_ceo_action?: boolean
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

export interface AgencyOverviewClient {
  id: string
  name: string
  company_name?: string | null
  color: string
  status: 'active' | 'paused' | 'completed'
  agent_count: number
  executions_today: number
  last_activity: string | null
}

export interface AgencyOverviewAgent {
  id: string
  name: string
  persona_name?: string | null
  role: string
  role_slug?: string | null
  current_status: string
  current_status_label?: string
  requires_ceo_action?: boolean
  current_task_summary?: string | null
  client_id?: string | null
  client_name?: string | null
  client_color?: string | null
  trust_score?: number | null
  tasks_completed: number
}

export interface AgencyOverviewApproval {
  id: string
  type: 'agent' | 'human'
  title: string
  risk_level: 'low' | 'medium' | 'high' | 'critical' | string
  agent_name: string
  created_at: string | null
}

export interface AgencyOverviewActivity {
  id: string
  client_id?: string | null
  client_name?: string | null
  agent_name: string
  status: string
  status_label?: string
  review_state?: 'needs_review' | null
  review_stage?: 'final_review' | 'workflow_pause' | null
  requires_ceo_action?: boolean
  started_at: string | null
  input_preview: string
}

export interface AgencyOverviewAttentionItem {
  type: 'pending_review' | 'approval_request' | 'failed'
  urgency: 'critical' | 'high' | 'medium' | 'low' | string
  title: string
  subtitle: string
  client_name?: string | null
  execution_id?: string | null
  approval_id?: string | null
  status?: string
  status_label?: string
  review_state?: 'needs_review' | null
  review_stage?: 'final_review' | 'workflow_pause' | null
  requires_ceo_action?: boolean
  age_minutes: number
  url: string
}

export interface AgencyOverview {
  agency_name: string
  owner_user_id: string
  generated_at: string
  clients: {
    total: number
    active: number
    with_activity_today: number
    list: AgencyOverviewClient[]
  }
  agents: {
    total: number
    working: number
    idle: number
    list: AgencyOverviewAgent[]
  }
  approvals: {
    pending: number
    critical: number
    list: AgencyOverviewApproval[]
  }
  activity: {
    executions_today: number
    completed_today: number
    recent: AgencyOverviewActivity[]
  }
  needs_attention: AgencyOverviewAttentionItem[]
  attention_count: number
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
  executions_this_week: number
  completed_this_week: number
  failed_this_week: number
  daily_executions: { date: string; count: number }[]
  total_approved: number
  first_draft_approved: number
  first_draft_rate: number
  avg_revisions: number
  pending_review_count: number
  tool_calls: number
  api_calls_last_minute: number
}

export type OrgMemberRole = 'owner' | 'admin' | 'member'

export interface Organization {
  id: string
  name: string
  slug: string
  plan: string
  owner_user_id: string
  max_members: number
  max_agents: number
  max_workflows: number
  max_monthly_executions: number
  monthly_budget_usd?: number | null
  current_period_executions: number
  timezone: string
  logo_url?: string | null
  agent_message_retention_days?: number | null
  custom_domain?: string | null
  is_active: boolean
  created_at: string
  updated_at?: string | null
  role?: OrgMemberRole | null
  member_count?: number | null
}

export interface OrgVariableRecord {
  id: string
  org_id: string
  key: string
  value: string
  description?: string | null
  created_at: string
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
  model_config_id?: string | null
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
  cost_usd?: number
  git_commit?: string | null
  notes?: string | null
  comparison_group_id?: string | null
  comparison_slot?: string | null
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

export interface EvalModelComparisonSide {
  model_config_id: string
  model_name: string
  display_name?: string
  pass_rate: number
  avg_duration_seconds: number
  cost_usd: number
  run_id: string
}

export interface EvalModelComparisonResult {
  suite_id: string
  comparison_group_id?: string
  model_a: EvalModelComparisonSide
  model_b: EvalModelComparisonSide
  winner: 'model_a' | 'model_b' | null
  winner_reason: string
}

export interface EvalModelComparisonHistoryItem {
  comparison_group_id: string
  created_at: string
  model_a: EvalModelComparisonSide
  model_b: EvalModelComparisonSide
  winner: 'model_a' | 'model_b' | null
  winner_label: string
  pass_rates: {
    model_a: number
    model_b: number
  }
}

export interface EvalModelComparisonHistoryResponse {
  comparisons: EvalModelComparisonHistoryItem[]
}

export interface EvalQuickTestResponse {
  suite_id: string
  run_id: string
  pass_rate: number
  passed: number
  total: number
}

export interface AgentStatus {
  name: string
  role: string
  status: string
  task: string
  trust_score: number
}

export interface ChatActionResult {
  type: string
  success: boolean
  label?: string
  message?: string
  page?: string
  execution_id?: string
  agent_id?: string
  agent_name?: string
  workflow_id?: string
  notification_id?: string
  agent_statuses?: AgentStatus[]
  summary?: string
  insight?: string
  insight_type?: string
  explanation?: string
  analysis?: string
  filename?: string
  data?: Record<string, unknown>
  execution_count?: number
  active_count?: number
  status?: string
  mission_id?: string
  mission_title?: string
  task_count?: number
}

export interface CompanyChatStreamEvent {
  type: 'meta' | 'text' | 'action' | 'done' | 'typing'
  conversation_id?: string
  content?: string
  action?: ChatActionResult
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

export interface CTOTaskSummary {
  id: string
  org_id?: string
  request?: string
  original_request: string
  plan?: string | null
  status: 'active' | 'monitoring' | 'waiting_ceo' | 'complete' | 'failed'
  mission_id?: string | null
  execution_ids?: string[]
  conversation_id?: string | null
  outcome_summary?: string | null
  ceo_action_needed?: string | null
  completion_notified?: boolean
  created_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
}

export interface CTOMemoryRecord {
  id: string
  memory_type: string
  content: string
  entity_name?: string | null
  entity_type?: string | null
  confidence?: number
  observation_count?: number
  source?: string | null
  created_at?: string | null
  last_seen_at?: string | null
}

export interface CTOAuthoritySettings {
  auto_approve_portal: boolean
  auto_approve_patterns: boolean
  auto_run_workflows: boolean
  auto_create_missions: boolean
  max_auto_spend_usd: number
  auto_approve_action_types: string[]
}

export interface InboxMessage {
  id: string
  org_id?: string | null
  from_agent_id?: string | null
  to_agent_id?: string | null
  from_agent_name: string
  from_agent_persona?: string | null
  to_agent_name: string
  to_agent_persona?: string | null
  execution_id?: string | null
  message: string
  message_type: string
  thread_id?: string | null
  parent_message_id?: string | null
  is_resolved: boolean
  resolved_at?: string | null
  requires_human: boolean
  priority: 'low' | 'normal' | 'high' | 'urgent'
  read_at?: string | null
  response?: string | null
  delivered_at?: string | null
  responded_at?: string | null
  created_at: string
}

export interface CEOInboxResponse {
  unread_count: number
  retention_days?: number | null
  messages: InboxMessage[]
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

// ── Direct Messaging types ────────────────────────────────────────────────

export interface DirectMessage {
  id: string
  content: string
  sender_type: 'agent' | 'ceo'
  sender_name: string
  message_type: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  is_resolved: boolean
  read_at: string | null
  created_at: string
  scheduled_reply_at: string | null
  scheduled_reply_job_id: string | null
  thread_id: string | null
  parent_message_id: string | null
  execution_id: string | null
  from_agent_id: string | null
  to_agent_id: string | null
}

export interface ConversationSummary {
  agent_id: string
  agent_name: string
  persona_name: string | null
  role_slug: string | null
  role_color: string
  last_message: string | null
  last_message_at: string | null
  last_sender_type: 'agent' | 'ceo' | null
  unread_count: number
  is_online: boolean
  current_status: string
}

export interface ConversationsResponse {
  conversations: ConversationSummary[]
  total_unread: number
}

export interface ThreadResponse {
  agent: {
    id: string
    name: string
    persona_name: string | null
    role_slug: string | null
    role_color: string
    current_status: string
    current_task_summary: string | null
    trust_score: number
  }
  messages: DirectMessage[]
  has_more: boolean
  oldest_at: string | null
}

export interface TeamConversation {
  from_agent: { id: string; name: string; persona_name: string | null }
  to_agent: { id: string; name: string; persona_name: string | null }
  message_type: string
  content_preview: string
  created_at: string | null
  is_resolved: boolean
}

export interface CompanyConversationSummary {
  id: string
  title: string
  created_at: string | null
  last_message_at: string | null
  message_count: number
  pinned: boolean
}

export interface CompanyConversationListResponse {
  conversations: CompanyConversationSummary[]
}

export interface CompanyConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  actions?: ChatActionResult[]
  attachments?: Array<Record<string, unknown>>
  created_at?: string | null
  is_proactive?: boolean
}

export interface CompanyConversationDetailResponse {
  conversation: CompanyConversationSummary
  messages: CompanyConversationMessage[]
}

export interface CompanyConversationSearchResponse {
  results: Array<{
    conversation_id: string
    title: string
    message_preview: string
    created_at: string | null
  }>
}

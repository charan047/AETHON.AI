export interface Agent {
  id: string
  name: string
  role: string
  description: string
  system_prompt: string
  model: string
  tools: string[]
  memory_enabled: boolean
  memory_window: number
  max_tokens: number
  temperature: number
  max_iterations: number
  timeout: number
  telegram_enabled: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    agent_id?: string
    role?: string
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
  template_id: string | null
  execution_mode: 'sequential' | 'orchestrator'
  orchestration_prompt: string
  created_at: string
  updated_at: string
}

export interface Execution {
  id: string
  workflow_id: string
  trigger: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input_message: string
  output_message: string
  started_at: string
  completed_at: string | null
  token_count: number
  cost: number
  error: string | null
  messages: Message[]
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

import axios from 'axios'
import type { Agent, Workflow, Execution, Stats, Template } from '../types'

const api = axios.create({ baseURL: '/api' })

// Agents
export const agentsApi = {
  list: () => api.get<Agent[]>('/agents').then(r => r.data),
  get: (id: string) => api.get<Agent>(`/agents/${id}`).then(r => r.data),
  create: (data: Partial<Agent>) => api.post<Agent>('/agents', data).then(r => r.data),
  update: (id: string, data: Partial<Agent>) => api.put<Agent>(`/agents/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  getModels: () => api.get<{id: string; name: string; provider: string}[]>('/agents/meta/models').then(r => r.data),
  getTools: () => api.get<{id: string; name: string; description: string}[]>('/agents/meta/tools').then(r => r.data),
}

// Workflows
export const workflowsApi = {
  list: () => api.get<Workflow[]>('/workflows').then(r => r.data),
  get: (id: string) => api.get<Workflow>(`/workflows/${id}`).then(r => r.data),
  create: (data: Partial<Workflow>) => api.post<Workflow>('/workflows', data).then(r => r.data),
  update: (id: string, data: Partial<Workflow>) => api.put<Workflow>(`/workflows/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  getTemplates: () => api.get<Template[]>('/workflows/templates').then(r => r.data),
}

// Executions
export const executionsApi = {
  list: (workflowId?: string) =>
    api.get<Execution[]>('/executions', { params: { workflow_id: workflowId } }).then(r => r.data),
  get: (id: string) => api.get<Execution>(`/executions/${id}`).then(r => r.data),
  run: (workflowId: string, input: string) =>
    api.post<Execution>(`/executions/workflows/${workflowId}/run`, { input_message: input }).then(r => r.data),
  getMessages: (id: string) =>
    api.get(`/executions/${id}/messages`).then(r => r.data),
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

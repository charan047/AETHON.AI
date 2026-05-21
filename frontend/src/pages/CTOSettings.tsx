import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, X, Zap } from 'lucide-react'
import { ctoApi, extractApiError } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import { GlassCard } from '../components/ui/GlassCard'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { CTOAuthoritySettings, CTOMemoryRecord, CTOTaskSummary } from '../types'

const DEFAULT_AUTHORITY: CTOAuthoritySettings = {
  auto_approve_portal: true,
  auto_approve_patterns: false,
  auto_run_workflows: true,
  auto_create_missions: true,
  max_auto_spend_usd: 0,
  auto_approve_action_types: [],
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={checked ? 'flex h-6 w-11 items-center rounded-full bg-indigo-500/80 px-0.5 transition-all duration-200' : 'flex h-6 w-11 items-center rounded-full bg-white/[0.10] px-0.5 transition-all duration-200'}
    >
      <span
        className={checked ? 'h-5 w-5 translate-x-5 rounded-full bg-white transition-transform duration-200' : 'h-5 w-5 translate-x-0 rounded-full bg-white transition-transform duration-200'}
      />
    </button>
  )
}

function taskRequest(task: CTOTaskSummary) {
  return task.original_request || task.request || 'Untitled CTO task'
}

function taskStatusDot(status: CTOTaskSummary['status']) {
  if (status === 'monitoring') return <div className="status-dot dot-blue dot-live" />
  if (status === 'waiting_ceo') return <div className="status-dot dot-amber dot-live" />
  if (status === 'complete') return <div className="status-dot dot-emerald" />
  if (status === 'failed') return <div className="status-dot dot-red" />
  return <div className="status-dot dot-blue" />
}

function memoryBadgeTone(memoryType: string) {
  if (memoryType === 'approval_pattern') return 'badge-amber'
  if (memoryType === 'client_preference' || memoryType === 'delivery_preference') return 'badge-indigo'
  if (memoryType === 'workflow_learning') return 'badge-emerald'
  return 'badge-glass'
}

export function CTOSettings() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [authorityDraft, setAuthorityDraft] = useState<CTOAuthoritySettings>(DEFAULT_AUTHORITY)
  const [manualMemory, setManualMemory] = useState('')

  const authorityQuery = useQuery({
    queryKey: ['cto-authority'],
    queryFn: ctoApi.getAuthority,
    enabled: auth.isAuthenticated && Boolean(auth.activeOrg?.id),
  })
  const memoriesQuery = useQuery({
    queryKey: ['cto-memories'],
    queryFn: ctoApi.getMemories,
    enabled: auth.isAuthenticated && Boolean(auth.activeOrg?.id),
  })
  const tasksQuery = useQuery({
    queryKey: ['cto-tasks'],
    queryFn: ctoApi.getTasks,
    enabled: auth.isAuthenticated && Boolean(auth.activeOrg?.id),
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (authorityQuery.data) {
      setAuthorityDraft({ ...DEFAULT_AUTHORITY, ...authorityQuery.data })
    }
  }, [authorityQuery.data])

  const saveAuthority = useMutation({
    mutationFn: () => ctoApi.updateAuthority(authorityDraft),
    onSuccess: async updated => {
      setAuthorityDraft({ ...DEFAULT_AUTHORITY, ...updated })
      await queryClient.invalidateQueries({ queryKey: ['cto-authority'] })
      toast.success('CTO authority saved')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const addMemory = useMutation({
    mutationFn: () =>
      ctoApi.addMemory({
        memory_type: 'general',
        content: manualMemory.trim(),
      }),
    onSuccess: async () => {
      setManualMemory('')
      await queryClient.invalidateQueries({ queryKey: ['cto-memories'] })
      toast.success('CTO memory saved')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deleteMemory = useMutation({
    mutationFn: (id: string) => ctoApi.deleteMemory(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cto-memories'] })
      toast.success('CTO memory removed')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const updateTask = useMutation({
    mutationFn: (taskId: string) =>
      ctoApi.updateTask(taskId, {
        status: 'complete',
        outcome_summary: 'Closed manually from CTO settings',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cto-tasks'] })
      toast.success('CTO task updated')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const isLoading = authorityQuery.isLoading || memoriesQuery.isLoading || tasksQuery.isLoading
  const isError = authorityQuery.isError || memoriesQuery.isError || tasksQuery.isError
  const memories = memoriesQuery.data || []
  const tasks = tasksQuery.data || []

  const authorityRows = useMemo(() => ([
    {
      key: 'auto_approve_portal' as const,
      title: 'Auto-approve portal deliveries',
      detail: 'CTO can deliver completed work to client portals automatically',
    },
    {
      key: 'auto_run_workflows' as const,
      title: 'Run workflows automatically',
      detail: 'CTO can start workflows without confirmation',
    },
    {
      key: 'auto_create_missions' as const,
      title: 'Create missions',
      detail: 'CTO can plan and start multi-step missions',
    },
    {
      key: 'auto_approve_patterns' as const,
      title: 'Learn from approval patterns',
      detail: 'After you approve the same action 3+ times, CTO can approve it automatically',
    },
  ]), [])

  if (!auth.activeOrg) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div className="glass-card max-w-md p-8">
          <Zap className="mx-auto text-[#4B5A73]" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">No organization selected</h1>
          <p className="mt-2 text-sm text-[#8B9DBE]">Create or switch into an organization before configuring the CTO.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="page-header rounded-[24px] border border-white/[0.06] bg-white/[0.02]">
        <div>
          <h1 className="page-title">CTO Settings</h1>
          <p className="page-subtitle">Configure your agency operator</p>
        </div>
      </div>

      {isLoading ? (
        <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
          <div className="flex items-center gap-3 text-sm text-[#8B9DBE]">
            <Loader2 size={16} className="animate-spin" />
            Loading CTO settings…
          </div>
        </GlassCard>
      ) : isError ? (
        <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
          <div className="text-sm text-red-200">Could not load CTO settings right now.</div>
        </GlassCard>
      ) : (
        <>
          <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
            <div className="section-title">AUTHORITY</div>
            <p className="mb-5 text-sm text-[#8B9DBE]">What the CTO can do without asking you first</p>

            <div className="space-y-3">
              {authorityRows.map(item => (
                <div key={item.key} className="data-row min-h-[56px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    <div className="text-xs text-[#8B9DBE]">{item.detail}</div>
                  </div>
                  <ToggleSwitch
                    checked={Boolean(authorityDraft[item.key])}
                    onChange={() => setAuthorityDraft(current => ({ ...current, [item.key]: !current[item.key] }))}
                    label={item.title}
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button className="btn-primary" disabled={saveAuthority.isPending} onClick={() => saveAuthority.mutate()}>
                {saveAuthority.isPending ? 'Saving…' : 'Save Authority'}
              </button>
            </div>
          </GlassCard>

          <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
            <div className="section-title">CTO Memory</div>
            <p className="mb-5 text-sm text-[#8B9DBE]">Learnings the CTO carries into every conversation</p>

            <div className="space-y-2">
              {memories.length === 0 ? (
                <p className="text-sm text-[#8B9DBE]">The CTO will build its memory as it handles tasks for you.</p>
              ) : (
                memories.map((memory: CTOMemoryRecord) => (
                  <div key={memory.id} className="flex items-start gap-2 rounded-lg border border-white/[0.07] px-3 py-2">
                    <span className={`badge ${memoryBadgeTone(memory.memory_type)}`}>
                      {memory.memory_type.replace(/_/g, ' ')}
                    </span>
                    <div className="min-w-0 flex-1 text-sm text-ink-secondary">{memory.content}</div>
                    <button
                      type="button"
                      aria-label={`Delete memory ${memory.content}`}
                      onClick={() => deleteMemory.mutate(memory.id)}
                      className="btn-icon h-8 w-8 text-ink-muted transition hover:bg-red-500/10 hover:text-red-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex items-end gap-3">
              <div className="flex-1">
                <FloatingField
                  label="The CTO should know that..."
                  type="text"
                  value={manualMemory}
                  onChange={setManualMemory}
                />
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={!manualMemory.trim() || addMemory.isPending}
                onClick={() => addMemory.mutate()}
              >
                {addMemory.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </GlassCard>

          <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
            <div className="section-title">ACTIVE TASKS</div>
            <p className="mb-5 text-sm text-[#8B9DBE]">What the CTO is currently handling</p>

            <div className="space-y-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-[#8B9DBE]">No active CTO tasks right now.</p>
              ) : (
                tasks.map((task: CTOTaskSummary) => (
                  <div key={task.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 shrink-0">{taskStatusDot(task.status)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{taskRequest(task)}</p>
                        {task.plan && (
                          <p className="mt-2 text-xs leading-5 text-[#8B9DBE]">{task.plan}</p>
                        )}
                        {task.ceo_action_needed && (
                          <p className="mt-2 text-xs text-amber-400">Needs you: {task.ceo_action_needed}</p>
                        )}
                        {task.outcome_summary && (
                          <p className="mt-2 text-xs text-emerald-400">{task.outcome_summary}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <span className="badge badge-glass">{task.status.replace(/_/g, ' ')}</span>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={updateTask.isPending || task.status === 'complete'}
                            onClick={() => updateTask.mutate(task.id)}
                          >
                            {updateTask.isPending ? 'Updating…' : 'Mark Complete'}
                          </button>
                          {task.conversation_id && (
                            <Link to={`/company-chat/${task.conversation_id}`} className="text-xs font-medium text-indigo-300 transition hover:text-indigo-200">
                              View conversation
                            </Link>
                          )}
                        </div>
                      </div>
                      {task.status === 'complete' && <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-400" />}
                    </div>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </>
      )}
    </div>
  )
}

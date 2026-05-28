import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Trash2, X } from 'lucide-react'
import { agentsApi, memoryApi } from '../../api/client'
import type { Agent } from '../../types'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { toast } from '../../lib/toast'
import { AnimatedNumber } from '../ui/AnimatedNumber'

function roleAccent(roleSlug?: string | null) {
  switch (roleSlug) {
    case 'customer_support':
      return { bg: 'rgba(16,185,129,0.22)', dot: 'dot-green' }
    case 'documentation_agent':
      return { bg: 'rgba(139,92,246,0.22)', dot: 'dot-blue' }
    case 'product_manager':
    case 'chief_of_staff':
      return { bg: 'rgba(245,158,11,0.22)', dot: 'dot-amber' }
    default:
      return { bg: 'rgba(99,102,241,0.22)', dot: 'dot-blue' }
  }
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-'
}

export function AgentMemoryPanel({ agent, onClose }: { agent: Agent; onClose?: () => void }) {
  const qc = useQueryClient()
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [showAddPreference, setShowAddPreference] = useState(false)
  const [manualPreference, setManualPreference] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { data: stats } = useQuery({ queryKey: ['memory', agent.id, 'stats'], queryFn: () => memoryApi.stats(agent.id) })
  const { data: history = [] } = useQuery({ queryKey: ['memory', agent.id, 'history'], queryFn: () => memoryApi.history(agent.id, 10) })
  const { data: preferences = [] } = useQuery({ queryKey: ['agent-preferences', agent.id], queryFn: () => agentsApi.getPreferences(agent.id) })
  const { data: memoryStatus } = useQuery({ queryKey: ['memory-status'], queryFn: memoryApi.status })

  useEffect(() => {
    if (showAddPreference) {
      inputRef.current?.focus()
    }
  }, [showAddPreference])

  const clearMemory = useMutation({
    mutationFn: () => memoryApi.clearAgent(agent.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['memory', agent.id] })
      setConfirmClearOpen(false)
      toast.success(`Deleted ${result.deleted} memories`)
    },
    onError: () => toast.error('Failed to clear memory'),
  })

  const addPreference = useMutation({
    mutationFn: () => agentsApi.addPreference(agent.id, manualPreference.trim()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['agent-preferences', agent.id] })
      setManualPreference('')
      setShowAddPreference(false)
      toast.success('Preference added')
    },
    onError: () => toast.error('Failed to add preference'),
  })

  const deletePreference = useMutation({
    mutationFn: (memoryId: string) => agentsApi.deletePreference(agent.id, memoryId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['agent-preferences', agent.id] })
      toast.success('Preference removed')
    },
    onError: () => toast.error('Failed to remove preference'),
  })

  const accent = roleAccent(agent.role_slug)
  const tasksCount = stats?.session_count ?? 0
  const preferencesCount = preferences.length
  const displayName = (agent.persona_name || agent.name || 'Agent').trim() || 'Agent'

  return (
    <>
      <div className="space-y-5">
        <div className="surface-card overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-white"
                  style={{ background: accent.bg }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-[var(--t1)]">{displayName}</h2>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="badge badge-glass">{agent.role || agent.role_slug || 'Agent'}</span>
                  </div>
                </div>
              </div>
              {onClose ? (
                <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
              ) : null}
            </div>
          </div>

          <div className="space-y-5 p-5">
            {!memoryStatus?.mem0_configured ? (
              <div className="card card-amber px-4 py-4 text-sm text-amber-100">
                <div className="mb-1 font-semibold text-amber-200">mem0 is not configured.</div>
                <div>Agent memories will stay limited until MEM0_API_KEY is configured.</div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="card p-4">
                <div className="font-mono text-2xl font-bold text-white"><AnimatedNumber value={stats?.total_memories ?? 0} /></div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--t3)]">Memories</div>
              </div>
              <div className="card p-4">
                <div className="font-mono text-2xl font-bold text-white"><AnimatedNumber value={tasksCount} /></div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--t3)]">Tasks</div>
              </div>
              <div className="card p-4">
                <div className="font-mono text-2xl font-bold text-white"><AnimatedNumber value={preferencesCount} /></div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--t3)]">Preferences</div>
              </div>
            </div>

            <div className="card p-4">
              <div className="section-title">CEO Preferences</div>
              <p className="mb-3 text-xs text-[var(--t2)]">
                Instructions this agent should always follow in future runs.
              </p>
              <div className="flex flex-wrap gap-2">
                {preferences.length ? preferences.map(preference => (
                  <span
                    key={preference.id}
                    className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300"
                  >
                    <span className="max-w-[320px] truncate">{preference.content_preview || 'Untitled preference'}</span>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-blue-300/70 transition-colors hover:text-red-300"
                      onClick={() => deletePreference.mutate(preference.id)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )) : (
                  <div className="w-full rounded-2xl border border-dashed border-[var(--border)] px-4 py-5 text-center text-xs text-[var(--t3)]">
                    No standing preferences yet. Add one below or approve a run with feedback.
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {showAddPreference ? (
                  <input
                    ref={inputRef}
                    value={manualPreference}
                    onChange={event => setManualPreference(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        if (manualPreference.trim().length >= 5) addPreference.mutate()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setShowAddPreference(false)
                        setManualPreference('')
                      }
                    }}
                    placeholder="The CTO should know that..."
                    className="input"
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  {!showAddPreference ? (
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => setShowAddPreference(true)}
                    >
                      + Add
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn-primary text-xs"
                        disabled={manualPreference.trim().length < 5 || addPreference.isPending}
                        onClick={() => addPreference.mutate()}
                      >
                        {addPreference.isPending ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => {
                          setShowAddPreference(false)
                          setManualPreference('')
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="card p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="section-title mb-0">Recent Memories</div>
                  <p className="mt-1 text-xs text-[var(--t2)]">
                    What this agent has learned recently while working.
                  </p>
                </div>
                <button
                  className="btn-danger btn-sm"
                  onClick={() => setConfirmClearOpen(true)}
                >
                  <Trash2 size={14} /> Clear
                </button>
              </div>

              <div className="space-y-3">
                {history.length ? history.map((memory, index) => (
                  <div key={index} className="card p-3">
                    <div className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--t1)]">
                      {memory.content}
                    </div>
                    <div className="mt-2 font-mono text-xs text-[var(--t3)]">
                      {formatDate(String(memory.metadata?.timestamp || ''))}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--t3)]">
                    Run this agent to build memories
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        title={`Clear ${agent.name}'s memory?`}
        description="This deletes stored memories for this agent. Future runs will no longer have access to those past interactions."
        confirmLabel="Clear memory"
        loading={clearMemory.isPending}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => clearMemory.mutate()}
      />
    </>
  )
}

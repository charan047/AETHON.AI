import { useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock3, GitCompareArrows, RotateCcw, X } from 'lucide-react'
import { extractApiError, workflowsApi } from '../../api/client'
import type { Workflow, WorkflowVersion, WorkflowVersionDetail } from '../../types'
import { AgentAvatar } from '../ui/AgentAvatar'
import { SkeletonCard } from '../ui/Skeleton'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { toast } from '../../lib/toast'

interface VersionHistoryProps {
  workflow: Partial<Workflow>
  open: boolean
  onClose: () => void
  onRestored: (workflow: Workflow) => void
}

function relativeTime(value: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function DiffSummary({ diff }: { diff: Awaited<ReturnType<typeof workflowsApi.diff>> | undefined }) {
  if (!diff) return null

  const rows = [
    { label: 'Nodes added', value: diff.nodes_added.length, tone: 'text-emerald-300' },
    { label: 'Nodes removed', value: diff.nodes_removed.length, tone: 'text-red-300' },
    { label: 'Nodes changed', value: diff.nodes_modified.length, tone: 'text-amber-300' },
    { label: 'Edges added', value: diff.edges_added.length, tone: 'text-emerald-300' },
    { label: 'Edges removed', value: diff.edges_removed.length, tone: 'text-red-300' },
    { label: 'Settings changed', value: Object.keys(diff.settings_changed).length, tone: 'text-indigo-300' },
  ]

  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(row => (
        <div key={row.label} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <div className={`text-lg font-semibold ${row.tone}`}>{row.value}</div>
          <div className="text-[11px] text-obsidian-500">{row.label}</div>
        </div>
      ))}
    </div>
  )
}

export function VersionHistory({ workflow, open, onClose, onRestored }: VersionHistoryProps) {
  const workflowId = workflow.id || ''
  const queryClient = useQueryClient()
  const [selectedVersion, setSelectedVersion] = useState<WorkflowVersion | null>(null)
  const [diffVersion, setDiffVersion] = useState<WorkflowVersion | null>(null)
  const [restoreVersion, setRestoreVersion] = useState<WorkflowVersion | null>(null)

  const versionsQuery = useQuery({
    queryKey: ['workflow-versions', workflowId],
    queryFn: () => workflowsApi.versions(workflowId),
    enabled: open && Boolean(workflowId),
  })

  const versionDetailQuery = useQuery({
    queryKey: ['workflow-version', workflowId, selectedVersion?.version_number],
    queryFn: () => workflowsApi.version(workflowId, selectedVersion!.version_number),
    enabled: open && Boolean(workflowId && selectedVersion),
  })

  const latestVersionNumber = useMemo(
    () => Math.max(0, ...(versionsQuery.data || []).map(version => version.version_number)),
    [versionsQuery.data],
  )

  const diffQuery = useQuery({
    queryKey: ['workflow-version-diff', workflowId, diffVersion?.version_number, latestVersionNumber],
    queryFn: () => workflowsApi.diff(workflowId, diffVersion!.version_number, latestVersionNumber),
    enabled: open && Boolean(workflowId && diffVersion && latestVersionNumber && diffVersion.version_number !== latestVersionNumber),
  })

  const rollbackMutation = useMutation({
    mutationFn: (versionNumber: number) => workflowsApi.rollback(workflowId, versionNumber),
    onSuccess: restored => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['workflow-versions', workflowId] })
      onRestored(restored)
      toast.success(`Restored to v${selectedVersion?.version_number || ''}`)
      onClose()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  if (!open) return null

  const versions = versionsQuery.data || []
  const detail = versionDetailQuery.data as WorkflowVersionDetail | undefined

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm">
      <button className="flex-1 cursor-default" onClick={onClose} aria-label="Close version history" />
      <aside className="flex h-full w-full max-w-5xl flex-col border-l border-white/[0.08] bg-obsidian-950 shadow-glow-md">
        <div className="flex h-16 items-center justify-between border-b border-white/[0.08] px-5">
          <div>
            <div className="text-lg font-semibold text-white">Version History</div>
            <div className="text-xs text-obsidian-500">{workflow.name || 'Untitled workflow'}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
          <div className="overflow-y-auto border-r border-white/[0.08] p-4">
            {versionsQuery.isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <SkeletonCard key={i} className="h-24" />)}
              </div>
            ) : !versions.length ? (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-sm text-obsidian-400">
                No saved versions yet. Save this workflow to start its history.
              </div>
            ) : (
              <div className="space-y-3">
                {versions.map(version => (
                  <div key={version.id} className="rounded-xl border border-white/[0.08] bg-obsidian-900 p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <span className="rounded-full border border-indigo-400/25 bg-indigo-400/10 px-2 py-0.5 text-xs font-semibold text-indigo-200">
                          v{version.version_number}{version.version_number === latestVersionNumber ? ' (latest)' : ''}
                        </span>
                        <p className="mt-2 text-sm text-obsidian-200">{version.changelog || 'Workflow snapshot'}</p>
                      </div>
                      <Clock3 size={14} className="mt-1 text-obsidian-600" />
                    </div>

                    <div className="mb-3 flex items-center gap-2 text-xs text-obsidian-500">
                      <AgentAvatar name={version.created_by || 'System'} size="sm" />
                      <span>{version.created_by || 'System'}</span>
                      <span>·</span>
                      <span>{relativeTime(version.created_at)}</span>
                    </div>

                    <div className="flex gap-2">
                      <button className="btn-secondary flex-1 text-xs" onClick={() => setSelectedVersion(version)}>View</button>
                      <button className="btn-secondary flex-1 text-xs" onClick={() => setDiffVersion(version)}>
                        <GitCompareArrows size={12} /> Diff
                      </button>
                      <button
                        className="btn-danger flex-1 text-xs"
                        onClick={() => setRestoreVersion(version)}
                        disabled={rollbackMutation.isPending}
                      >
                        <RotateCcw size={12} /> Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 overflow-y-auto p-5">
            {diffVersion ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <GitCompareArrows size={16} /> Diff v{diffVersion.version_number} → v{latestVersionNumber}
                    </div>
                    <div className="text-xs text-obsidian-500">Green means added, red means removed, amber means modified.</div>
                  </div>
                  <button className="btn-secondary text-xs" onClick={() => setDiffVersion(null)}>Close diff</button>
                </div>
                {diffQuery.isLoading ? <SkeletonCard className="h-32" /> : <DiffSummary diff={diffQuery.data} />}
                {diffQuery.data && (
                  <pre className="max-h-[520px] overflow-auto rounded-xl border border-white/[0.08] bg-obsidian-900 p-4 font-mono text-xs text-obsidian-300">
                    {JSON.stringify(diffQuery.data, null, 2)}
                  </pre>
                )}
              </div>
            ) : selectedVersion ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Check size={16} /> Viewing v{selectedVersion.version_number}
                    </div>
                    <div className="text-xs text-obsidian-500">{selectedVersion.changelog || 'Workflow snapshot'}</div>
                  </div>
                </div>
                <div className="h-[680px] overflow-hidden rounded-xl border border-white/[0.08]">
                  <Editor
                    language="json"
                    theme="vs-dark"
                    value={JSON.stringify(detail?.definition || {}, null, 2)}
                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'on' }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <GitCompareArrows size={42} className="mx-auto mb-3 text-obsidian-600" />
                  <div className="font-medium text-white">Select a version</div>
                  <div className="mt-1 text-sm text-obsidian-500">View JSON snapshots, inspect diffs, or restore safely.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
      <ConfirmDialog
        open={Boolean(restoreVersion)}
        title={`Restore workflow to v${restoreVersion?.version_number || ''}?`}
        description="A new version will be created from this snapshot. Your current version history will not be lost."
        confirmLabel="Restore version"
        tone="warning"
        loading={rollbackMutation.isPending}
        onClose={() => setRestoreVersion(null)}
        onConfirm={() => {
          if (!restoreVersion) return
          setSelectedVersion(restoreVersion)
          rollbackMutation.mutate(restoreVersion.version_number)
          setRestoreVersion(null)
        }}
      />
    </div>
  )
}

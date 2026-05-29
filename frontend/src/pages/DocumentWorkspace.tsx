import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { clientsApi, extractApiError, filesApi } from '../api/client'
import { DocumentEditor } from '../components/editor/DocumentEditor'
import { useAnchoredFloating } from '../hooks/useAnchoredFloating'
import { toast } from '../lib/toast'

function formatTimestamp(value?: string | null) {
  if (!value) return 'Just now'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return 'Just now'
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function DocumentWorkspace() {
  const navigate = useNavigate()
  const { fileId = '' } = useParams<{ fileId: string }>()
  const [draftName, setDraftName] = useState('')
  const [saveState, setSaveState] = useState<'saving' | 'saved'>('saved')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [collaborators, setCollaborators] = useState<Array<{ name: string; color: string }>>([])
  const [latestText, setLatestText] = useState('')
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const exportMenuStyle = useAnchoredFloating({
    open: showExportMenu,
    anchorRef: exportTriggerRef,
    panelRef: exportMenuRef,
    vertical: 'below',
    horizontal: 'end',
    offset: 8,
    avoidRef: showSidebar ? sidebarRef : undefined,
  })

  const fileQuery = useQuery({
    queryKey: ['org-file', fileId],
    queryFn: () => filesApi.get(fileId),
    enabled: Boolean(fileId),
  })

  const clientQuery = useQuery({
    queryKey: ['client', fileQuery.data?.client_id],
    queryFn: () => clientsApi.get(fileQuery.data?.client_id || ''),
    enabled: Boolean(fileQuery.data?.client_id),
  })

  useEffect(() => {
    if (!fileQuery.data) return
    setDraftName(fileQuery.data.name)
    setLastSavedAt(fileQuery.data.updated_at)
    setLatestText(fileQuery.data.extracted_text || '')
    setWordCount(fileQuery.data.extracted_text?.trim() ? fileQuery.data.extracted_text.trim().split(/\s+/).length : 0)
  }, [fileQuery.data])

  useEffect(() => {
    if (!showExportMenu) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!exportTriggerRef.current?.contains(target) && !exportMenuRef.current?.contains(target)) {
        setShowExportMenu(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowExportMenu(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showExportMenu])

  const renameMutation = useMutation({
    mutationFn: (name: string) => filesApi.update(fileId, { name }),
    onSuccess: updated => {
      setDraftName(updated.name)
      setLastSavedAt(updated.updated_at)
      toast.success('Document name updated')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const exportMutation = useMutation({
    mutationFn: (format: 'markdown' | 'pdf' | 'docx') => filesApi.export(fileId, format),
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename)
      toast.success('Export ready')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const agentWriteMutation = useMutation({
    mutationFn: (payload: { content: string; agent_name: string }) => filesApi.agentWrite(fileId, payload),
    onSuccess: () => toast.success('Agent draft added to the document'),
    onError: error => toast.error(extractApiError(error)),
  })

  const documentTitle = draftName || fileQuery.data?.name || 'Untitled Document'
  const clientName = clientQuery.data?.company_name || clientQuery.data?.name
  const presenceList = useMemo(() => {
    const seen = new Set<string>()
    return collaborators.filter(user => {
      const key = `${user.name}-${user.color}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [collaborators])

  const saveLabel =
    saveState === 'saving'
      ? 'Saving...'
      : lastSavedAt
        ? `Saved ${formatTimestamp(lastSavedAt)}`
        : 'Saved just now'

  const handleRenameBlur = () => {
    const next = draftName.trim()
    if (!next || next === fileQuery.data?.name) return
    renameMutation.mutate(next)
  }

  const handleAssist = (kind: 'improve' | 'continue' | 'summarize') => {
    const source = latestText.trim()
    if (!source) {
      toast.error('Add a little content first so the assistant has context.')
      return
    }

    const preview = source.split(/\n+/).join(' ').trim()
    const snippet = preview.slice(0, 900)

    if (kind === 'summarize') {
      const bullets = snippet
        .split(/[.!?]\s+/)
        .map(part => part.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map(part => `- ${part.replace(/[.!?]+$/, '')}`)
        .join('\n')
      agentWriteMutation.mutate({
        agent_name: 'Aethon Editor',
        content: `Summary\n\n${bullets || '- Key points will appear here as the draft develops.'}`,
      })
      return
    }

    if (kind === 'continue') {
      agentWriteMutation.mutate({
        agent_name: 'Aethon Writer',
        content: `Next section\n\nBuilding on the current draft:\n${snippet.slice(0, 240)}...\n\nRecommended continuation\n\n- Add the next proof point.\n- Clarify the client outcome.\n- Close with a concrete action or recommendation.`,
      })
      return
    }

    agentWriteMutation.mutate({
      agent_name: 'Aethon Editor',
      content: `Editor pass\n\nThe draft is strong. Tighten it with these upgrades:\n\n- Lead with the client outcome earlier.\n- Replace vague phrasing with one concrete example.\n- Shorten any repeated lines.\n- End with a clear recommendation.\n\nReference excerpt\n\n${snippet.slice(0, 320)}`,
    })
  }

  if (fileQuery.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg)] px-6">
        <div className="card flex items-center gap-3 px-5 py-4 text-sm text-[var(--t3)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading document workspace…
        </div>
      </div>
    )
  }

  if (fileQuery.isError || !fileQuery.data) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg)] px-6">
        <div className="card max-w-lg p-6 text-center">
          <div className="text-lg font-semibold tracking-tight text-[var(--t1)]">Document unavailable</div>
          <p className="mt-3 text-sm text-[var(--t3)]">{extractApiError(fileQuery.error)}</p>
          <Link to="/files" className="btn-secondary mx-auto mt-5 w-fit">
            <ArrowLeft size={14} />
            Back to Files
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--t1)]">
      <header className="border-b border-[var(--border-soft)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-5 py-4">
          <button
            type="button"
            onClick={() => navigate('/files')}
            className="btn-ghost btn-sm"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div className="min-w-[220px] flex-1 rounded-[24px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 shadow-[var(--shadow-soft)]">
            <div className="page-kicker">Collaborative Document</div>
            <input
              value={draftName}
              onChange={event => setDraftName(event.target.value)}
              onBlur={handleRenameBlur}
              className="mt-1 w-full border-0 bg-transparent text-lg font-semibold tracking-tight text-[var(--t1)] outline-none"
            />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--t3)]">
              {clientName ? (
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{clientName}</span>
              ) : (
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1">Shared workspace</span>
              )}
              <span className="font-mono">{saveLabel}</span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleRenameBlur()}
              className="btn-secondary btn-sm"
              disabled={renameMutation.isPending}
            >
              {renameMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check size={14} />}
              Save
            </button>

            <div className="relative">
              <button
                ref={exportTriggerRef}
                type="button"
                onClick={() => setShowExportMenu(current => !current)}
                className="btn-primary btn-sm"
                data-testid="document-export-trigger"
              >
                <Download size={14} />
                Export
                <ChevronDown size={14} />
              </button>
              {showExportMenu && typeof document !== 'undefined'
                ? createPortal(
                <div
                  ref={exportMenuRef}
                  data-testid="document-export-menu"
                  className="z-[90] w-40 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl"
                  style={exportMenuStyle}
                >
                  {([
                    ['pdf', 'Export PDF'],
                    ['docx', 'Export DOCX'],
                    ['markdown', 'Export Markdown'],
                  ] as const).map(([format, label]) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => {
                        setShowExportMenu(false)
                        exportMutation.mutate(format)
                      }}
                      className="row w-full rounded-xl px-3 py-2 text-left text-sm text-[var(--t2)] hover:text-[var(--t1)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>,
                document.body,
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setShowSidebar(current => !current)}
              className="btn-ghost btn-sm"
            >
              {showSidebar ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              {showSidebar ? 'Hide panel' : 'Show panel'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 px-5 py-5 xl:border-r xl:border-r-[var(--border)] xl:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {presenceList.map((user, index) => (
                <span
                  key={`${user.name}-${index}`}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--t2)]"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: user.color }}
                  />
                  {user.name}
                </span>
              ))}
            </div>
            <span className="text-xs text-[var(--t3)]">
              {presenceList.length > 1 ? `${presenceList.length} people editing` : 'Only you are here right now'}
            </span>
          </div>

          <DocumentEditor
            room={fileQuery.data.collab_room || `org-doc-${fileQuery.data.id}`}
            fileId={fileQuery.data.id}
            minimalChrome
            editorClassName="mx-auto max-w-2xl"
            onSaveStateChange={state => setSaveState(state)}
            onPresenceChange={setCollaborators}
            onContentChange={({ text, wordCount: nextWordCount }) => {
              setLatestText(text)
              setWordCount(nextWordCount)
            }}
            onSave={({ text, wordCount: nextWordCount }) => {
              setLatestText(text)
              setWordCount(nextWordCount)
              setLastSavedAt(new Date().toISOString())
            }}
          />
        </main>

        {showSidebar ? (
          <aside ref={sidebarRef} data-testid="document-workspace-sidebar" className="border-t border-[var(--border)] bg-[var(--bg-s)] px-5 py-5 xl:border-l xl:border-t-0">
            <div className="space-y-5">
              <section className="card p-4">
                <div className="section-title">AI Assistant</div>
                <div className="space-y-2">
                  <button
                    type="button"
                    className="btn-secondary w-full justify-start"
                    onClick={() => handleAssist('improve')}
                    disabled={agentWriteMutation.isPending}
                  >
                    <Sparkles size={14} />
                    Ask agent to improve this
                  </button>
                  <button
                    type="button"
                    className="btn-secondary w-full justify-start"
                    onClick={() => handleAssist('continue')}
                    disabled={agentWriteMutation.isPending}
                  >
                    <Sparkles size={14} />
                    Ask agent to continue writing
                  </button>
                  <button
                    type="button"
                    className="btn-secondary w-full justify-start"
                    onClick={() => handleAssist('summarize')}
                    disabled={agentWriteMutation.isPending}
                  >
                    <Sparkles size={14} />
                    Ask agent to summarize
                  </button>
                </div>
                {agentWriteMutation.isPending ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--t3)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Streaming agent contribution…
                  </div>
                ) : null}
              </section>

              <section className="card p-4">
                <div className="section-title">Document Info</div>
                <div className="space-y-2">
                  <div className="row rounded-2xl border border-[var(--border)] bg-[var(--bg)]">
                    <span className="flex-1">Word count</span>
                    <span className="font-mono text-[var(--t1)]">{wordCount}</span>
                  </div>
                  <div className="row rounded-2xl border border-[var(--border)] bg-[var(--bg)]">
                    <span className="flex-1">Last saved</span>
                    <span className="font-mono text-[var(--t1)]">{saveState === 'saving' ? 'Saving…' : formatTimestamp(lastSavedAt)}</span>
                  </div>
                  <div className="row rounded-2xl border border-[var(--border)] bg-[var(--bg)]">
                    <span className="flex-1">Version</span>
                    <span className="font-mono text-[var(--t1)]">v{fileQuery.data.version}</span>
                  </div>
                  <div className="row rounded-2xl border border-[var(--border)] bg-[var(--bg)]">
                    <span className="flex-1">Type</span>
                    <span className="font-mono text-[var(--t1)]">{fileQuery.data.file_type}</span>
                  </div>
                </div>
              </section>

              <section className="card p-4">
                <div className="section-title">Workspace</div>
                <div className="space-y-3 text-sm text-[var(--t3)]">
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 h-4 w-4 text-indigo-300" />
                    <p>
                      Collaborative edits persist live through Hocuspocus and the Files workspace keeps the latest version ready for portal delivery and exports.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

import { ChangeEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Grid2X2,
  LayoutList,
  Loader2,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { agentsApi, clientsApi, extractApiError, filesApi } from '../api/client'
import { EmptyState } from '../components/ui/EmptyState'
import { HeroPanel } from '../components/ui/HeroPanel'
import { StatusBadge } from '../components/ui/StatusBadge'
import { toast } from '../lib/toast'
import { uploadFile } from '../lib/upload'
import type { Agent, ClientWithStats, OrgFileRecord } from '../types'

type ViewMode = 'grid' | 'list'
type TypeFilter = 'all' | 'documents' | 'pdfs' | 'exports'

function formatBytes(bytes?: number | null) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value?: string | null) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString()
}

function fileMeta(file: OrgFileRecord) {
  if (file.file_type === 'document') return { icon: FileText, tone: 'text-indigo-300 bg-indigo-500/15' }
  if (file.file_type === 'pdf') return { icon: FileCode2, tone: 'text-red-300 bg-red-500/15' }
  if (file.file_type === 'docx' || file.file_type === 'markdown' || file.file_type === 'text') {
    return { icon: FileSpreadsheet, tone: 'text-emerald-300 bg-emerald-500/15' }
  }
  if (file.file_type === 'image') return { icon: FileImage, tone: 'text-amber-300 bg-amber-500/15' }
  return { icon: FileText, tone: 'text-white/70 bg-white/[0.08]' }
}

function matchesType(file: OrgFileRecord, typeFilter: TypeFilter) {
  if (typeFilter === 'all') return true
  if (typeFilter === 'documents') return file.file_type === 'document'
  if (typeFilter === 'pdfs') return file.file_type === 'pdf'
  return ['markdown', 'docx', 'text'].includes(file.file_type)
}

export function Files() {
  const { fileId: routeFileId } = useParams<{ fileId?: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(routeFileId || searchParams.get('selected'))
  const [draftName, setDraftName] = useState('')
  const deferredSearch = useDeferredValue(search)

  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  })
  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
  })
  const filesQuery = useQuery({
    queryKey: ['files', { search: deferredSearch, clientId: selectedClientId }],
    queryFn: () =>
      filesApi.list({
        search: deferredSearch.trim() || undefined,
        client_id: selectedClientId === 'all' ? undefined : selectedClientId,
        limit: 200,
      }),
  })

  const files = useMemo(
    () => (filesQuery.data?.files || []).filter(file => matchesType(file, typeFilter)),
    [filesQuery.data?.files, typeFilter],
  )
  const selectedFile = useMemo(
    () => files.find(file => file.id === selectedFileId) || filesQuery.data?.files.find(file => file.id === selectedFileId) || null,
    [files, filesQuery.data?.files, selectedFileId],
  )

  useEffect(() => {
    if (routeFileId && routeFileId !== selectedFileId) {
      setSelectedFileId(routeFileId)
      return
    }
    const selected = searchParams.get('selected')
    if (!routeFileId && selected && selected !== selectedFileId) {
      setSelectedFileId(selected)
    }
  }, [routeFileId, searchParams, selectedFileId])

  useEffect(() => {
    setDraftName(selectedFile?.name || '')
  }, [selectedFile?.id, selectedFile?.name])


  const versionsQuery = useQuery({
    queryKey: ['file-versions', selectedFileId],
    queryFn: () => filesApi.versions(selectedFileId || ''),
    enabled: Boolean(selectedFileId),
  })

  const clientMap = useMemo(
    () => new Map((clientsQuery.data?.clients || []).map(client => [client.id, client])),
    [clientsQuery.data?.clients],
  )
  const agentMap = useMemo(
    () => new Map((agentsQuery.data || []).map(agent => [agent.id, agent])),
    [agentsQuery.data],
  )

  const createDocumentMutation = useMutation({
    mutationFn: () =>
      filesApi.createDocument({
        name: 'Untitled Document',
        client_id: selectedClientId === 'all' ? null : selectedClientId,
      }),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ['files'] })
      navigate(`/files/${result.file_id}/edit`)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const renameMutation = useMutation({
    mutationFn: ({ fileId, name }: { fileId: string; name: string }) =>
      filesApi.update(fileId, { name }),
    onSuccess: async updated => {
      setDraftName(updated.name)
      await queryClient.invalidateQueries({ queryKey: ['files'] })
      await queryClient.invalidateQueries({ queryKey: ['org-file', updated.id] })
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => filesApi.delete(fileId),
    onSuccess: async () => {
      setSelectedFileId(null)
      navigate('/files')
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('selected')
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['files'] })
      toast.success('File removed from workspace')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const downloadMutation = useMutation({
    mutationFn: (fileId: string) => filesApi.downloadUrl(fileId),
    onSuccess: payload => {
      window.location.href = payload.download_url
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const uploaded = await uploadFile(file, selectedClientId === 'all' ? undefined : selectedClientId)
      toast.success(`${uploaded.name} uploaded`)
      await queryClient.invalidateQueries({ queryKey: ['files'] })
      setSelectedFileId(uploaded.fileId)
      navigate(`/files/${uploaded.fileId}`)
    } catch (error) {
      toast.error(extractApiError(error))
    } finally {
      event.target.value = ''
    }
  }

  const selectedClient = selectedFile?.client_id ? clientMap.get(selectedFile.client_id) : null
  const selectedAgent = selectedFile?.agent_id ? agentMap.get(selectedFile.agent_id) : null

  if (filesQuery.isLoading) {
    return (
      <div className="page-shell">
        <div className="grid min-h-[60vh] place-items-center">
          <div className="card flex items-center gap-3 px-5 py-4 text-sm text-[var(--t3)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading workspace files…
          </div>
        </div>
      </div>
    )
  }

  if (filesQuery.isError) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1 className="page-title">Files</h1>
          <p className="page-sub">We couldn’t load your workspace files.</p>
        </div>
        <div className="card p-6 text-sm text-red-400">{extractApiError(filesQuery.error)}</div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <HeroPanel
        kicker="Agency Workspace"
        title="Files"
        subtitle="Persistent deliverables, shared documents, and agency exports all live here."
      />

      <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)_360px]">
        <aside className="card h-fit p-5">
          <div className="section-title">Filters</div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--t3)]" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search files"
              className="input h-11 pl-10"
            />
          </label>

          <div className="mt-5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--t3)]">Client</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedClientId('all')}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${selectedClientId === 'all' ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-[var(--border)] text-[var(--t3)] hover:text-[var(--t1)]'}`}
              >
                All
              </button>
              {(clientsQuery.data?.clients || []).map(client => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClientId(client.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${selectedClientId === client.id ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-[var(--border)] text-[var(--t3)] hover:text-[var(--t1)]'}`}
                >
                  {client.company_name || client.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--t3)]">Type</div>
            <div className="flex flex-wrap gap-2">
              {([
                ['all', 'All'],
                ['documents', 'Documents'],
                ['pdfs', 'PDFs'],
                ['exports', 'Exports'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTypeFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${typeFilter === value ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-[var(--border)] text-[var(--t3)] hover:text-[var(--t1)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="inline-flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-s)] p-1.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`rounded-lg px-3 py-2 text-sm transition ${viewMode === 'grid' ? 'bg-indigo-500/10 text-indigo-300' : 'text-[var(--t3)] hover:text-[var(--t1)]'}`}
              >
                <Grid2X2 size={15} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-lg px-3 py-2 text-sm transition ${viewMode === 'list' ? 'bg-indigo-500/10 text-indigo-300' : 'text-[var(--t3)] hover:text-[var(--t1)]'}`}
              >
                <LayoutList size={15} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => createDocumentMutation.mutate()}
                className="btn-primary btn-sm"
              >
                <Plus size={14} />
                New Document
              </button>
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="btn-secondary btn-sm"
              >
                <Upload size={14} />
                Upload
              </button>
              <input ref={uploadInputRef} type="file" className="hidden" onChange={handleUpload} />
            </div>
          </div>

          {!files.length ? (
            <EmptyState
              title="No files yet"
              description="Approved execution outputs, uploaded files, and collaborative documents will appear here."
            />
          ) : viewMode === 'grid' ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {files.map(file => {
                const meta = fileMeta(file)
                const Icon = meta.icon
                const client = file.client_id ? clientMap.get(file.client_id) : null
                const agent = file.agent_id ? agentMap.get(file.agent_id) : null
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => {
                      setSelectedFileId(file.id)
                      setDraftName(file.name)
                      navigate(`/files/${file.id}`)
                    }}
                    className={`card cursor-pointer p-4 text-left transition ${selectedFileId === file.id ? 'card-indigo' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${meta.tone}`}>
                        <Icon size={22} />
                      </div>
                      <StatusBadge status={file.status} />
                    </div>
                    <div className="mt-4 truncate text-sm font-semibold text-[var(--t1)]">{file.name}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--t3)]">
                      {client ? (
                        <span className="rounded-full border border-[var(--border)] px-2 py-1">
                          {client.company_name || client.name}
                        </span>
                      ) : null}
                      <span className="font-mono">{formatDate(file.created_at)}</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-[var(--t3)]">
                      <span>{agent?.persona_name || agent?.name || 'Agency'}</span>
                      <span className="font-mono">{formatBytes(file.size_bytes)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="card overflow-hidden p-0">
              {files.map(file => {
                const meta = fileMeta(file)
                const Icon = meta.icon
                const client = file.client_id ? clientMap.get(file.client_id) : null
                const agent = file.agent_id ? agentMap.get(file.agent_id) : null
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => {
                      setSelectedFileId(file.id)
                      setDraftName(file.name)
                      navigate(`/files/${file.id}`)
                    }}
                    className={`row flex w-full items-center gap-3 text-left ${selectedFileId === file.id ? 'row-indigo bg-white/[0.03]' : ''}`}
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.tone}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--t1)]">{file.name}</div>
                      <div className="truncate text-xs text-[var(--t3)]">{client?.company_name || client?.name || 'Shared workspace'}</div>
                    </div>
                    <div className="hidden text-xs text-[var(--t3)] md:block">{agent?.persona_name || agent?.name || 'Agency'}</div>
                    <div className="hidden font-mono text-xs text-[var(--t3)] md:block">{formatDate(file.created_at)}</div>
                    <div className="font-mono text-xs text-[var(--t3)]">{formatBytes(file.size_bytes)}</div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <aside className="card p-5">
          {!selectedFile ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-center text-sm text-[var(--t3)]">
              Select a file to inspect versions, usage, and download actions.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--t3)]">File</div>
                <input
                  value={draftName}
                  onChange={event => setDraftName(event.target.value)}
                  onBlur={() => {
                    if (draftName.trim() && draftName.trim() !== selectedFile.name) {
                      renameMutation.mutate({ fileId: selectedFile.id, name: draftName.trim() })
                    }
                  }}
                  className="input h-11"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selectedFile.file_type} />
                <span className="font-mono text-xs text-[var(--t3)]">{formatBytes(selectedFile.size_bytes)}</span>
                <span className="font-mono text-xs text-[var(--t3)]">{formatDate(selectedFile.created_at)}</span>
              </div>

              {selectedClient ? (
                <div className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--t2)] w-fit">
                  {selectedClient.company_name || selectedClient.name}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {selectedFile.file_type === 'document' ? (
                  <Link to={`/files/${selectedFile.id}/edit`} className="btn-primary btn-sm">
                    Open in editor
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn-primary btn-sm btn-runner"
                    onClick={() => downloadMutation.mutate(selectedFile.id)}
                  >
                    <Download size={14} />
                    Download
                  </button>
                )}
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => deleteMutation.mutate(selectedFile.id)}
                >
                  Remove
                </button>
              </div>

              <div>
                <div className="section-title">Versions</div>
                <div className="space-y-2">
                  {(versionsQuery.data || []).map(version => (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => navigate(`/files/${version.id}/edit`)}
                      className={`row w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left ${version.id === selectedFile.id ? 'row-indigo' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--t1)]">v{version.version}</div>
                        <div className="font-mono text-[11px] text-[var(--t3)]">{formatDate(version.created_at)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-title">Usage</div>
                <div className="space-y-2 text-sm text-[var(--t3)]">
                  <div className="row rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                    <span className="flex-1">Created by</span>
                    <span className="text-[var(--t1)]">{selectedAgent?.persona_name || selectedAgent?.name || 'CEO / workspace'}</span>
                  </div>
                  <div className="row rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                    <span className="flex-1">Execution</span>
                    {selectedFile.execution_id ? (
                      <Link to={`/executions/${selectedFile.execution_id}`} className="text-indigo-300 hover:text-indigo-200">
                        Open run
                      </Link>
                    ) : (
                      <span>Not linked</span>
                    )}
                  </div>
                  <div className="row rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                    <span className="flex-1">Mission</span>
                    {selectedFile.mission_id ? (
                      <Link to={`/missions`} className="text-indigo-300 hover:text-indigo-200">
                        View project
                      </Link>
                    ) : (
                      <span>Not linked</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

import { ChangeEvent, DragEvent, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bot, CheckCircle2, FileUp, GitBranch, Sparkles, Workflow, Wrench, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { agentsApi, customToolsApi, extractApiError, marketplaceApi, workflowsApi } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import type { Agent, CustomTool, MarketplaceCategory, Workflow as WorkflowType } from '../types'
import { toast } from '../lib/toast'

const CATEGORIES: MarketplaceCategory[] = [
  'productivity',
  'development',
  'marketing',
  'finance',
  'customer_support',
  'research',
  'hr',
  'operations',
  'data',
  'other',
]

type PublishKind = 'agent' | 'workflow' | 'tool_config'

function categoryLabel(category: string) {
  return category.replace('_', ' ')
}

function PreviewCard({ name, tagline, category, tags, previewUrl, kind }: {
  name: string
  tagline: string
  category: MarketplaceCategory
  tags: string[]
  previewUrl: string
  kind: PublishKind
}) {
  const Icon = kind === 'agent' ? Bot : kind === 'workflow' ? Workflow : Wrench
  return (
    <div className="card overflow-hidden rounded-2xl">
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-violet-500" />
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-indigo-500/40 to-black">
        {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Icon size={38} className="text-white" /></div>}
        <span className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/35 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          {kind === 'agent' ? 'Agent' : kind === 'workflow' ? 'Workflow' : 'Tool config'}
        </span>
      </div>
      <div className="p-4">
        <span className="badge badge-glass capitalize">{categoryLabel(category)}</span>
        <h3 className="mt-3 line-clamp-1 text-lg font-semibold text-white">{name || 'Listing name'}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-[#8B9DBE]">{tagline || 'A compelling one-line promise for founders.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.slice(0, 4).map(tag => <span key={tag} className="badge badge-glass">#{tag}</span>)}
        </div>
      </div>
    </div>
  )
}

export function PublishListing() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [kind, setKind] = useState<PublishKind>('agent')
  const [selectedId, setSelectedId] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [form, setForm] = useState({
    name: '',
    tagline: '',
    category: 'productivity' as MarketplaceCategory,
    description: '',
    tags: '',
    readme: '',
    preview_image_url: '',
    source_url: '',
    is_free: true,
  })
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list })
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: workflowsApi.list })
  const { data: tools = [] } = useQuery({ queryKey: ['custom-tools'], queryFn: customToolsApi.list })
  const selectedAgent = agents.find(agent => agent.id === selectedId)
  const selectedWorkflow = workflows.find(workflow => workflow.id === selectedId)
  const selectedTool = (tools as CustomTool[]).find(tool => tool.id === selectedId)
  const selectedName = kind === 'agent' ? selectedAgent?.name : kind === 'workflow' ? selectedWorkflow?.name : selectedTool?.name
  const tags = useMemo(() => form.tags.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean), [form.tags])

  const publish = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        tags,
        preview_image_url: form.preview_image_url || undefined,
        source_url: form.source_url || undefined,
      }
      if (kind === 'agent') return marketplaceApi.publishAgent(selectedId, payload)
      if (kind === 'workflow') return marketplaceApi.publishWorkflow(selectedId, payload)
      return marketplaceApi.publishTool(selectedId, payload)
    },
    onSuccess: () => {
      toast.success('Submitted for review')
      setStep(3)
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const choose = (nextKind: PublishKind, item: Agent | WorkflowType | CustomTool) => {
    setKind(nextKind)
    setSelectedId(item.id)
    setForm(current => ({
      ...current,
      name: item.name,
      tagline: nextKind === 'agent'
        ? `${(item as Agent).role} agent ready to install into your AI company`
        : nextKind === 'workflow'
          ? `${item.name} workflow ready to customize and run`
          : `${item.name} tool config ready to install into your agent toolbelt`,
      description: item.description || '',
    }))
    setStep(2)
  }

  const submit = () => {
    if (!selectedId) return toast.error('Choose an agent, workflow, or tool config first')
    if (form.tagline.length < 50 || form.tagline.length > 150) return toast.error('Tagline must be 50-150 characters')
    if (form.description.length < 100) return toast.error('Description must be at least 100 characters')
    publish.mutate()
  }

  const previewLocalImage = (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) return
    setPreviewUrl(URL.createObjectURL(file))
    toast.info('Preview loaded locally. Add an image URL to publish it.')
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    previewLocalImage(event.dataTransfer.files?.[0])
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    previewLocalImage(event.target.files?.[0])
  }

  if (step === 3) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-bg px-4 text-center text-white">
        <div className="max-w-xl rounded-3xl border border-white/[0.08] bg-base-surface p-10 shadow-glow-lg">
          <CheckCircle2 className="mx-auto text-emerald-300" size={52} />
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">Your listing is under review.</h1>
          <p className="mt-4 leading-7 text-obsidian-300">We’ll notify you when it’s approved, usually within 24 hours. Tiny marketplace gatekeepers, doing tiny marketplace paperwork.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link className="btn-primary" to="/marketplace">Back to Marketplace</Link>
            <button className="btn-secondary" onClick={() => navigate('/')}>Command Center</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-base-bg text-white">
      <header className="border-b border-white/[0.08] bg-obsidian-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/marketplace" className="btn-ghost px-2"><ArrowLeft size={16} /> Marketplace</Link>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.24em] text-indigo-300"><Zap size={14} /> Submit for review</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-emerald-300">Step {step} of 2</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em]">Publish to Marketplace</h1>
          <p className="mt-2 text-sm text-ink-muted">Turn your best agents, workflows, and tool configs into installable company building blocks.</p>
        </div>

        {step === 1 ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="card p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/15 text-indigo-200"><Bot size={20} /></div>
                <div>
                  <h2 className="text-xl font-semibold">Publish an Agent</h2>
                  <p className="text-sm text-ink-faint">Share a role, prompt, and tool setup.</p>
                </div>
              </div>
              <div className="space-y-3">
                {agents.map(agent => (
                  <button key={agent.id} className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-indigo-400/40 hover:bg-white/[0.05]" onClick={() => choose('agent', agent)}>
                    <div className="font-medium text-white">{agent.name}</div>
                    <div className="mt-1 text-sm text-ink-muted">{agent.role} · {agent.tools.length} tools</div>
                  </button>
                ))}
                {!agents.length && <p className="rounded-2xl border border-white/[0.08] p-5 text-sm text-ink-faint">No agents yet. Create one before publishing.</p>}
              </div>
            </section>

            <section className="card p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/15 text-emerald-200"><GitBranch size={20} /></div>
                <div>
                  <h2 className="text-xl font-semibold">Publish a Workflow</h2>
                  <p className="text-sm text-ink-faint">Share a reusable process blueprint.</p>
                </div>
              </div>
              <div className="space-y-3">
                {workflows.map(workflow => (
                  <button key={workflow.id} className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-emerald-400/40 hover:bg-white/[0.05]" onClick={() => choose('workflow', workflow)}>
                    <div className="font-medium text-white">{workflow.name}</div>
                    <div className="mt-1 text-sm text-ink-muted">{workflow.nodes.length} nodes · {workflow.execution_mode}</div>
                  </button>
                ))}
                {!workflows.length && <p className="rounded-2xl border border-white/[0.08] p-5 text-sm text-ink-faint">No workflows yet. Build one before publishing.</p>}
              </div>
            </section>

            <section className="card p-5">
              <div className="mb-5 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500/15 text-amber-200"><Wrench size={20} /></div>
                <div>
                  <h2 className="text-xl font-semibold">Publish a Tool Config</h2>
                  <p className="text-sm text-ink-faint">Share a reusable custom tool.</p>
                </div>
              </div>
              <div className="space-y-3">
                {(tools as CustomTool[]).map(tool => (
                  <button key={tool.id} className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-amber-400/40 hover:bg-white/[0.05]" onClick={() => choose('tool_config', tool)}>
                    <div className="font-medium text-white">{tool.name}</div>
                    <div className="mt-1 line-clamp-1 text-sm text-ink-muted">{tool.description}</div>
                  </button>
                ))}
                {!(tools as CustomTool[]).length && <p className="rounded-2xl border border-white/[0.08] p-5 text-sm text-ink-faint">No custom tools yet. Create one before publishing.</p>}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="card space-y-5 p-6">
              <div className="rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-indigo-100"><Sparkles size={16} /> Publishing {selectedName}</div>
                <p className="mt-1 text-xs text-indigo-100/70">Template data is sanitized server-side before review.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FloatingField label="Name" type="text" value={form.name} onChange={value => setForm({ ...form, name: value })} />
                <div>
                  <label className="label">Category</label>
                  <select className="input capitalize" value={form.category} onChange={event => setForm({ ...form, category: event.target.value as MarketplaceCategory })}>
                    {CATEGORIES.map(category => <option key={category} value={category}>{categoryLabel(category)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="label mb-0">Tagline</label>
                  <span className={clsx('font-mono text-xs', form.tagline.length >= 50 && form.tagline.length <= 150 ? 'text-emerald-300' : 'text-amber-300')}>{form.tagline.length}/150</span>
                </div>
                <FloatingField label="Tagline" type="text" value={form.tagline} onChange={value => setForm({ ...form, tagline: value })} />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea className="input min-h-40" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Explain what this solves, who it is for, and how to use it." />
                <p className="mt-1 text-xs text-ink-faint">{form.description.length}/100 minimum characters</p>
              </div>

              <div>
                <label className="label">Tags</label>
                <FloatingField label="Tags" type="text" value={form.tags} onChange={value => setForm({ ...form, tags: value })} />
                <div className="mt-2 flex flex-wrap gap-2">{tags.map(tag => <span key={tag} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-xs text-ink-muted">#{tag}</span>)}</div>
              </div>

              <div>
                <label className="label">Readme</label>
                <textarea className="input min-h-44" value={form.readme} onChange={event => setForm({ ...form, readme: event.target.value })} placeholder="Optional detailed docs in markdown." />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FloatingField label="Preview image URL" type="text" value={form.preview_image_url} onChange={value => setForm({ ...form, preview_image_url: value })} />
                <FloatingField label="Source URL" type="text" value={form.source_url} onChange={value => setForm({ ...form, source_url: value })} />
              </div>

              <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                <div>
                  <div className="text-sm font-medium text-white">Free listing</div>
                  <p className="mt-1 text-xs text-ink-faint">Phase 5 marketplace listings are always free. Paid marketplace pricing can be enabled later.</p>
                </div>
                <input
                  type="checkbox"
                  checked={form.is_free}
                  disabled
                  onChange={event => setForm({ ...form, is_free: event.target.checked })}
                  className="h-5 w-5 rounded border-white/20 bg-base-surface text-indigo-500"
                />
              </label>

              <label
                onDrop={handleDrop}
                onDragOver={event => event.preventDefault()}
                className="grid cursor-pointer place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center transition hover:border-indigo-400/40"
              >
                <input type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
                <FileUp className="text-ink-faint" />
                <p className="mt-2 text-sm text-obsidian-300">Drag a preview image here, or click to choose one for local preview</p>
                <p className="mt-1 text-xs text-ink-faint">Phase 5 saves image URLs only; binary upload comes later.</p>
              </label>

              <div className="flex flex-wrap gap-3 border-t border-white/[0.08] pt-5">
                <button className="btn-primary" disabled={publish.isPending} onClick={submit}>{publish.isPending ? 'Submitting...' : 'Submit for Review'}</button>
                <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
              </div>
            </section>

            <aside className="lg:sticky lg:top-6 lg:h-max">
              <div className="card p-5">
                <p className="mb-3 font-mono text-xs uppercase tracking-[0.22em] text-[#8B9DBE]">Live preview</p>
              <PreviewCard
                name={form.name}
                tagline={form.tagline}
                category={form.category}
                tags={tags}
                previewUrl={form.preview_image_url || previewUrl}
                kind={kind}
              />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}

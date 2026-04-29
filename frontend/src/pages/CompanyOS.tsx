import { useEffect, useMemo, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode2,
  Play,
  RefreshCw,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import { companyApi } from '../api/client'
import type { CompanyYamlApplySummary, CompanyYamlPreview, CompanyYamlValidation } from '../types'
import { GlowCard } from '../components/ui/GlowCard'

const sampleYaml = `company:
  name: Acme Intelligence
  mission: Build an AI operating system for modern companies
  industry: Software
  stage: growth
  monthly_revenue: 10000
  runway_months: 18

team:
  - role: CTO/Lead Developer
    name: Ada
    model: llama-3.3-70b-versatile
    memory_enabled: true
    tools:
      - web_search
      - code_execution
    responsibilities:
      - Own architecture and technical decisions
      - Review code and prevent regressions
    system_prompt_extra: Prioritize reliability and speed.
    max_retries: 3
    timeout: 180
  - role: Growth/Marketing
    name: Maya
    tools:
      - web_search
      - text_analysis
    responsibilities:
      - Create distribution experiments
      - Analyze competitors and write content briefs

workflows:
  - name: Weekly Growth Review
    trigger:
      type: manual
    description: Research competitors, draft insights, and prepare next actions.
    steps:
      - Growth/Marketing
      - CTO/Lead Developer
    sequential: true
    hitl_before:
      - CTO/Lead Developer

settings:
  default_model: llama-3.3-70b-versatile
  timezone: UTC
  notifications:
    telegram: false
    email: founder@example.com
`

const schemaExample = `company:
  name: string
  mission: string
  industry: string
  stage: idea | pre-revenue | growth | scale
  monthly_revenue: 0
  runway_months: 12

team:
  - role: CTO/Lead Developer
    name: Ada
    tools: [web_search, code_execution]
    responsibilities:
      - Own architecture
      - Review code

workflows:
  - name: Launch Review
    trigger:
      type: manual
    steps:
      - CTO/Lead Developer
    hitl_before: []
`

function configureMonaco(monaco: Monaco) {
  monaco.editor.defineTheme('obsidian-yaml', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'key', foreground: '67e8f9' },
      { token: 'string', foreground: 'c4b5fd' },
      { token: 'number', foreground: 'fbbf24' },
    ],
    colors: {
      'editor.background': '#0a0a0f',
      'editor.foreground': '#e5e7eb',
      'editorLineNumber.foreground': '#4b4b61',
      'editorLineNumber.activeForeground': '#06b6d4',
      'editorCursor.foreground': '#6366f1',
      'editor.selectionBackground': '#6366f144',
      'editor.lineHighlightBackground': '#ffffff08',
    },
  })
}

function StatList({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: 'green' | 'yellow' | 'gray'
}) {
  const styles = {
    green: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    yellow: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    gray: 'border-white/10 bg-white/[0.03] text-slate-400',
  }
  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <div className="space-y-2">
        {items.length ? items.map(item => (
          <div key={item} className={`rounded-lg border px-3 py-2 text-sm ${styles[tone]}`}>
            {item}
          </div>
        )) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-slate-600">
            None
          </div>
        )}
      </div>
    </div>
  )
}

function summaryText(summary: CompanyYamlApplySummary) {
  return [
    `${summary.created_agents.length} agents created`,
    `${summary.updated_agents.length} agents updated`,
    `${summary.created_workflows.length} workflows created`,
    `${summary.updated_workflows.length} workflows updated`,
  ].join(', ')
}

export function CompanyOS() {
  const queryClient = useQueryClient()
  const [yamlContent, setYamlContent] = useState(sampleYaml)
  const [activeTab, setActiveTab] = useState<'preview' | 'validation' | 'docs'>('preview')
  const [validation, setValidation] = useState<CompanyYamlValidation | null>(null)
  const [preview, setPreview] = useState<CompanyYamlPreview | null>(null)
  const [applySummary, setApplySummary] = useState<CompanyYamlApplySummary | null>(null)

  const exportQuery = useQuery({
    queryKey: ['company-yaml'],
    queryFn: companyApi.exportYaml,
    retry: false,
  })

  useEffect(() => {
    if (exportQuery.data) setYamlContent(exportQuery.data)
  }, [exportQuery.data])

  const validateMutation = useMutation({
    mutationFn: companyApi.validateYaml,
    onSuccess: result => {
      setValidation(result)
      setActiveTab('validation')
      toast[result.valid ? 'success' : 'error'](result.valid ? 'YAML is valid' : 'YAML has errors')
    },
  })

  const previewMutation = useMutation({
    mutationFn: companyApi.previewYaml,
    onSuccess: result => {
      setPreview(result)
      setValidation(result.validation)
      setActiveTab('preview')
    },
  })

  const applyMutation = useMutation({
    mutationFn: companyApi.applyYaml,
    onSuccess: async result => {
      setApplySummary(result)
      toast.success(`Your company has been updated: ${summaryText(result)}`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['company-yaml'] }),
        queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }),
      ])
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to apply company YAML')
    },
  })

  const lineCount = useMemo(() => yamlContent.split('\n').length, [yamlContent])

  const downloadYaml = async () => {
    const content = await companyApi.exportYaml().catch(() => yamlContent)
    const url = URL.createObjectURL(new Blob([content], { type: 'text/yaml' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'company.yaml'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-0px)] flex-col bg-obsidian-950 text-slate-100">
      <header className="border-b border-white/[0.08] bg-obsidian-925 px-6 py-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-cyan-200">
              <TerminalSquare className="h-3.5 w-3.5" />
              Company as Code
            </div>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white">Company OS</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Define your AI company in YAML. Apply it to create or update agents, workflows, memory defaults, and operating structure.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => validateMutation.mutate(yamlContent)}
              disabled={validateMutation.isPending}
            >
              <CheckCircle2 size={16} /> Validate
            </button>
            <button
              className="btn-secondary"
              onClick={() => previewMutation.mutate(yamlContent)}
              disabled={previewMutation.isPending}
            >
              <RefreshCw size={16} /> Preview Changes
            </button>
            <button
              className="btn-primary"
              onClick={() => applyMutation.mutate(yamlContent)}
              disabled={applyMutation.isPending}
            >
              <Play size={16} /> {applyMutation.isPending ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-[640px] flex-col border-r border-white/[0.08]">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
              <FileCode2 className="h-4 w-4 text-cyan-300" />
              company.yaml
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-600">{lineCount} lines</span>
            </div>
            <button className="btn-ghost h-8 px-3 text-xs" onClick={downloadYaml}>
              <Download size={14} /> Export
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              language="yaml"
              value={yamlContent}
              beforeMount={configureMonaco}
              theme="obsidian-yaml"
              onChange={value => setYamlContent(value || '')}
              options={{
                minimap: { enabled: false },
                fontFamily: 'JetBrains Mono',
                fontSize: 13,
                lineNumbers: 'on',
                lineHeight: 22,
                tabSize: 2,
                insertSpaces: true,
                wordWrap: 'on',
                automaticLayout: true,
                padding: { top: 18, bottom: 18 },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'all',
              }}
            />
          </div>
        </section>

        <aside className="flex min-h-[640px] flex-col bg-obsidian-925">
          <div className="flex border-b border-white/[0.08] p-2">
            {(['preview', 'validation', 'docs'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`h-9 rounded-lg px-4 text-sm font-medium capitalize transition ${
                  activeTab === tab
                    ? 'bg-accent-500/15 text-accent-100 shadow-glow-sm'
                    : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeTab === 'preview' && (
              <div className="space-y-5">
                <GlowCard glowColor="cyan" active className="p-5">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-5 w-5 text-cyan-300" />
                    <div>
                      <h2 className="text-lg font-semibold text-white">Change preview</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-400">
                        Run Preview Changes to see exactly which agents and workflows will be created or updated.
                      </p>
                    </div>
                  </div>
                </GlowCard>

                {preview ? (
                  <div className="grid gap-5">
                    <StatList title="Agents to create" items={preview.agents_to_create} tone="green" />
                    <StatList title="Agents to update" items={preview.agents_to_update} tone="yellow" />
                    <StatList title="Agents unchanged" items={preview.agents_unchanged} tone="gray" />
                    <StatList title="Workflows to create" items={preview.workflows_to_create} tone="green" />
                    <StatList title="Workflows to update" items={preview.workflows_to_update} tone="yellow" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-slate-500">
                    No preview yet. Make edits, then click Preview Changes.
                  </div>
                )}

                {applySummary && (
                  <GlowCard glowColor="indigo" active className="p-5">
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent-200">Last apply</p>
                    <p className="mt-2 text-sm text-slate-300">{summaryText(applySummary)}</p>
                  </GlowCard>
                )}
              </div>
            )}

            {activeTab === 'validation' && (
              <div className="space-y-5">
                <GlowCard glowColor={validation?.valid ? 'cyan' : 'amber'} active className="p-5">
                  <div className="flex items-center gap-3">
                    {validation?.valid ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-300" />
                    )}
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        {validation ? (validation.valid ? 'Valid YAML' : 'Needs attention') : 'Validation results'}
                      </h2>
                      <p className="text-sm text-slate-500">Schema errors block apply. Warnings are ignored fields or non-fatal notes.</p>
                    </div>
                  </div>
                </GlowCard>

                <StatList title="Errors" items={validation?.errors || []} tone="yellow" />
                <StatList title="Warnings" items={validation?.warnings || []} tone="gray" />
              </div>
            )}

            {activeTab === 'docs' && (
              <div className="space-y-5">
                <GlowCard glowColor="indigo" active className="p-5">
                  <h2 className="text-lg font-semibold text-white">YAML schema reference</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Role names are the glue. Workflow steps reference team roles, and `hitl_before` inserts approval nodes before those roles.
                  </p>
                </GlowCard>
                <pre className="overflow-x-auto rounded-xl border border-white/10 bg-obsidian-950 p-4 font-mono text-xs leading-6 text-slate-300">
                  {schemaExample}
                </pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

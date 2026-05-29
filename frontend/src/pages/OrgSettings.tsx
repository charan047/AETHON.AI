import { DragEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { AlertTriangle, Building2, ImageUp, Plus, Save, Trash2 } from 'lucide-react'
import { extractApiError, filesApi, organizationsApi, orgVariablesApi } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import { HeroPanel } from '../components/ui/HeroPanel'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'
import type { OrgVariableRecord } from '../types'

const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney']

export function OrgSettings() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const org = auth.activeOrg
  const isOwner = org?.role === 'owner'
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [timezone, setTimezone] = useState('UTC')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoPreview, setLogoPreview] = useState('')
  const [localLogoObjectUrl, setLocalLogoObjectUrl] = useState<string | null>(null)
  const [deleteStarted, setDeleteStarted] = useState(false)
  const [deleteName, setDeleteName] = useState('')
  const [newVariableKey, setNewVariableKey] = useState('')
  const [newVariableValue, setNewVariableValue] = useState('')
  const [newVariableDescription, setNewVariableDescription] = useState('')
  const [variableDrafts, setVariableDrafts] = useState<Record<string, { value: string; description: string }>>({})

  useEffect(() => {
    if (!org) return
    setLocalLogoObjectUrl(current => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
    setName(org.name)
    setSlug(org.slug)
    setTimezone(org.timezone || 'UTC')
    setLogoUrl(org.logo_url || '')
    setLogoPreview(org.logo_url || '')
    setDeleteStarted(false)
    setDeleteName('')
  }, [org])

  useEffect(() => {
    return () => {
      if (localLogoObjectUrl) {
        URL.revokeObjectURL(localLogoObjectUrl)
      }
    }
  }, [localLogoObjectUrl])

  const orgVariablesQuery = useQuery({
    queryKey: ['org-variables'],
    queryFn: orgVariablesApi.list,
    enabled: Boolean(org),
  })
  const storageUsageQuery = useQuery({
    queryKey: ['storage-usage'],
    queryFn: filesApi.storageUsage,
    refetchInterval: 60_000,
    enabled: Boolean(org),
  })

  useEffect(() => {
    if (!orgVariablesQuery.data) return
    setVariableDrafts(
      orgVariablesQuery.data.reduce<Record<string, { value: string; description: string }>>((acc, item) => {
        acc[item.id] = {
          value: item.value,
          description: item.description || '',
        }
        return acc
      }, {}),
    )
  }, [orgVariablesQuery.data])

  const updateOrg = useMutation({
    mutationFn: () => {
      if (!org) throw new Error('No organization selected')
      return organizationsApi.update(org.id, {
        name,
        slug,
        timezone,
        logo_url: logoUrl || undefined,
      })
    },
    onSuccess: async updated => {
      toast.success('Organization updated')
      await auth.refreshOrganizations(updated.id)
      void queryClient.invalidateQueries()
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deleteOrg = useMutation({
    mutationFn: () => {
      if (!org) throw new Error('No organization selected')
      return organizationsApi.delete(org.id)
    },
    onSuccess: async () => {
      toast.success('Organization deleted')
      const orgs = await auth.refreshOrganizations(null)
      void queryClient.invalidateQueries()
      navigate(orgs.length ? '/' : '/onboarding')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const createVariable = useMutation({
    mutationFn: () =>
      orgVariablesApi.create({
        key: newVariableKey.trim(),
        value: newVariableValue,
        description: newVariableDescription || undefined,
      }),
    onSuccess: async () => {
      toast.success('Template variable added')
      setNewVariableKey('')
      setNewVariableValue('')
      setNewVariableDescription('')
      await queryClient.invalidateQueries({ queryKey: ['org-variables'] })
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const updateVariable = useMutation({
    mutationFn: ({ id, value, description }: { id: string; value: string; description?: string }) =>
      orgVariablesApi.update(id, { value, description }),
    onSuccess: async () => {
      toast.success('Template variable updated')
      await queryClient.invalidateQueries({ queryKey: ['org-variables'] })
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deleteVariable = useMutation({
    mutationFn: (id: string) => orgVariablesApi.delete(id),
    onSuccess: async () => {
      toast.success('Template variable removed')
      await queryClient.invalidateQueries({ queryKey: ['org-variables'] })
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const variableDraft = (variable: OrgVariableRecord) =>
    variableDrafts[variable.id] || { value: variable.value, description: variable.description || '' }

  const storage = storageUsageQuery.data
  const storageBarColor =
    storage?.status === 'critical'
      ? '#EF4444'
      : storage?.status === 'warning'
        ? '#F59E0B'
        : '#00D97E'

  const handleLogoDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      if (image.width > 200 || image.height > 200) {
        URL.revokeObjectURL(objectUrl)
        toast.error('Logo must be 200x200px or smaller')
        return
      }
      setLocalLogoObjectUrl(current => {
        if (current) URL.revokeObjectURL(current)
        return objectUrl
      })
      setLogoPreview(objectUrl)
      toast.info('Logo preview loaded locally. Add a logo URL before saving.')
    }
    image.src = objectUrl
  }

  if (!org) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div className="card max-w-md p-8">
          <Building2 className="mx-auto text-[#4B5A73]" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">No organization selected</h1>
          <p className="mt-2 text-sm text-[#8B9DBE]">Create or switch into an organization before changing settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <HeroPanel
        kicker="Agency Identity"
        title="Organization Settings"
        subtitle={`Manage identity, branding, and destructive controls for ${org.name}.`}
      />

      <section className="card rounded-[28px] p-7">
        <div className="section-title">Organization</div>
        <div className="mb-6 flex items-center gap-4">
          <AgentAvatar name={org.name} imageUrl={logoPreview || undefined} size="lg" />
          <div className="text-sm text-[var(--t2)]">
            <div className="font-semibold text-[var(--t1)]">{org.name}</div>
            <div>Owner-only identity fields stay locked for non-owners.</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FloatingField label="Organization name" type="text" value={name} onChange={setName} disabled={!isOwner} />
          <FloatingField label="Workspace slug" type="text" value={slug} onChange={setSlug} disabled={!isOwner} />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="group relative block">
            <select
              className="input h-[52px] pt-5"
              value={timezone}
              disabled={!isOwner && org.role !== 'admin'}
              onChange={event => setTimezone(event.target.value)}
            >
              {TIMEZONES.map(zone => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute left-3.5 top-[7px] text-[10px] font-medium uppercase tracking-[0.10em] text-indigo-300/90">
              Timezone
            </span>
          </label>
          <FloatingField
            label="Logo URL"
            type="url"
            value={logoUrl}
            onChange={value => {
              setLocalLogoObjectUrl(current => {
                if (current) URL.revokeObjectURL(current)
                return null
              })
              setLogoUrl(value)
              setLogoPreview(value)
            }}
            disabled={!isOwner}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <button className="btn-primary" disabled={updateOrg.isPending || (!isOwner && org.role !== 'admin')} onClick={() => updateOrg.mutate()}>
            {updateOrg.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>

      <section className="card rounded-[28px] p-7">
        <div className="section-title">Branding</div>
        <label
          onDrop={handleLogoDrop}
          onDragOver={event => event.preventDefault()}
          className="grid cursor-pointer place-items-center rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--bg-s)] p-10 text-center transition hover:border-indigo-500/30 hover:bg-indigo-500/[0.03]"
        >
          <ImageUp className="text-[var(--t2)]" />
          <p className="mt-2 text-sm font-medium text-[var(--t1)]">Drag a logo here for preview</p>
          <p className="mt-1 text-xs text-[var(--t3)]">Maximum 200x200px. Saving still uses the logo URL field above.</p>
        </label>
      </section>

      <section className="card rounded-[28px] p-7">
        <div className="section-title">Storage</div>

        {storageUsageQuery.isLoading ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-s)] px-4 py-5 text-sm text-[var(--t3)]">
            Loading storage usage…
          </div>
        ) : storageUsageQuery.isError ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-950/20 px-4 py-5 text-sm text-red-200">
            {extractApiError(storageUsageQuery.error)}
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-2xl font-bold text-[var(--t1)]">
                  {storage?.used_gb ?? '—'} GB
                </p>
                <p className="mt-0.5 text-sm text-[var(--t3)]">
                  of {storage?.quota_gb ?? '—'} GB used
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm text-[var(--t1)]">
                  {storage?.file_count ?? '—'} files
                </p>
                <p className="font-mono text-xs text-[var(--t3)]">
                  {storage?.percent_used ?? '—'}%
                </p>
              </div>
            </div>

            <div
              className="mt-4 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--border)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: storageBarColor }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(storage?.percent_used ?? 0, 100)}%` }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>

            {storage?.status === 'critical' ? (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-400">
                Storage is over 90% full. Old files may need to be removed.
              </div>
            ) : null}
            {storage?.status === 'warning' ? (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-400">
                Storage is over 75% full.
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="card rounded-[28px] p-7">
        <div className="section-title">Template Variables</div>
        <p className="mb-5 max-w-3xl text-sm leading-6 text-[var(--t2)]">
          Define agency-wide variables once, then use them in any agent system prompt like <span className="rounded-full border border-[var(--border)] bg-[var(--bg-s)] px-2 py-1 font-mono text-xs text-[var(--t1)]">{'{{agency_name}}'}</span>.
        </p>

        <div className="space-y-3">
          {orgVariablesQuery.isLoading && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-s)] px-4 py-5 text-sm text-[var(--t3)]">
              Loading template variables…
            </div>
          )}
          {orgVariablesQuery.isError && (
            <div className="rounded-2xl border border-red-400/20 bg-red-950/20 px-4 py-5 text-sm text-red-200">
              {extractApiError(orgVariablesQuery.error)}
            </div>
          )}
          {orgVariablesQuery.data?.map(variable => {
            const draft = variableDraft(variable)
            return (
              <div key={variable.id} className="row flex flex-col gap-3 rounded-[24px] border border-[var(--border)] bg-[var(--bg-s)] p-4 md:flex-row md:items-start">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-indigo-300">{variable.key}</div>
                  <textarea
                    className="min-h-[92px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-3.5 py-3 text-sm text-[var(--t1)] outline-none transition focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/20"
                    value={draft.value}
                    onChange={event =>
                      setVariableDrafts(current => ({
                        ...current,
                        [variable.id]: {
                          ...draft,
                          value: event.target.value,
                        },
                      }))
                    }
                  />
                  <input
                    className="input h-11"
                    placeholder="Description (optional)"
                    value={draft.description}
                    onChange={event =>
                      setVariableDrafts(current => ({
                        ...current,
                        [variable.id]: {
                          ...draft,
                          description: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="flex gap-2 md:flex-col">
                  <button
                    className="btn-primary btn-sm"
                    disabled={updateVariable.isPending}
                    onClick={() => updateVariable.mutate({ id: variable.id, value: draft.value, description: draft.description })}
                  >
                    <Save size={14} /> Save
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    disabled={deleteVariable.isPending}
                    onClick={() => deleteVariable.mutate(variable.id)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            )
          })}

          {!orgVariablesQuery.isLoading && !orgVariablesQuery.data?.length && (
            <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--bg-s)] px-4 py-8 text-center text-sm text-[var(--t3)]">
              No template variables yet. Add your agency name, standard voice, or signature once and reuse them everywhere.
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 rounded-[24px] border border-[var(--border)] bg-[var(--bg-s)] p-4 md:grid-cols-[1.1fr,1.2fr,1fr,auto] md:items-end">
          <input
            className="input h-11"
            placeholder="agency_name"
            value={newVariableKey}
            onChange={event => setNewVariableKey(event.target.value)}
          />
          <input
            className="input h-11"
            placeholder="Aethon Labs"
            value={newVariableValue}
            onChange={event => setNewVariableValue(event.target.value)}
          />
          <input
            className="input h-11"
            placeholder="Description (optional)"
            value={newVariableDescription}
            onChange={event => setNewVariableDescription(event.target.value)}
          />
          <button
            className="btn-primary h-11"
            disabled={createVariable.isPending || !newVariableKey.trim() || !newVariableValue.trim()}
            onClick={() => createVariable.mutate()}
          >
            <Plus size={14} /> Add Variable
          </button>
        </div>
      </section>

      {isOwner && (
        <section className="card-red rounded-[28px] border border-red-400/20 bg-red-950/20 p-7">
          <div className="section-title mb-4 border-red-400/20 text-red-200">Danger Zone</div>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 text-red-300" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-red-100">Delete organization</h2>
              <p className="mt-1 text-sm text-red-100/70">
                This removes the workspace from member switchers and cannot be undone.
              </p>
              {!deleteStarted ? (
                <button className="btn-danger mt-5" onClick={() => setDeleteStarted(true)}>
                  <Trash2 size={15} /> Delete Organization
                </button>
              ) : (
                <div className="mt-5 rounded-2xl border border-red-400/20 bg-black/20 p-4">
                  <FloatingField label={`Type ${org.name} to confirm`} type="text" value={deleteName} onChange={setDeleteName} />
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      className="btn-danger"
                      disabled={deleteName !== org.name || deleteOrg.isPending}
                      onClick={() => deleteOrg.mutate()}
                    >
                      {deleteOrg.isPending ? 'Deleting...' : 'Final Confirm Delete'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setDeleteStarted(false)
                        setDeleteName('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

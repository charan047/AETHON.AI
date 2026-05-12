import { DragEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, ImageUp, Trash2 } from 'lucide-react'
import { extractApiError, organizationsApi } from '../api/client'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../lib/toast'

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
  const [deleteStarted, setDeleteStarted] = useState(false)
  const [deleteName, setDeleteName] = useState('')

  useEffect(() => {
    if (!org) return
    setName(org.name)
    setSlug(org.slug)
    setTimezone(org.timezone || 'UTC')
    setLogoUrl(org.logo_url || '')
    setLogoPreview(org.logo_url || '')
    setDeleteStarted(false)
    setDeleteName('')
  }, [org])

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
      setLogoPreview(objectUrl)
      toast.info('Logo preview loaded locally. Add a logo URL before saving.')
    }
    image.src = objectUrl
  }

  if (!org) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div className="card max-w-md p-8">
          <Building2 className="mx-auto text-obsidian-600" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">No organization selected</h1>
          <p className="mt-2 text-sm text-obsidian-400">Create or switch into an organization before changing settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Workspace settings</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-white">Organization Settings</h1>
        <p className="mt-2 text-sm text-obsidian-400">Tune the identity, timezone, and deletion controls for {org.name}.</p>
      </div>

      <section className="card p-6">
        <div className="mb-6 flex items-center gap-4">
          <AgentAvatar name={org.name} imageUrl={logoPreview || undefined} size="lg" />
          <div>
            <h2 className="text-xl font-semibold text-white">General</h2>
            <p className="mt-1 text-sm text-obsidian-500">Owner-only fields are locked for admins and members.</p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="label">Org name</label>
            <input className="input" value={name} disabled={!isOwner} onChange={event => setName(event.target.value)} />
          </div>
          <div>
            <label className="label">Org slug</label>
            <input className="input" value={slug} disabled={!isOwner} onChange={event => setSlug(event.target.value)} />
            <p className="mt-1 text-xs text-amber-300">Changing the slug can affect org URLs and shared references.</p>
          </div>
          <div>
            <label className="label">Timezone</label>
            <select className="input" value={timezone} disabled={!isOwner && org.role !== 'admin'} onChange={event => setTimezone(event.target.value)}>
              {TIMEZONES.map(zone => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Logo URL</label>
            <input className="input" value={logoUrl} disabled={!isOwner} onChange={event => {
              setLogoUrl(event.target.value)
              setLogoPreview(event.target.value)
            }} placeholder="https://..." />
          </div>
        </div>

        <label
          onDrop={handleLogoDrop}
          onDragOver={event => event.preventDefault()}
          className="mt-5 grid cursor-pointer place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center transition hover:border-accent-400/40"
        >
          <ImageUp className="text-obsidian-500" />
          <p className="mt-2 text-sm text-obsidian-300">Drag a logo here for local preview</p>
          <p className="mt-1 text-xs text-obsidian-500">Maximum 200x200px. Phase 5 saves logo URLs only.</p>
        </label>

        <div className="mt-6 flex justify-end">
          <button className="btn-primary" disabled={updateOrg.isPending || (!isOwner && org.role !== 'admin')} onClick={() => updateOrg.mutate()}>
            {updateOrg.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>

      {isOwner && (
        <section className="rounded-3xl border border-red-400/20 bg-red-950/20 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 text-red-300" />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-red-100">Danger Zone</h2>
              <p className="mt-1 text-sm text-red-100/70">Deleting an organization disables the workspace and removes it from member org switchers.</p>
              {!deleteStarted ? (
                <button className="btn-ghost mt-5 border border-red-400/20 text-red-200 hover:text-red-100" onClick={() => setDeleteStarted(true)}>
                  <Trash2 size={15} /> Delete Organization
                </button>
              ) : (
                <div className="mt-5 rounded-2xl border border-red-400/20 bg-black/20 p-4">
                  <label className="label text-red-100">Type "{org.name}" to confirm</label>
                  <input className="input border-red-400/20" value={deleteName} onChange={event => setDeleteName(event.target.value)} />
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={deleteName !== org.name || deleteOrg.isPending}
                      onClick={() => deleteOrg.mutate()}
                    >
                      {deleteOrg.isPending ? 'Deleting...' : 'Final Confirm Delete'}
                    </button>
                    <button className="btn-secondary" onClick={() => {
                      setDeleteStarted(false)
                      setDeleteName('')
                    }}>Cancel</button>
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

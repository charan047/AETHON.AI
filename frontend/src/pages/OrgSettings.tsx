import { DragEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, ImageUp, Trash2 } from 'lucide-react'
import { extractApiError, organizationsApi } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import { GlassCard } from '../components/ui/GlassCard'
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
  const [localLogoObjectUrl, setLocalLogoObjectUrl] = useState<string | null>(null)
  const [deleteStarted, setDeleteStarted] = useState(false)
  const [deleteName, setDeleteName] = useState('')

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
        <div className="glass-card max-w-md p-8">
          <Building2 className="mx-auto text-[#4B5A73]" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">No organization selected</h1>
          <p className="mt-2 text-sm text-[#8B9DBE]">Create or switch into an organization before changing settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="page-header rounded-[24px] border border-white/[0.06] bg-white/[0.02]">
        <div>
          <h1 className="page-title">Organization Settings</h1>
          <p className="page-subtitle">Manage identity, branding, and destructive controls for {org.name}.</p>
        </div>
      </div>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="section-title">Organization</div>
        <div className="mb-6 flex items-center gap-4">
          <AgentAvatar name={org.name} imageUrl={logoPreview || undefined} size="lg" />
          <div className="text-sm text-[#8B9DBE]">
            <div className="font-semibold text-white">{org.name}</div>
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
      </GlassCard>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="section-title">Branding</div>
        <label
          onDrop={handleLogoDrop}
          onDragOver={event => event.preventDefault()}
          className="grid cursor-pointer place-items-center rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.025] p-10 text-center transition hover:border-indigo-500/30"
        >
          <ImageUp className="text-[#8B9DBE]" />
          <p className="mt-2 text-sm text-white">Drag a logo here for preview</p>
          <p className="mt-1 text-xs text-[#8B9DBE]">Maximum 200x200px. Saving still uses the logo URL field above.</p>
        </label>
      </GlassCard>

      {isOwner && (
        <section className="glass-card-red rounded-[28px] border border-red-400/20 bg-red-950/20 p-6">
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

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bot, Download, ExternalLink, Flag, ShieldCheck, Star, Store, Workflow } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { marketplaceApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { InstallModal } from '../components/marketplace/InstallModal'
import { Skeleton } from '../components/ui/Skeleton'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import type { MarketplaceListing, MarketplaceListingType } from '../types'

const TYPE_LABELS: Record<MarketplaceListingType, string> = {
  agent: 'Agent',
  workflow: 'Workflow',
  eval_suite: 'Eval Suite',
}

function iconFor(type: MarketplaceListingType) {
  if (type === 'workflow') return Workflow
  if (type === 'eval_suite') return ShieldCheck
  return Bot
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return value.toString()
}

function MarkdownBlock({ content }: { content?: string | null }) {
  if (!content) return null
  const lines = content.split('\n')
  return (
    <div className="space-y-3 text-sm leading-7 text-obsidian-300">
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-2" />
        if (line.startsWith('### ')) return <h3 key={index} className="pt-4 text-lg font-semibold text-white">{line.slice(4)}</h3>
        if (line.startsWith('## ')) return <h2 key={index} className="pt-5 text-2xl font-semibold tracking-tight text-white">{line.slice(3)}</h2>
        if (line.startsWith('# ')) return <h1 key={index} className="pt-5 text-3xl font-semibold tracking-tight text-white">{line.slice(2)}</h1>
        if (line.startsWith('- ')) return <p key={index} className="pl-4 before:mr-2 before:text-accent-300 before:content-['•']">{line.slice(2)}</p>
        if (line.startsWith('```')) return <div key={index} className="rounded-xl border border-white/10 bg-obsidian-950 px-3 py-2 font-mono text-xs text-cyan-200">code block</div>
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

function ReviewForm({ listingId }: { listingId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const review = useMutation({
    mutationFn: () => marketplaceApi.review(listingId, { rating, title, body }),
    onSuccess: () => {
      toast.success('Review submitted')
      qc.invalidateQueries({ queryKey: ['marketplace', 'detail'] })
      setOpen(false)
    },
    onError: (error: any) => toast.error(error.response?.data?.detail || 'Could not submit review'),
  })

  if (!open) {
    return <button className="btn-secondary" onClick={() => setOpen(true)}>Write a review</button>
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="grid gap-3 md:grid-cols-[140px_1fr]">
        <div>
          <label className="label">Rating</label>
          <select className="input" value={rating} onChange={event => setRating(Number(event.target.value))}>
            {[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} stars</option>)}
          </select>
        </div>
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Short, useful headline" />
        </div>
      </div>
      <label className="label mt-3">Review</label>
      <textarea className="input min-h-24" value={body} onChange={event => setBody(event.target.value)} placeholder="What worked well? Who is this useful for?" />
      <div className="mt-4 flex gap-2">
        <button className="btn-primary" disabled={review.isPending} onClick={() => review.mutate()}>{review.isPending ? 'Submitting...' : 'Submit review'}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

export function MarketplaceDetail() {
  const { slug = '' } = useParams()
  const auth = useAuth()
  const [installing, setInstalling] = useState<MarketplaceListing | null>(null)
  const { data: listing, isLoading } = useQuery({
    queryKey: ['marketplace', 'detail', slug],
    queryFn: () => marketplaceApi.detail(slug),
    enabled: Boolean(slug),
  })
  const { data: installs = [] } = useQuery({
    queryKey: ['marketplace', 'installs'],
    queryFn: marketplaceApi.myInstalls,
    enabled: auth.isAuthenticated,
  })
  const installed = listing ? installs.some(item => item.listing.id === listing.id) : false
  const installedResource = listing ? installs.find(item => item.listing.id === listing.id)?.installed_resource_id : null
  const Icon = listing ? iconFor(listing.listing_type) : Store

  const distribution = useMemo(() => {
    const counts = [5, 4, 3, 2, 1].map(score => ({
      score,
      count: listing?.reviews?.filter(review => review.rating === score).length || 0,
    }))
    const max = Math.max(1, ...counts.map(item => item.count))
    return counts.map(item => ({ ...item, percent: item.count / max * 100 }))
  }, [listing?.reviews])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-obsidian-950 p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <Skeleton className="h-72 rounded-3xl" />
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <Skeleton className="h-96 rounded-2xl" />
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="grid min-h-screen place-items-center bg-obsidian-950 text-center">
        <div>
          <Store className="mx-auto text-obsidian-600" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-white">Listing not found</h1>
          <Link className="btn-primary mt-5" to="/marketplace">Back to marketplace</Link>
        </div>
      </div>
    )
  }

  const installedPath = listing.listing_type === 'agent' ? '/agents' : listing.listing_type === 'workflow' ? '/workflows' : '/evals'

  return (
    <div className="min-h-screen overflow-y-auto bg-obsidian-950 text-white">
      <header className="border-b border-white/10 bg-obsidian-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/marketplace" className="btn-ghost px-2"><ArrowLeft size={16} /> Marketplace</Link>
          <Link to="/" className="flex items-center gap-2 text-sm text-obsidian-400 hover:text-white"><Store size={16} /> Obsidian</Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[1fr_380px]">
        <section className="space-y-8">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-accent-500/70 via-cyan-500/25 to-obsidian-900 p-10">
            {listing.preview_image_url ? (
              <img src={listing.preview_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            ) : (
              <div className="absolute right-8 top-8 opacity-20"><Icon size={160} /></div>
            )}
            <div className="relative max-w-2xl">
              <div className="mb-5 flex flex-wrap gap-2">
                <span className="badge-purple">{TYPE_LABELS[listing.listing_type]}</span>
                <span className="badge-blue capitalize">{listing.category.replace('_', ' ')}</span>
                <span className="badge-gray">v{listing.version}</span>
              </div>
              <h1 className="text-5xl font-semibold tracking-[-0.06em]">{listing.name}</h1>
              <p className="mt-4 text-lg leading-8 text-white/78">{listing.tagline}</p>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="mb-4 text-2xl font-semibold text-white">Overview</h2>
            <MarkdownBlock content={listing.description} />
          </div>

          {listing.readme && (
            <div className="card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-white">Readme</h2>
                <span className="font-mono text-xs text-obsidian-500">Markdown docs</span>
              </div>
              <MarkdownBlock content={listing.readme} />
            </div>
          )}

          <div className="card p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-white">Reviews</h2>
                <p className="mt-1 text-sm text-obsidian-500">Trust signals from founders who installed this kit.</p>
              </div>
              {installed && <ReviewForm listingId={listing.id} />}
            </div>
            <div className="grid gap-5 md:grid-cols-[200px_1fr]">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                <div className="text-5xl font-semibold text-white">{listing.rating_avg.toFixed(1)}</div>
                <div className="mt-2 flex justify-center gap-0.5 text-amber-300">
                  {[...Array(5)].map((_, index) => <Star key={index} size={16} fill={index < Math.round(listing.rating_avg) ? 'currentColor' : 'none'} />)}
                </div>
                <p className="mt-2 text-xs text-obsidian-500">{listing.rating_count} reviews</p>
              </div>
              <div className="space-y-2">
                {distribution.map(item => (
                  <div key={item.score} className="flex items-center gap-3 text-sm text-obsidian-400">
                    <span className="w-10">{item.score}★</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-obsidian-800">
                      <div className="h-full rounded-full bg-amber-300" style={{ width: `${item.percent}%` }} />
                    </div>
                    <span className="w-8 text-right font-mono text-xs">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {(listing.reviews || []).map(review => (
                <div key={review.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="flex items-start gap-3">
                    <AgentAvatar name={review.reviewer_user_id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{review.title || 'Helpful review'}</span>
                        <span className="font-mono text-xs text-amber-300">{review.rating}★</span>
                      </div>
                      {review.body && <p className="mt-2 text-sm leading-6 text-obsidian-400">{review.body}</p>}
                    </div>
                  </div>
                </div>
              ))}
              {!listing.reviews?.length && <p className="text-sm text-obsidian-500">No reviews yet. Install it, try it, and leave the first signal.</p>}
            </div>
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:h-max">
          <div className="rounded-2xl border border-white/10 bg-obsidian-900 p-5 shadow-glow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="badge-purple">{TYPE_LABELS[listing.listing_type]}</span>
              <span className="badge-blue capitalize">{listing.category.replace('_', ' ')}</span>
            </div>
            {installed ? (
              <Link className="btn-secondary h-12 w-full justify-center text-emerald-200" to={`${installedPath}${installedResource ? `?installed=${installedResource}` : ''}`}>
                ✓ Installed — View in {listing.listing_type === 'agent' ? 'My Team' : listing.listing_type === 'workflow' ? 'Workflows' : 'Eval Lab'}
              </Link>
            ) : (
              <button className="btn-primary h-12 w-full" onClick={() => setInstalling(listing)}>
                Install to My Company <Download size={16} />
              </button>
            )}
            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.03] p-3"><div className="font-mono text-sm text-white">{formatCount(listing.install_count)}</div><div className="mt-1 text-[11px] text-obsidian-500">installs</div></div>
              <div className="rounded-xl bg-white/[0.03] p-3"><div className="font-mono text-sm text-white">{listing.rating_avg.toFixed(1)}</div><div className="mt-1 text-[11px] text-obsidian-500">rating</div></div>
              <div className="rounded-xl bg-white/[0.03] p-3"><div className="font-mono text-sm text-white">{formatCount(listing.view_count)}</div><div className="mt-1 text-[11px] text-obsidian-500">views</div></div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-white">Publisher</h3>
            <div className="mt-4 flex items-center gap-3">
              <AgentAvatar name={listing.publisher_org?.name || listing.publisher?.name || 'Community'} size="md" />
              <div>
                <div className="text-sm font-medium text-white">{listing.publisher_org?.name || listing.publisher?.name || 'Community publisher'}</div>
                <div className="text-xs text-obsidian-500">Trusted marketplace contributor</div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-white">Tags</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {listing.tags.map(tag => <span key={tag} className="rounded-full bg-white/[0.04] px-2.5 py-1 text-xs text-obsidian-300">#{tag}</span>)}
              {!listing.tags.length && <span className="text-sm text-obsidian-500">No tags yet</span>}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-white">Version history</h3>
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="font-mono text-xs text-accent-200">v{listing.version}</div>
                <div className="mt-1 text-xs text-obsidian-500">Current published version</div>
              </div>
            </div>
          </div>

          {listing.source_url && (
            <a className="card flex items-center justify-between p-5 text-sm text-obsidian-300 hover:text-white" href={listing.source_url} target="_blank" rel="noreferrer">
              Source URL <ExternalLink size={16} />
            </a>
          )}

          <button className="btn-ghost w-full justify-start text-obsidian-500"><Flag size={15} /> Report listing</button>
        </aside>
      </main>

      <InstallModal listing={installing} open={Boolean(installing)} onClose={() => setInstalling(null)} />
    </div>
  )
}

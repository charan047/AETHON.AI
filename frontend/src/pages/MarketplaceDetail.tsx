import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bot, Download, ExternalLink, Flag, LogOut, ShieldCheck, Star, Store, UserCircle, Workflow, Wrench } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { marketplaceApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { InstallModal } from '../components/marketplace/InstallModal'
import { Skeleton } from '../components/ui/Skeleton'
import { AgentAvatar } from '../components/ui/AgentAvatar'
import type { MarketplaceListing, MarketplaceListingType } from '../types'
import { toast } from '../lib/toast'

const TYPE_LABELS: Record<MarketplaceListingType, string> = {
  agent: 'Agent',
  workflow: 'Workflow',
  tool_config: 'Tool Config',
  eval_suite: 'Eval Suite',
}

function iconFor(type: MarketplaceListingType) {
  if (type === 'workflow') return Workflow
  if (type === 'tool_config') return Wrench
  if (type === 'eval_suite') return ShieldCheck
  return Bot
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return value.toString()
}

function slugifyHeading(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function MarkdownBlock({ content }: { content?: string | null }) {
  if (!content) return null
  const lines = content.split('\n')
  return (
    <div className="space-y-3 text-sm leading-7 text-obsidian-300">
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-2" />
        if (line.startsWith('### ')) {
          const text = line.slice(4)
          return <h3 key={index} id={slugifyHeading(text)} className="scroll-mt-24 pt-4 text-lg font-semibold text-white">{text}</h3>
        }
        if (line.startsWith('## ')) {
          const text = line.slice(3)
          return <h2 key={index} id={slugifyHeading(text)} className="scroll-mt-24 pt-5 text-2xl font-semibold tracking-tight text-white">{text}</h2>
        }
        if (line.startsWith('# ')) {
          const text = line.slice(2)
          return <h1 key={index} id={slugifyHeading(text)} className="scroll-mt-24 pt-5 text-3xl font-semibold tracking-tight text-white">{text}</h1>
        }
        if (line.startsWith('- ')) return <p key={index} className="pl-4 before:mr-2 before:text-accent-300 before:content-['•']">{line.slice(2)}</p>
        if (line.startsWith('```')) return <div key={index} className="rounded-xl border border-white/10 bg-obsidian-950 px-3 py-2 font-mono text-xs text-cyan-200">code block</div>
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

function readmeHeadings(content?: string | null) {
  return (content || '')
    .split('\n')
    .filter(line => /^#{1,3}\s+/.test(line))
    .map(line => {
      const depth = line.match(/^#+/)?.[0].length || 1
      const text = line.replace(/^#+\s*/, '').trim()
      return { depth, text, id: slugifyHeading(text) }
    })
    .filter(heading => heading.text)
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
  const navigate = useNavigate()
  const auth = useAuth()
  const [installing, setInstalling] = useState<MarketplaceListing | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
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

  const installedPath = listing.listing_type === 'agent'
    ? '/agents'
    : listing.listing_type === 'workflow'
      ? '/workflows'
      : listing.listing_type === 'tool_config'
        ? '/tools'
        : '/evals'
  const headings = readmeHeadings(listing.readme)

  return (
    <div className="min-h-dvh bg-obsidian-950 text-white">
      <header className="border-b border-white/10 bg-obsidian-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/marketplace" className="btn-ghost px-2"><ArrowLeft size={16} /> Marketplace</Link>
          <div className="flex items-center gap-2">
            <Link to="/" className="hidden items-center gap-2 text-sm text-obsidian-400 hover:text-white sm:flex"><Store size={16} /> Obsidian</Link>
            {auth.isAuthenticated ? (
              <div className="relative">
                <button
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-obsidian-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                  onClick={() => setUserMenuOpen(open => !open)}
                >
                  <UserCircle size={17} />
                  <span className="hidden max-w-36 truncate md:inline">{auth.email || 'Account'}</span>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-white/10 bg-obsidian-900 shadow-glow-lg">
                    <div className="border-b border-white/10 px-4 py-3">
                      <div className="text-xs text-obsidian-500">Signed in as</div>
                      <div className="mt-0.5 truncate text-sm font-medium text-white">{auth.email || 'Workspace user'}</div>
                    </div>
                    <button className="block w-full px-4 py-3 text-left text-sm text-obsidian-300 hover:bg-white/[0.04] hover:text-white" onClick={() => navigate('/')}>
                      Command Center
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-200 hover:bg-red-500/10"
                      onClick={() => { auth.logout(); navigate('/login') }}
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="btn-secondary h-10" onClick={() => navigate('/login')}>Sign in</button>
            )}
          </div>
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
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-white">Readme</h2>
                <span className="font-mono text-xs text-obsidian-500">Markdown docs</span>
              </div>
              <div className={headings.length ? 'grid gap-6 lg:grid-cols-[180px_1fr]' : ''}>
                {headings.length > 0 && (
                  <nav className="h-max rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-obsidian-500">Contents</div>
                    <div className="space-y-1">
                      {headings.slice(0, 8).map(heading => (
                        <a
                          key={`${heading.id}-${heading.text}`}
                          className={clsx('block truncate rounded-lg px-2 py-1 text-xs text-obsidian-400 hover:bg-white/[0.04] hover:text-white', heading.depth > 2 && 'pl-4')}
                          href={`#${heading.id}`}
                        >
                          {heading.text}
                        </a>
                      ))}
                    </div>
                  </nav>
                )}
                <MarkdownBlock content={listing.readme} />
              </div>
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
                    <AgentAvatar name={review.reviewer?.name || review.reviewer_user_id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-obsidian-500">
                        <span className="font-medium text-white">{review.reviewer?.name || 'Marketplace user'}</span>
                        <span className="font-mono text-xs text-amber-300">{review.rating}★</span>
                        <span>{formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}</span>
                      </div>
                      <div className="mt-1 font-medium text-white">{review.title || 'Helpful review'}</div>
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
                ✓ Installed — View in {listing.listing_type === 'agent' ? 'My Team' : listing.listing_type === 'workflow' ? 'Workflows' : listing.listing_type === 'tool_config' ? 'Tools' : 'Eval Lab'}
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
                <div className="text-xs text-obsidian-500">
                  Trusted contributor · {listing.publisher_other_listing_count ?? 0} other listing{(listing.publisher_other_listing_count ?? 0) === 1 ? '' : 's'}
                </div>
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
              {(listing.version_history?.length ? listing.version_history : [{ version: listing.version, note: 'Current published version', created_at: listing.published_at || listing.created_at }]).slice(0, 3).map((version, index) => (
                <div key={`${version.version}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                  <div className="font-mono text-xs text-accent-200">v{version.version}</div>
                  <div className="mt-1 text-xs text-obsidian-500">{version.note || (index === 0 ? 'Current version' : 'Previous version')}</div>
                  {(version.published_at || version.created_at) && (
                    <div className="mt-1 text-[11px] text-obsidian-600">
                      {formatDistanceToNow(new Date(version.published_at || version.created_at || ''), { addSuffix: true })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {listing.source_url && (
            <a className="card flex items-center justify-between p-5 text-sm text-obsidian-300 hover:text-white" href={listing.source_url} target="_blank" rel="noreferrer">
              Source URL <ExternalLink size={16} />
            </a>
          )}

          <button
            className="btn-ghost w-full justify-start text-obsidian-500"
            onClick={() => toast.info('Thanks. A marketplace moderator will review this listing.')}
          >
            <Flag size={15} /> Report listing
          </button>
        </aside>
      </main>

      <InstallModal listing={installing} open={Boolean(installing)} onClose={() => setInstalling(null)} />
    </div>
  )
}

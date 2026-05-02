import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bot, Boxes, CheckCircle2, Download, LogOut, Search, ShieldCheck, Sparkles, Star, Store, UserCircle, Workflow, Wrench } from 'lucide-react'
import { clsx } from 'clsx'
import { marketplaceApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { InstallModal } from '../components/marketplace/InstallModal'
import { Skeleton } from '../components/ui/Skeleton'
import type { MarketplaceCategory, MarketplaceListing, MarketplaceListingType } from '../types'

const CATEGORIES: { id: MarketplaceCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'development', label: 'Development' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'finance', label: 'Finance' },
  { id: 'customer_support', label: 'Customer Support' },
  { id: 'research', label: 'Research' },
  { id: 'hr', label: 'HR' },
  { id: 'operations', label: 'Operations' },
  { id: 'data', label: 'Data' },
]

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

function gradientFor(index: number) {
  const gradients = [
    'from-accent-500/80 via-cyan-400/45 to-obsidian-900',
    'from-cyan-500/75 via-emerald-400/35 to-obsidian-900',
    'from-amber-400/70 via-accent-500/40 to-obsidian-900',
    'from-rose-500/70 via-orange-400/30 to-obsidian-900',
  ]
  return gradients[index % gradients.length]
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return value.toString()
}

function ListingCard({ listing, index, installed, onInstall }: {
  listing: MarketplaceListing
  index: number
  installed: boolean
  onInstall: (listing: MarketplaceListing) => void
}) {
  const Icon = iconFor(listing.listing_type)
  return (
    <Link
      to={`/marketplace/${listing.slug}`}
      className="listing-card group overflow-hidden rounded-2xl border border-white/10 bg-obsidian-900 transition-all duration-150 hover:-translate-y-1 hover:border-accent-400/40 hover:shadow-glow-md"
    >
      <div className="relative h-36 overflow-hidden">
        {listing.preview_image_url ? (
          <img src={listing.preview_image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={clsx('grid h-full place-items-center bg-gradient-to-br', gradientFor(index))}>
            <Icon size={36} className="text-white/85 drop-shadow" />
          </div>
        )}
        <div className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/35 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          {TYPE_LABELS[listing.listing_type]}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-3 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium capitalize text-cyan-200">
          {listing.category.replace('_', ' ')}
        </div>
        <h3 className="line-clamp-1 text-lg font-semibold tracking-tight text-white">{listing.name}</h3>
        <p className="mt-1 line-clamp-1 text-sm text-obsidian-400">{listing.tagline}</p>
        <div className="mt-4 flex items-center gap-3 text-xs text-obsidian-500">
          <span className="inline-flex items-center gap-1 text-amber-300"><Star size={13} fill="currentColor" /> {listing.rating_avg.toFixed(1)} ({listing.rating_count})</span>
          <span className="inline-flex items-center gap-1"><Download size={13} /> {formatCount(listing.install_count)}</span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="truncate text-xs text-obsidian-500">by {listing.publisher_org?.name || 'Community'}</span>
          <button
            className={clsx(
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              installed ? 'bg-emerald-400/15 text-emerald-200' : 'bg-accent-500 text-white group-hover:bg-accent-400',
            )}
            onClick={event => {
              event.preventDefault()
              onInstall(listing)
            }}
          >
            {installed ? 'Installed ✓' : 'Install'}
          </button>
        </div>
      </div>
    </Link>
  )
}

function SearchResultRow({ listing, installed, onInstall }: {
  listing: MarketplaceListing
  installed: boolean
  onInstall: (listing: MarketplaceListing) => void
}) {
  const Icon = iconFor(listing.listing_type)
  return (
    <div className="listing-card flex flex-col gap-4 rounded-2xl border border-white/10 bg-obsidian-900 p-4 transition hover:border-accent-400/35 md:flex-row md:items-center">
      <Link to={`/marketplace/${listing.slug}`} className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-500/60 to-cyan-500/20">
        <Icon size={26} className="text-white" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/marketplace/${listing.slug}`} className="text-lg font-semibold text-white hover:text-accent-200">{listing.name}</Link>
          <span className="badge-gray">{TYPE_LABELS[listing.listing_type]}</span>
          <span className="badge-blue capitalize">{listing.category.replace('_', ' ')}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-obsidian-400">{listing.tagline}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {listing.tags.slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-xs text-obsidian-400">#{tag}</span>)}
        </div>
      </div>
      <button className={installed ? 'btn-secondary text-emerald-200' : 'btn-primary'} onClick={() => onInstall(listing)}>
        {installed ? 'Installed ✓' : 'Install'}
      </button>
    </div>
  )
}

export function Marketplace() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<MarketplaceCategory | 'all'>('all')
  const [type, setType] = useState<MarketplaceListingType | 'all'>('all')
  const [sortBy, setSortBy] = useState<'popular' | 'newest' | 'rating'>('popular')
  const [freeOnly, setFreeOnly] = useState(false)
  const [selectedTag, setSelectedTag] = useState('')
  const [installing, setInstalling] = useState<MarketplaceListing | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', query, category, type, sortBy],
    queryFn: () => marketplaceApi.search({ query, category, type, sort_by: sortBy, limit: 36 }),
  })
  const { data: installs = [] } = useQuery({
    queryKey: ['marketplace', 'installs'],
    queryFn: marketplaceApi.myInstalls,
    enabled: auth.isAuthenticated,
  })

  const installedIds = useMemo(() => new Set(installs.map(item => item.listing.id)), [installs])
  const rawItems = data?.items || []
  const topTags = useMemo(() => {
    const counts = new Map<string, number>()
    rawItems.flatMap(item => item.tags).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag)
  }, [rawItems])
  const items = rawItems.filter(item => (!freeOnly || item.is_free) && (!selectedTag || item.tags.includes(selectedTag)))
  const stats = useMemo(() => {
    const agentCount = rawItems.filter(item => item.listing_type === 'agent').length
    const workflowCount = rawItems.filter(item => item.listing_type === 'workflow').length
    const toolCount = rawItems.filter(item => item.listing_type === 'tool_config').length
    const installsCount = rawItems.reduce((sum, item) => sum + item.install_count, 0)
    return { agentCount, workflowCount, toolCount, installsCount }
  }, [rawItems])

  return (
    <div className="min-h-dvh bg-obsidian-950 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-obsidian-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-cyan-500 shadow-glow-sm">
              <Store size={19} />
            </div>
            <div>
              <div className="font-semibold tracking-tight">Obsidian Marketplace</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-obsidian-500">AI OS Kits</div>
            </div>
          </Link>
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-obsidian-500" size={18} />
            <input
              autoFocus
              className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm outline-none transition focus:border-accent-400/60 focus:shadow-glow-sm"
              placeholder="Search agents, workflows, tools, eval suites..."
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            {auth.isAuthenticated ? (
              <>
                <button className="btn-primary h-11" onClick={() => navigate('/marketplace/publish')}>Publish</button>
                <div className="relative">
                  <button
                    className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-obsidian-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                    onClick={() => setUserMenuOpen(open => !open)}
                  >
                    <UserCircle size={18} />
                    <span className="hidden max-w-32 truncate md:inline">{auth.email || 'Account'}</span>
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
              </>
            ) : (
              <button className="btn-secondary h-11" onClick={() => navigate('/login')}>Sign in</button>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.24),transparent_28%),radial-gradient(circle_at_70%_25%,rgba(6,182,212,0.14),transparent_24%)]" />
        <div className="relative mx-auto grid min-h-[300px] max-w-7xl place-items-center px-4 py-16 text-center">
          <div>
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-accent-400/20 bg-accent-400/10 px-3 py-1 text-sm text-accent-100">
              <Sparkles size={15} /> Community-built operating leverage
            </div>
            <h1 className="text-5xl font-semibold tracking-[-0.06em] md:text-7xl">The AI Company Starter Kit</h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-obsidian-300">
              Pre-built agents, workflows, and tool configs from founders who’ve already solved the hard parts.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 font-mono text-sm text-obsidian-300">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">{stats.agentCount} agents</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">{stats.workflowCount} workflows</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">{stats.toolCount} tools</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">{formatCount(stats.installsCount)} installs this week</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-5">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {CATEGORIES.map(item => (
            <button
              key={item.id}
              className={clsx('shrink-0 rounded-full border px-4 py-2 text-sm transition', category === item.id ? 'border-accent-400/50 bg-accent-500 text-white shadow-glow-sm' : 'border-white/10 bg-white/[0.03] text-obsidian-300 hover:bg-white/[0.06]')}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 pb-12 lg:grid-cols-[240px_1fr]">
        <aside className="h-max rounded-2xl border border-white/10 bg-obsidian-900 p-4 lg:sticky lg:top-24">
          <div className="space-y-5">
            <div>
              <label className="label">Type</label>
              <select className="input" value={type} onChange={event => setType(event.target.value as MarketplaceListingType | 'all')}>
                <option value="all">All</option>
                <option value="agent">Agents</option>
                <option value="workflow">Workflows</option>
                <option value="tool_config">Tool Configs</option>
                <option value="eval_suite">Eval Suites</option>
              </select>
            </div>
            <div>
              <label className="label">Sort</label>
              <select className="input" value={sortBy} onChange={event => setSortBy(event.target.value as 'popular' | 'newest' | 'rating')}>
                <option value="popular">Most Popular</option>
                <option value="newest">Newest</option>
                <option value="rating">Highest Rated</option>
              </select>
            </div>
            <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-obsidian-300">
              Free only
              <input type="checkbox" className="accent-accent-500" checked={freeOnly} onChange={event => setFreeOnly(event.target.checked)} />
            </label>
            <div>
              <label className="label">Top tags</label>
              <div className="flex flex-wrap gap-2">
                {topTags.map(tag => (
                  <button
                    key={tag}
                    className={clsx('rounded-full px-2.5 py-1 text-xs transition', selectedTag === tag ? 'bg-cyan-400/20 text-cyan-100' : 'bg-white/[0.04] text-obsidian-400 hover:bg-white/[0.08]')}
                    onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                  >
                    #{tag}
                  </button>
                ))}
                {!topTags.length && <p className="text-xs text-obsidian-500">Tags appear after listings load.</p>}
              </div>
            </div>
          </div>
        </aside>

        <section>
          {query && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div>
                <p className="font-medium text-white">Search results for “{query}”</p>
                <p className="mt-1 text-sm text-obsidian-500">{items.length} result{items.length === 1 ? '' : 's'} found</p>
              </div>
              <button className="btn-ghost" onClick={() => setQuery('')}>Clear</button>
            </div>
          )}

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(9)].map((_, index) => <Skeleton key={index} className="h-72 rounded-2xl" />)}
            </div>
          ) : !items.length ? (
            <div className="grid min-h-[360px] place-items-center rounded-2xl border border-white/10 bg-obsidian-900 text-center">
              <div>
                <Boxes className="mx-auto text-obsidian-500" size={42} />
                <h2 className="mt-4 text-xl font-semibold text-white">No marketplace listings found</h2>
                <p className="mt-2 text-sm text-obsidian-500">Try a different search, category, or type filter.</p>
              </div>
            </div>
          ) : query ? (
            <div className="space-y-3">
              {items.map(item => (
                <SearchResultRow key={item.id} listing={item} installed={installedIds.has(item.id)} onInstall={setInstalling} />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item, index) => (
                <ListingCard key={item.id} listing={item} index={index} installed={installedIds.has(item.id)} onInstall={setInstalling} />
              ))}
            </div>
          )}
        </section>
      </main>

      <InstallModal listing={installing} open={Boolean(installing)} onClose={() => setInstalling(null)} />
    </div>
  )
}

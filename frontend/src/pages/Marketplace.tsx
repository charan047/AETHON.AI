import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Bot, Boxes, LogOut, MessageSquareQuote, Search, ShieldCheck, UserCircle, Zap } from 'lucide-react'
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

const CATEGORY_META: Record<string, {
  icon: typeof Bot
  pill: string
  bar: string
  iconWrap: string
}> = {
  research: {
    icon: Search,
    pill: 'Research',
    bar: 'from-indigo-500 to-indigo-300',
    iconWrap: 'bg-indigo-500/12 text-indigo-300',
  },
  marketing: {
    icon: MessageSquareQuote,
    pill: 'Outreach',
    bar: 'from-amber-500 to-amber-300',
    iconWrap: 'bg-amber-500/12 text-amber-300',
  },
  customer_support: {
    icon: ShieldCheck,
    pill: 'Support',
    bar: 'from-violet-500 to-violet-300',
    iconWrap: 'bg-violet-500/12 text-violet-300',
  },
  data: {
    icon: BarChart3,
    pill: 'Analysis',
    bar: 'from-emerald-500 to-emerald-400',
    iconWrap: 'bg-emerald-500/12 text-emerald-300',
  },
}

function categoryMeta(category: string) {
  return CATEGORY_META[category] || {
    icon: Bot,
    pill: 'Content',
    bar: 'from-emerald-500 to-emerald-300',
    iconWrap: 'bg-emerald-500/12 text-emerald-300',
  }
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return value.toString()
}

function ListingCard({ listing, installed, onInstall }: {
  listing: MarketplaceListing
  installed: boolean
  onInstall: (listing: MarketplaceListing) => void
}) {
  const meta = categoryMeta(listing.category)
  const Icon = meta.icon
  return (
    <Link
      to={`/marketplace/${listing.slug}`}
      className="group glass-card listing-card overflow-hidden rounded-2xl transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-400/35 hover:shadow-glass-hover"
    >
      <div className={clsx('h-1 w-full bg-gradient-to-r', meta.bar)} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={clsx('grid h-11 w-11 place-items-center rounded-xl', meta.iconWrap)}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-1 text-lg font-bold text-white">{listing.name}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#8B9DBE]">
              {meta.pill} · {TYPE_LABELS[listing.listing_type]}
            </div>
          </div>
          {listing.preview_image_url ? (
            <img src={listing.preview_image_url} alt="" className="h-12 w-12 rounded-xl object-cover opacity-90" />
          ) : null}
        </div>
        <p className="mt-4 line-clamp-2 text-sm text-[#8B9DBE]">{listing.tagline || listing.description}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="font-mono text-xs text-[#8B9DBE]">{formatCount(listing.install_count)} installs</div>
          {installed ? (
            <span className="badge badge-emerald">Installed ✓</span>
          ) : (
            <button
              className="btn-primary btn-sm"
              onClick={event => {
                event.preventDefault()
                onInstall(listing)
              }}
            >
              Install
            </button>
          )}
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
  const meta = categoryMeta(listing.category)
  const Icon = meta.icon
  return (
    <div className="listing-card glass-card flex flex-col gap-4 rounded-2xl p-4 transition hover:border-indigo-400/35 md:flex-row md:items-center">
      <Link to={`/marketplace/${listing.slug}`} className={clsx('grid h-20 w-20 shrink-0 place-items-center rounded-2xl', meta.iconWrap)}>
        <Icon size={26} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/marketplace/${listing.slug}`} className="text-lg font-semibold text-white hover:text-indigo-200">{listing.name}</Link>
          <span className="badge badge-glass">{TYPE_LABELS[listing.listing_type]}</span>
          <span className="badge badge-glass">{meta.pill}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#8B9DBE]">{listing.tagline}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {listing.tags.slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-xs text-[#8B9DBE]">#{tag}</span>)}
        </div>
      </div>
      {installed ? <span className="badge badge-emerald">Installed ✓</span> : <button className="btn-primary btn-sm" onClick={() => onInstall(listing)}>Install</button>}
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
  const [installsOnly, setInstallsOnly] = useState(false)

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
  const items = rawItems.filter(item =>
    (!freeOnly || item.is_free) &&
    (!selectedTag || item.tags.includes(selectedTag)) &&
    (!installsOnly || installedIds.has(item.id)),
  )
  const stats = useMemo(() => {
    const agentCount = rawItems.filter(item => item.listing_type === 'agent').length
    const workflowCount = rawItems.filter(item => item.listing_type === 'workflow').length
    const toolCount = rawItems.filter(item => item.listing_type === 'tool_config').length
    const installsCount = rawItems.reduce((sum, item) => sum + item.install_count, 0)
    return { agentCount, workflowCount, toolCount, installsCount }
  }, [rawItems])

  return (
    <div className="min-h-dvh bg-base-bg text-white">
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-obsidian-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-btn-primary">
              <Zap size={19} />
            </div>
            <div>
              <h1 className="font-semibold tracking-tight">Aethon Marketplace</h1>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8B9DBE]">Agency OS Templates</div>
            </div>
          </Link>
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8B9DBE]" size={18} />
            <input
              autoFocus
              className="input h-12 w-full pl-11 pr-4"
              placeholder="Search agents, workflows, tools, eval suites..."
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            {auth.isAuthenticated ? (
              <>
                <button className="btn-secondary h-11" onClick={() => navigate('/marketplace/publish')}>Publish</button>
                <button className="btn-ghost h-11" onClick={() => setInstallsOnly(value => !value)}>
                  {installsOnly ? 'All Listings' : 'My Installs'}
                </button>
                <div className="relative">
                  <button
                    className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-obsidian-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                    onClick={() => setUserMenuOpen(open => !open)}
                  >
                    <UserCircle size={18} />
                    <span className="hidden max-w-32 truncate md:inline">{auth.email || 'Account'}</span>
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-white/[0.08] bg-base-surface shadow-glow-lg">
                      <div className="border-b border-white/[0.08] px-4 py-3">
                        <div className="text-xs text-ink-faint">Signed in as</div>
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

      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-[#8B9DBE]">
          <span className="badge badge-glass">{stats.agentCount} agents</span>
          <span className="badge badge-glass">{stats.workflowCount} workflows</span>
          <span className="badge badge-glass">{stats.toolCount} tools</span>
          <span className="badge badge-glass">{formatCount(stats.installsCount)} installs</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {CATEGORIES.map(item => (
            <button
              key={item.id}
              className={clsx(
                'shrink-0 badge cursor-pointer px-4 py-2 text-sm transition',
                category === item.id
                  ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
                  : 'badge-glass hover:border-white/[0.14]',
              )}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <select className="input h-10 w-[160px]" value={type} onChange={event => setType(event.target.value as MarketplaceListingType | 'all')}>
            <option value="all">All Types</option>
            <option value="agent">Agents</option>
            <option value="workflow">Workflows</option>
            <option value="tool_config">Tool Configs</option>
            <option value="eval_suite">Eval Suites</option>
          </select>
          <select className="input h-10 w-[180px]" value={sortBy} onChange={event => setSortBy(event.target.value as 'popular' | 'newest' | 'rating')}>
            <option value="popular">Most Popular</option>
            <option value="newest">Newest</option>
            <option value="rating">Highest Rated</option>
          </select>
          <label className="badge badge-glass cursor-pointer gap-2 px-3 py-2 text-sm">
            <input type="checkbox" className="indigo-indigo-500" checked={freeOnly} onChange={event => setFreeOnly(event.target.checked)} />
            Free only
          </label>
          <div className="flex flex-wrap gap-2">
            {topTags.map(tag => (
              <button
                key={tag}
                className={clsx(
                  'badge cursor-pointer px-3 py-2 text-xs transition',
                  selectedTag === tag ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300' : 'badge-glass hover:border-white/[0.14]',
                )}
                onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 pb-12">
        <section>
          {query && (
            <div className="glass-card mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div>
                <p className="font-medium text-white">Search results for “{query}”</p>
                <p className="mt-1 text-sm text-[#8B9DBE]">{items.length} result{items.length === 1 ? '' : 's'} found</p>
              </div>
              <button className="btn-ghost" onClick={() => setQuery('')}>Clear</button>
            </div>
          )}

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(9)].map((_, index) => <Skeleton key={index} className="h-72 rounded-2xl" />)}
            </div>
          ) : !items.length ? (
            <div className="glass-card grid min-h-[360px] place-items-center rounded-2xl text-center">
              <div>
                <Boxes className="mx-auto text-[#8B9DBE]" size={42} />
                <h2 className="mt-4 text-xl font-semibold text-white">No marketplace listings found</h2>
                <p className="mt-2 text-sm text-[#8B9DBE]">Try a different search, category, or type filter.</p>
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
              {items.map(item => (
                <ListingCard key={item.id} listing={item} installed={installedIds.has(item.id)} onInstall={setInstalling} />
              ))}
            </div>
          )}
        </section>
      </main>

      <InstallModal listing={installing} open={Boolean(installing)} onClose={() => setInstalling(null)} />
    </div>
  )
}

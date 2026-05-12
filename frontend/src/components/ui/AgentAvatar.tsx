import { clsx } from 'clsx'

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

const palettes = [
  ['#2563EB', '#10B981'],
  ['#1D4ED8', '#3B82F6'],
  ['#059669', '#34D399'],
  ['#F59E0B', '#D97706'],
  ['#0F766E', '#2563EB'],
  ['#2563EB', '#14B8A6'],
]

const sizes: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
}

function hashName(name: string) {
  return name.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0)
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AI'
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
}

export function AgentAvatar({
  name,
  color,
  imageUrl,
  size = 'md',
  running = false,
  className,
}: {
  name: string
  color?: string
  imageUrl?: string
  size?: AvatarSize
  running?: boolean
  className?: string
}) {
  const palette = palettes[Math.abs(hashName(name)) % palettes.length]
  const background = color ?? `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`

  return (
    <div className={clsx('relative inline-flex shrink-0', running && 'animate-pulse-ring rounded-full', className)}>
      <div
        className={clsx(
          'grid place-items-center rounded-2xl font-mono font-semibold text-white ring-1 ring-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
          sizes[size],
        )}
        style={{ background }}
        title={name}
      >
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(name)}
      </div>
      {running && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-base-bg bg-emerald-400" />}
    </div>
  )
}

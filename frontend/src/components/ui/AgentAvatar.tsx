import { clsx } from 'clsx'

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

const palettes = [
  ['#6366f1', '#06b6d4'],
  ['#8b5cf6', '#6366f1'],
  ['#06b6d4', '#22c55e'],
  ['#f59e0b', '#ef4444'],
  ['#ec4899', '#8b5cf6'],
  ['#14b8a6', '#6366f1'],
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
  size = 'md',
  running = false,
  className,
}: {
  name: string
  color?: string
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
          'grid place-items-center rounded-full font-mono font-semibold text-white ring-1 ring-white/15',
          sizes[size],
        )}
        style={{ background }}
        title={name}
      >
        {initials(name)}
      </div>
      {running && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-obsidian-950 bg-accent-400" />}
    </div>
  )
}

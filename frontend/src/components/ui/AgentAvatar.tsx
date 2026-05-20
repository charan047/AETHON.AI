import { clsx } from 'clsx'

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

const palettes = [
  ['#1A1A1A', '#2A2A2A'],
  ['#141414', '#242424'],
  ['#0F0F0F', '#2F2F2F'],
  ['#111111', '#202020'],
  ['#151515', '#2A2A2A'],
  ['#0D0D0D', '#252525'],
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
          'grid place-items-center rounded-2xl border border-white/[0.08] font-mono font-semibold text-white shadow-none',
          sizes[size],
        )}
        style={{ background }}
        title={name}
      >
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(name)}
      </div>
      {running && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-black bg-signal-green" />}
    </div>
  )
}

import { clsx } from 'clsx'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.035] before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/[0.08] before:to-transparent',
        className,
      )}
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx('rounded-2xl border border-white/[0.08] bg-obsidian-900 p-5', className)}>
      <Skeleton className="mb-5 h-14 w-14 rounded-full" />
      <Skeleton className="mb-3 h-5 w-2/3" />
      <Skeleton className="mb-5 h-3 w-full" />
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </div>
  )
}

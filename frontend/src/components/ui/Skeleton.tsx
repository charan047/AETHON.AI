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
    <div className={clsx('glass-card rounded-2xl p-5', className)}>
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

export function AgentCardSkeleton() {
  return (
    <div className="glass-card space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-2 w-2 rounded-full" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-1 w-full" />
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="glass-card rounded-2xl p-6">
            <Skeleton className="mb-4 h-4 w-24" />
            <Skeleton className="mb-3 h-10 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="glass-card rounded-2xl p-6">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <Skeleton className="mb-2 h-4 w-3/5" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card rounded-2xl p-6">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <Skeleton className="mb-2 h-4 w-28" />
                <Skeleton className="mb-3 h-3 w-20" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid grid-cols-5 gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ExecutionRowSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
      <Skeleton className="mb-2 h-3 w-40" />
      <Skeleton className="h-3 w-28" />
    </div>
  )
}

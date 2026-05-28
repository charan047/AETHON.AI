import { cn } from '../../../lib/utils'
import type { ButtonHTMLAttributes, CSSProperties } from 'react'

export function ShimmerButton({
  shimmerColor = '#ffffff',
  shimmerSize = '0.1em',
  borderRadius = '8px',
  shimmerDuration = '3s',
  background = 'rgba(0, 0, 0, 1)',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  shimmerColor?: string
  shimmerSize?: string
  shimmerDuration?: string
  borderRadius?: string
  background?: string
}) {
  return (
    <button
      style={
        {
          '--shimmer-color': shimmerColor,
          '--radius': borderRadius,
          '--speed': shimmerDuration,
          '--cut': shimmerSize,
          '--bg': background,
          '--spread': '90deg',
        } as CSSProperties
      }
      className={cn(
        'group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap',
        'border border-white/10 px-6 py-3 text-white [background:var(--bg)]',
        '[border-radius:var(--radius)]',
        'transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          '-z-30 blur-[2px]',
          'absolute inset-0 overflow-visible [container-type:size]',
        )}
      >
        <div className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1] [border-radius:0] [mask:none]">
          <div className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))] [translate:0_0]" />
        </div>
      </div>
      {children}
      <div className="absolute -z-20 [background:var(--bg)] [border-radius:var(--radius)] [inset:var(--cut)]" />
    </button>
  )
}

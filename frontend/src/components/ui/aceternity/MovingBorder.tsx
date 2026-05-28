import { useRef } from 'react'
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useTransform,
} from 'framer-motion'
import { cn } from '../../../lib/utils'
import type { ElementType, ReactNode, SVGProps } from 'react'

export function Button({
  borderRadius = '8px',
  children,
  as: Component = 'button',
  containerClassName,
  borderClassName,
  duration,
  className,
  ...otherProps
}: {
  borderRadius?: string
  children: ReactNode
  as?: ElementType
  containerClassName?: string
  borderClassName?: string
  duration?: number
  className?: string
} & Record<string, unknown>) {
  return (
    <Component
      className={cn(
        'relative overflow-hidden bg-transparent p-[1px] text-xl',
        containerClassName,
      )}
      style={{ borderRadius }}
      {...otherProps}
    >
      <div
        className="absolute inset-0"
        style={{ borderRadius: `calc(${borderRadius} * 0.96)` }}
      >
        <MovingBorder duration={duration} rx="30%" ry="30%">
          <div
            className={cn(
              'h-20 w-20 opacity-[0.8] bg-[radial-gradient(#6366f1_40%,transparent_60%)]',
              borderClassName,
            )}
          />
        </MovingBorder>
      </div>
      <div
        className={cn(
          'relative flex h-full w-full items-center justify-center',
          'border border-white/[0.12] bg-black text-sm font-medium text-white',
          'antialiased backdrop-blur-xl',
          className,
        )}
        style={{ borderRadius: `calc(${borderRadius} * 0.96)` }}
      >
        {children}
      </div>
    </Component>
  )
}

export function MovingBorder({
  children,
  duration = 2000,
  rx,
  ry,
  ...otherProps
}: {
  children: ReactNode
  duration?: number
  rx?: string | number
  ry?: string | number
} & SVGProps<SVGSVGElement>) {
  const pathRef = useRef<SVGRectElement>(null)
  const progress = useMotionValue(0)

  useAnimationFrame(time => {
    const length = pathRef.current?.getTotalLength()
    if (!length) return
    const pxPerMs = length / duration
    progress.set((time * pxPerMs) % length)
  })

  const x = useTransform(progress, val => pathRef.current?.getPointAtLength(val).x ?? 0)
  const y = useTransform(progress, val => pathRef.current?.getPointAtLength(val).y ?? 0)
  const transform = useMotionTemplate`translateX(${x}px) translateY(${y}px) translateX(-50%) translateY(-50%)`

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        className="absolute h-full w-full"
        width="100%"
        height="100%"
        {...otherProps}
      >
        <rect fill="none" width="100%" height="100%" rx={rx} ry={ry} ref={pathRef} />
      </svg>
      <motion.div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'inline-block',
          transform,
        }}
      >
        {children}
      </motion.div>
    </>
  )
}

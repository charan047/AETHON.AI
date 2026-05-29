import type { ReactNode } from 'react'

import { AnimatedContent } from '../reactbits/AnimatedContent'
import { DotGrid } from '../reactbits/DotGrid'
import { ShinyText } from '../reactbits/ShinyText'
import { cn } from '../../lib/utils'

export function HeroPanel({
  kicker,
  title,
  subtitle,
  actions,
  className,
}: {
  kicker?: string
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <AnimatedContent distance={28} duration={0.45}>
      <div className={cn('page-header page-header--hero relative overflow-hidden rounded-[28px]', className)}>
        <DotGrid
          className="opacity-50"
          gap={26}
          dotColor="rgba(99,102,241,0.12)"
        />
        <div className="relative min-w-0">
          {kicker ? (
            <div className="page-kicker">
              <ShinyText>{kicker}</ShinyText>
            </div>
          ) : null}
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-sub max-w-3xl">{subtitle}</p> : null}
        </div>
        {actions ? <div className="relative shrink-0">{actions}</div> : null}
      </div>
    </AnimatedContent>
  )
}

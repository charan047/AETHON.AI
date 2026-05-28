import type { ReactNode } from 'react'
import UpstreamShinyText from './upstream/ShinyText'

function toText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(toText).join('')
  }

  return ''
}

export function ShinyText({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <UpstreamShinyText text={toText(children)} className={className} pauseOnHover />
}

import UpstreamSplitText from './upstream/SplitText'

function extractTranslateY(transform?: string): number {
  if (!transform) return 0
  const match = /translateY\(([-\d.]+)px\)/.exec(transform)
  return match ? Number(match[1]) : 0
}

export function SplitText({
  text,
  className,
  delay = 50,
  animationFrom = { opacity: 0, transform: 'translateY(20px)' },
  animationTo = { opacity: 1, transform: 'translateY(0)' },
}: {
  text: string
  className?: string
  delay?: number
  animationFrom?: { opacity?: number; transform?: string }
  animationTo?: { opacity?: number; transform?: string }
}) {
  return (
    <UpstreamSplitText
      text={text}
      className={className}
      delay={delay}
      splitType="words"
      tag="span"
      textAlign="left"
      from={{
        opacity: animationFrom.opacity ?? 0,
        y: extractTranslateY(animationFrom.transform),
      }}
      to={{
        opacity: animationTo.opacity ?? 1,
        y: extractTranslateY(animationTo.transform),
      }}
      threshold={0}
      rootMargin="0px"
    />
  )
}

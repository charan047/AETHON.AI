import UpstreamBlurText from './upstream/BlurText'

export function BlurText({
  text,
  className,
  delay = 100,
}: {
  text: string
  className?: string
  delay?: number
}) {
  return (
    <UpstreamBlurText
      text={text}
      className={className}
      delay={delay}
      animateBy="words"
      direction="bottom"
      threshold={0}
      rootMargin="0px"
    />
  )
}

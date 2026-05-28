import UpstreamCountUp from './upstream/CountUp'

export function CountUp({
  value,
  className,
  decimalPlaces = 0,
}: {
  value: number
  className?: string
  decimalPlaces?: number
}) {
  const normalizedValue = Number(value.toFixed(decimalPlaces))

  return (
    <UpstreamCountUp
      to={normalizedValue}
      from={0}
      className={className}
      duration={1.4}
      separator=","
    />
  )
}

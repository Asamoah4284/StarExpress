import * as React from "react"
import { useCountUp } from "@/hooks/useCountUp.js"
import { cn } from "@/lib/utils"

/**
 * @param {{ value: number, pulseKey?: number, scopeKey?: string, enabled?: boolean, className?: string, duration?: number }} props
 */
export function AnimatedStatValue({
  value,
  pulseKey = 0,
  scopeKey = "",
  enabled = true,
  className,
  duration = 900,
}) {
  const [animating, setAnimating] = React.useState(false)
  const prevPulseRef = React.useRef(pulseKey)
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0
  const display = useCountUp(numeric, { duration, enabled, scopeKey, bumpKey: pulseKey })

  React.useEffect(() => {
    if (pulseKey > prevPulseRef.current) {
      setAnimating(true)
      const t = window.setTimeout(() => setAnimating(false), 700)
      prevPulseRef.current = pulseKey
      return () => window.clearTimeout(t)
    }
    prevPulseRef.current = pulseKey
  }, [pulseKey])

  return (
    <span className={cn("inline-block tabular-nums transition-transform", animating && "animate-stat-pop", className)}>
      {display}
    </span>
  )
}

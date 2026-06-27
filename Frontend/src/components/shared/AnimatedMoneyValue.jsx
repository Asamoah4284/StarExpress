import { useCountUpFloat } from "@/hooks/useCountUp.js"
import { formatCedis } from "@/lib/utils"
import { cn } from "@/lib/utils"

/**
 * @param {{
 *   amount: number,
 *   scopeKey?: string,
 *   pulseKey?: number,
 *   enabled?: boolean,
 *   className?: string,
 *   duration?: number,
 * }} props
 */
export function AnimatedMoneyValue({
  amount,
  scopeKey = "",
  pulseKey = 0,
  enabled = true,
  className,
  duration = 1000,
}) {
  const display = useCountUpFloat(amount, { duration, enabled, scopeKey, bumpKey: pulseKey })
  return <span className={cn("tabular-nums", className)}>{formatCedis(display)}</span>
}

import * as React from "react"
import { useCountUp, useCountUpPercent } from "@/hooks/useCountUp.js"
import { cn } from "@/lib/utils"

/**
 * @param {{
 *   label: string,
 *   value: number,
 *   total: number,
 *   color: string,
 *   hint: string,
 *   animateKey?: string | number,
 *   scopeKey?: string,
 *   enabled?: boolean,
 * }} props
 */
export function AnimatedLoyaltyBar({
  label,
  value,
  total,
  color,
  hint,
  animateKey = 0,
  scopeKey = "",
  enabled = true,
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const countOpts = { duration: 900, enabled, scopeKey, bumpKey: animateKey }
  const barOpts = { duration: 1100, enabled, scopeKey, bumpKey: animateKey }
  const displayValue = useCountUp(value, countOpts)
  const displayPct = useCountUp(pct, countOpts)
  const barWidth = useCountUpPercent(pct, barOpts)

  const barVisual = value > 0 ? Math.max(barWidth, barWidth > 0 ? 4 : 0) : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums text-xs">
          {displayValue} · {displayPct}%
        </span>
      </div>
      <div className="bg-muted h-2.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full will-change-[width]", color)}
          style={{ width: `${barVisual}%` }}
        />
      </div>
      <p className="text-muted-foreground text-[11px]">{hint}</p>
    </div>
  )
}

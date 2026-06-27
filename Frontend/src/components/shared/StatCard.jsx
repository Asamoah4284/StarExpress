import { Card, CardContent } from "@/components/ui/card"
import { AnimatedMoneyValue } from "@/components/shared/AnimatedMoneyValue.jsx"
import { AnimatedStatValue } from "@/components/customers/AnimatedStatValue.jsx"
import { StatSparkline } from "@/components/shared/StatSparkline.jsx"
import { cn } from "@/lib/utils"

/** @typedef {"violet" | "emerald" | "amber" | "sky"} StatTone */

const TONE_ICON = {
  violet: "rounded-md bg-violet-600/10 p-1.5 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  emerald: "rounded-md bg-emerald-600/10 p-1.5 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  amber: "rounded-md bg-amber-500/15 p-1.5 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300",
  sky: "rounded-md bg-sky-600/10 p-1.5 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
}

const TONE_SPARK = {
  violet: "text-violet-600 dark:text-violet-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  sky: "text-sky-600 dark:text-sky-400",
}

/**
 * KPI tile: tinted icon, value + trend row, subline, tone-matched sparkline.
 * @param {object} props
 * @param {import("lucide-react").LucideIcon} props.icon
 * @param {string} props.label
 * @param {string} props.value
 * @param {string} props.subline
 * @param {{ text: string, positive: boolean } | null | undefined} props.trend
 * @param {{ data: { x?: string, y: number }[], variant?: "area" | "bar" } | null | undefined} props.sparkline
 * @param {StatTone} [props.tone]
 * @param {boolean} [props.animate]
 * @param {number} [props.countValue]
 * @param {number} [props.moneyAmount]
 * @param {string} [props.scopeKey]
 * @param {number} [props.pulseKey]
 * @param {boolean} [props.animateEnabled]
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  subline,
  trend,
  sparkline,
  tone = "violet",
  className,
  animate = false,
  countValue,
  moneyAmount,
  scopeKey = "",
  pulseKey = 0,
  animateEnabled = true,
}) {
  const iconTone = TONE_ICON[tone] ?? TONE_ICON.violet
  const sparkTone = TONE_SPARK[tone] ?? TONE_SPARK.violet

  const displayValue =
    animate && animateEnabled && moneyAmount != null && Number.isFinite(Number(moneyAmount)) ? (
      <AnimatedMoneyValue
        amount={Number(moneyAmount)}
        scopeKey={scopeKey}
        pulseKey={pulseKey}
        enabled={animateEnabled}
      />
    ) : animate && animateEnabled && countValue != null && Number.isFinite(Number(countValue)) ? (
      <AnimatedStatValue
        value={Math.round(Number(countValue))}
        scopeKey={scopeKey}
        pulseKey={pulseKey}
        enabled={animateEnabled}
      />
    ) : (
      value
    )

  return (
    <Card
      className={cn(
        "gap-0 flex min-h-0 flex-col border-border bg-card py-0 text-card-foreground shadow-none ring-1 ring-border transition-colors hover:border-border/80 hover:ring-border/80",
        className,
      )}
    >
      <CardContent className="flex flex-col gap-0 p-3 pt-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-muted-foreground text-[10px] font-semibold uppercase leading-tight tracking-[0.12em]">
            {label}
          </p>
          <div className={cn("shrink-0", iconTone)} aria-hidden>
            <Icon className="size-3.5 stroke-[2]" />
          </div>
        </div>

        <div className="mt-1.5 flex items-start justify-between gap-2">
          <p className="text-foreground min-w-0 flex-1 text-xl font-semibold tracking-tight tabular-nums sm:text-[1.35rem]">
            {displayValue}
          </p>
          {trend ? (
            <span
              className={cn(
                "max-w-[48%] shrink-0 pt-0.5 text-right text-[10px] font-semibold leading-tight tracking-tight sm:text-[11px]",
                trend.positive
                  ? "text-emerald-600 dark:text-emerald-500"
                  : "text-red-600 dark:text-red-500",
              )}
            >
              {trend.text}
            </span>
          ) : null}
        </div>

        {subline ? (
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{subline}</p>
        ) : null}

        {sparkline?.data?.length ? (
          <StatSparkline
            data={sparkline.data}
            variant={sparkline.variant ?? "area"}
            className={sparkTone}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

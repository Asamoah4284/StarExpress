import { BarChart3, MessageSquare, RefreshCw, UserCheck, UserMinus, Users, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CustomerAnalyticsHero } from "@/components/customers/CustomerAnalyticsHero.jsx"
import { AnimatedStatValue } from "@/components/customers/AnimatedStatValue.jsx"
import { AnimatedLoyaltyBar } from "@/components/customers/AnimatedLoyaltyBar.jsx"
import { CustomerEngagementDonut } from "@/components/customers/CustomerEngagementDonut.jsx"
import { CustomerRecencyBarChart } from "@/components/customers/CustomerRecencyBarChart.jsx"
import { cn } from "@/lib/utils"

/**
 * @param {{
 *   loading?: boolean,
 *   scopeLabel: string,
 *   inactiveThreshold: number,
 *   summary?: { total?: number, active?: number, inactive?: number, repeat?: number, oneTime?: number },
 *   customers: Array<{ daysSinceLastPurchase?: number | null }>,
 *   onMessageInactive?: () => void,
 *   inactiveCount?: number,
 *   pulseKey?: number,
 * }} props
 */
export function CustomerAnalyticsOverview({
  loading = false,
  scopeLabel,
  inactiveThreshold,
  summary,
  customers,
  onMessageInactive,
  inactiveCount = 0,
  pulseKey = 0,
}) {
  const total = summary?.total ?? customers.length
  const active = summary?.active ?? 0
  const inactive = summary?.inactive ?? 0
  const repeat = summary?.repeat ?? 0
  const oneTime = summary?.oneTime ?? 0
  const repeatPct = total > 0 ? Math.round((repeat / total) * 100) : 0

  const miniStats = [
    { label: "Total", value: total, icon: Users, tone: "text-primary" },
    { label: "Active", value: active, icon: UserCheck, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Inactive", value: inactive, icon: UserMinus, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Repeat", value: repeat, icon: RefreshCw, tone: "text-violet-600 dark:text-violet-400" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Hero + insight panel */}
        <Card
          className={cn(
            "border-border/80 from-primary/[0.03] overflow-hidden bg-gradient-to-br to-transparent shadow-none ring-1 ring-border lg:col-span-5",
            pulseKey > 0 && "animate-live-ring",
          )}
        >
          <CardContent className="flex h-full flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                  Customer intelligence
                </p>
                <span className="bg-primary/10 text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/15 px-2.5 py-1 text-xs font-medium">
                  <Wifi className="text-primary size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{scopeLabel}</span>
                </span>
              </div>
              <CustomerAnalyticsHero className="hidden size-24 shrink-0 opacity-90 sm:block lg:size-28" />
            </div>

            <div>
              <p className="text-foreground text-4xl font-bold tracking-tight tabular-nums">
                {loading ? "…" : (
                  <AnimatedStatValue
                    value={total}
                    pulseKey={pulseKey}
                    scopeKey={scopeLabel}
                    enabled={!loading}
                    duration={1000}
                  />
                )}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">Unique buyers in scope</p>
            </div>

            <div className="border-border/60 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border/60 sm:grid-cols-4">
              {miniStats.map(({ label, value, icon: Icon, tone }) => (
                <div key={label} className="bg-card min-w-0 px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("size-3.5 shrink-0", tone)} aria-hidden />
                    <span className="text-muted-foreground truncate text-[10px] font-semibold uppercase tracking-wide">
                      {label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xl font-bold tabular-nums">
                    {loading ? "…" : (
                      <AnimatedStatValue
                        value={value}
                        pulseKey={pulseKey}
                        scopeKey={scopeLabel}
                        enabled={!loading}
                        duration={850}
                      />
                    )}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-border/60 bg-muted/20 mt-auto flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-sm leading-snug">
                <span className="font-semibold">{loading ? "…" : `${repeatPct}%`}</span>
                <span className="text-muted-foreground">
                  {" "}
                  of buyers came back for a 2nd purchase.
                  {!loading && inactive > 0 ? (
                    <>
                      {" "}
                      <span className="text-amber-700 dark:text-amber-300 font-medium">{inactive} stopped buying</span>{" "}
                      after {inactiveThreshold}+ days.
                    </>
                  ) : null}
                </span>
              </p>
              {!loading && inactiveCount > 0 && onMessageInactive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 self-start sm:self-auto"
                  onClick={onMessageInactive}
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  Message {inactiveCount} inactive
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Engagement donut */}
        <Card className={cn("border-border/80 shadow-none ring-1 ring-border lg:col-span-3", pulseKey > 0 && "ring-primary/20 ring-2")}>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Engagement split</CardTitle>
            <CardDescription className="text-xs">
              Active vs inactive ({inactiveThreshold}-day rule)
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">Loading…</div>
            ) : (
              <CustomerEngagementDonut active={active} inactive={inactive} total={total} />
            )}
            <div className="mt-1 flex justify-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                Active ({active})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500" aria-hidden />
                Inactive ({inactive})
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Loyalty breakdown */}
        <Card className="border-border/80 shadow-none ring-1 ring-border lg:col-span-4">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold">Buyer loyalty</CardTitle>
            <CardDescription className="text-xs">Repeat vs one-time purchasers</CardDescription>
          </CardHeader>
          <CardContent className="flex h-[calc(100%-4rem)] flex-col justify-center gap-4 pt-4">
            {loading ? (
              <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">Loading…</div>
            ) : (
              <>
                <AnimatedLoyaltyBar
                  label="Repeat buyers"
                  value={repeat}
                  total={total}
                  color="bg-violet-500"
                  hint="2+ purchases"
                  scopeKey={scopeLabel}
                  animateKey={pulseKey}
                  enabled={!loading}
                />
                <AnimatedLoyaltyBar
                  label="One-time"
                  value={oneTime}
                  total={total}
                  color="bg-sky-500"
                  hint="Single purchase"
                  scopeKey={scopeLabel}
                  animateKey={pulseKey}
                  enabled={!loading}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recency timeline */}
      <Card className="border-border/80 shadow-none ring-1 ring-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="text-primary size-4" aria-hidden />
            <div>
              <CardTitle className="text-sm font-semibold">When customers last bought</CardTitle>
              <CardDescription className="text-xs">
                Spot clusters of lapsed buyers — the {inactiveThreshold}+ day bucket is your re-engagement zone
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          {loading ? (
            <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">Loading…</div>
          ) : (
            <CustomerRecencyBarChart customers={customers} thresholdDays={inactiveThreshold} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

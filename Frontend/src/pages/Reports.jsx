import * as React from "react"
import { BarChart3, CalendarRange, MapPin, Package } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { RevenueLineChart } from "@/components/charts/RevenueLineChart.jsx"
import { SalesByLocationBarChart } from "@/components/charts/SalesByLocationBarChart.jsx"
import { PackageTypePieChart } from "@/components/charts/PackageTypePieChart.jsx"
import {
  getDashboardMetrics,
  getPackageTypeDistribution,
  getRevenueLast30Days,
  getSalesByLocation,
} from "@/lib/aggregations.js"
import { cn, formatCedis } from "@/lib/utils"

const CHART_H = 300

function ReportStat({ label, value, hint, icon: Icon, className }) {
  return (
    <Card className={cn("border-border bg-card py-0 shadow-none ring-1 ring-border", className)}>
      <CardContent className="flex gap-3 p-4">
        <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4 stroke-[1.75]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">{label}</p>
          <p className="text-foreground text-lg font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
          {hint ? <p className="text-muted-foreground text-xs leading-snug">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Reports() {
  const catalog = useCatalog()

  const revenue = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    return getRevenueLast30Days(sales)
  }, [catalog.data])

  const byLoc = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    const locations = catalog.data?.locations ?? []
    return getSalesByLocation(sales, locations)
  }, [catalog.data])

  const byPkg = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    return getPackageTypeDistribution(sales)
  }, [catalog.data])

  const metrics = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    const packages = catalog.data?.packages ?? []
    return getDashboardMetrics(sales, packages)
  }, [catalog.data])

  const revenue30Total = React.useMemo(() => revenue.reduce((sum, d) => sum + d.revenue, 0), [revenue])
  const avgCompleted = React.useMemo(
    () => (metrics.sold > 0 ? metrics.totalRevenue / metrics.sold : 0),
    [metrics.sold, metrics.totalRevenue],
  )
  const dateExtent = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    const dates = sales.map((s) => s.date).sort()
    if (!dates.length) return null
    return { from: dates[0], to: dates[dates.length - 1] }
  }, [catalog.data])
  const topLocation = React.useMemo(() => {
    if (!byLoc.length) return null
    return [...byLoc].sort((a, b) => b.total - a.total)[0]
  }, [byLoc])
  const pkgTypes = byPkg.length

  return (
    <div className="space-y-8">
      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading reports…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}

      <PageHeader
        title="Reports"
        description="Revenue, location mix, and package mix from the API. Use tooltips on charts for exact values."
      >
        {dateExtent ? (
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tabular-nums">
            <CalendarRange className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <span>
              Dataset window: {dateExtent.from} → {dateExtent.to}
            </span>
          </div>
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat
          icon={BarChart3}
          label="Total revenue (completed)"
          value={formatCedis(metrics.totalRevenue)}
          hint={`${metrics.sold} completed sales · ${metrics.pending} pending`}
        />
        <ReportStat
          icon={CalendarRange}
          label="Last 30 days (chart window)"
          value={formatCedis(revenue30Total)}
          hint="Sum of daily completed revenue in the line chart"
        />
        <ReportStat
          icon={Package}
          label="Avg completed sale"
          value={formatCedis(Math.round(avgCompleted))}
          hint={pkgTypes ? `${pkgTypes} package types in catalog mix` : "No package mix"}
        />
        <ReportStat
          icon={MapPin}
          label="Top outlet (completed GH₵)"
          value={topLocation?.name ?? "—"}
          hint={topLocation && topLocation.total > 0 ? formatCedis(topLocation.total) : "No location totals"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-none ring-1 ring-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold tracking-tight">Revenue (last 30 days)</CardTitle>
            <CardDescription>
              Daily completed revenue ending on the latest sale date in the dataset. Axis ticks are evenly spaced (GH₵
              thousands).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <RevenueLineChart data={revenue} height={CHART_H} />
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none ring-1 ring-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold tracking-tight">Sales by location</CardTitle>
            <CardDescription>
              Completed revenue by outlet. Locations with zero completed revenue show a muted placeholder bar so the
              grid stays readable.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <SalesByLocationBarChart data={byLoc} height={CHART_H} />
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none ring-1 ring-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold tracking-tight">Package type distribution</CardTitle>
            <CardDescription>
              Share of completed sales by package name. Donut chart with legend — hover a segment for counts and
              percentages.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mx-auto max-w-lg">
              <PackageTypePieChart data={byPkg} height={340} donut />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

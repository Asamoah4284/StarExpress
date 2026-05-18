import * as React from "react"
import { BarChart3, CalendarRange, MapPin, Package } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { RevenueLineChart } from "@/components/charts/RevenueLineChart.jsx"
import { SalesByLocationBarChart } from "@/components/charts/SalesByLocationBarChart.jsx"
import { PackageTypePieChart } from "@/components/charts/PackageTypePieChart.jsx"
import {
  filterSalesByDateRange,
  filterSalesByLocation,
  getDashboardMetrics,
  getPackageTypeDistribution,
  getRevenueByDateRange,
  getSalesByLocation,
} from "@/lib/aggregations.js"
import {
  formatDateRangeLabel,
  getLastNDaysRange,
  isCompleteDateRange,
  localDateToIso,
  normalizeDateRange,
} from "@/lib/dates.js"
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
  const allSales = catalog.data?.sales ?? []
  const locations = catalog.data?.locations ?? []
  const packages = catalog.data?.packages ?? []

  const [locationId, setLocationId] = React.useState("all")
  const [dateRange, setDateRange] = React.useState(/** @type {{ from?: Date, to?: Date } | undefined} */ (undefined))
  const rangeInitialized = React.useRef(false)

  const handleDateRangeChange = React.useCallback((range) => {
    setDateRange(normalizeDateRange(range))
  }, [])

  React.useEffect(() => {
    if (rangeInitialized.current) return
    rangeInitialized.current = true
    setDateRange(getLastNDaysRange(7))
  }, [])

  const rangeComplete = isCompleteDateRange(dateRange)

  const filteredSales = React.useMemo(() => {
    let rows = filterSalesByLocation(allSales, locationId)
    if (rangeComplete && dateRange?.from && dateRange?.to) {
      rows = filterSalesByDateRange(
        rows,
        localDateToIso(dateRange.from),
        localDateToIso(dateRange.to),
      )
    }
    return rows
  }, [allSales, locationId, dateRange, rangeComplete])

  const dateFromIso = rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : null
  const dateToIso = rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : null

  const revenue = React.useMemo(() => {
    if (!dateFromIso || !dateToIso) return []
    return getRevenueByDateRange(filteredSales, dateFromIso, dateToIso)
  }, [filteredSales, dateFromIso, dateToIso])

  const byLoc = React.useMemo(() => getSalesByLocation(filteredSales, locations), [filteredSales, locations])

  const byPkg = React.useMemo(() => getPackageTypeDistribution(filteredSales), [filteredSales])

  const metrics = React.useMemo(() => getDashboardMetrics(filteredSales, packages), [filteredSales, packages])

  const revenueRangeTotal = React.useMemo(() => revenue.reduce((sum, d) => sum + d.revenue, 0), [revenue])
  const avgCompleted = React.useMemo(
    () => (metrics.sold > 0 ? metrics.totalRevenue / metrics.sold : 0),
    [metrics.sold, metrics.totalRevenue],
  )
  const topLocation = React.useMemo(() => {
    if (!byLoc.length) return null
    return [...byLoc].sort((a, b) => b.total - a.total)[0]
  }, [byLoc])
  const pkgTypes = byPkg.length

  const locationLabel =
    locationId === "all"
      ? "All locations"
      : (locations.find((l) => l.id === locationId)?.name ?? locationId)

  const dateLabel = formatDateRangeLabel(dateRange)
  const filterSummary = rangeComplete
    ? `${locationLabel} · ${dateLabel}`
    : `${locationLabel} · ${dateLabel} (complete both dates to filter)`

  const applyPresetDays = (days) => {
    setDateRange(getLastNDaysRange(days))
  }

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
        description="Filter by wifi location and any custom date range you choose. Defaults to the last 7 days through today."
      />

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Choose a location, then open the calendar to set a custom start and end date and click Apply range.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="report-location">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="report-location" className="w-full shadow-none">
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-date-range">Date range</Label>
              <DateRangePicker
                id="report-date-range"
                value={dateRange}
                onChange={handleDateRangeChange}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">Quick range:</span>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPresetDays(7)}>
              Last 7 days
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPresetDays(30)}>
              Last 30 days
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDateRange(getLastNDaysRange(7))}>
              Reset to last 7 days
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Showing <span className="text-foreground font-medium">{filterSummary}</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat
          icon={BarChart3}
          label="Total revenue (completed)"
          value={formatCedis(metrics.totalRevenue)}
          hint={`${metrics.sold} completed · ${metrics.pending} pending`}
        />
        <ReportStat
          icon={CalendarRange}
          label="Revenue in range"
          value={formatCedis(revenueRangeTotal)}
          hint={rangeComplete ? dateLabel : "Select start and end dates"}
        />
        <ReportStat
          icon={Package}
          label="Avg completed sale"
          value={formatCedis(Math.round(avgCompleted))}
          hint={pkgTypes ? `${pkgTypes} package types in mix` : "No package mix"}
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
            <CardTitle className="text-base font-semibold tracking-tight">Revenue by day</CardTitle>
            <CardDescription>
              One point per day from your selected start through end date (inclusive). {filterSummary}
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
              Completed revenue by outlet for the current filters. Zero-revenue locations still appear when viewing
              all locations.
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
              Share of completed sales by package name for the filtered period and location.
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

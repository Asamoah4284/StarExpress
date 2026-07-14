import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart3, MapPin, Package, PiggyBank } from "lucide-react"
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
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { RevenueLineChart } from "@/components/charts/RevenueLineChart.jsx"
import { SalesByLocationBarChart } from "@/components/charts/SalesByLocationBarChart.jsx"
import { PackageTypePieChart } from "@/components/charts/PackageTypePieChart.jsx"
import {
  currentWeekRange,
  filterSalesByDateRange,
  filterSalesByLocation,
  getDashboardMetrics,
  getPackageTypeDistribution,
  getRevenueByDateRange,
  getSalesByLocation,
} from "@/lib/aggregations.js"
import { fetchFinanceExpenses } from "@/lib/api.js"
import { computeReportNetProfit } from "@/lib/reportFinance.js"
import {
  formatDateRangeLabel,
  getLastNDaysRange,
  isCompleteDateRange,
  localDateToIso,
  normalizeDateRange,
} from "@/lib/dates.js"
import { isAdminRole } from "@/lib/roles.js"
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
  const { token, user, authReady } = useAuth()
  const catalog = useCatalog()
  const allSales = catalog.data?.sales ?? []
  const locations = catalog.data?.locations ?? []
  const packages = catalog.data?.packages ?? []
  const isAdmin = isAdminRole(user?.role)

  const [locationId, setLocationId] = React.useState("all")
  const [dateRange, setDateRange] = React.useState(/** @type {{ from?: Date, to?: Date } | undefined} */ (undefined))
  const rangeInitialized = React.useRef(false)

  const handleDateRangeChange = React.useCallback((range) => {
    setDateRange(normalizeDateRange(range))
  }, [])

  React.useEffect(() => {
    if (rangeInitialized.current) return
    rangeInitialized.current = true
    setDateRange(currentWeekRange())
  }, [])

  const rangeComplete = isCompleteDateRange(dateRange)
  const dateFromIso = rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : null
  const dateToIso = rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : null

  const expensesQuery = useQuery({
    queryKey: ["financeExpenses", token, dateFromIso, dateToIso, locationId],
    queryFn: async () => {
      if (!token || !dateFromIso || !dateToIso) return []
      const result = await fetchFinanceExpenses(token, {
        from: dateFromIso,
        to: dateToIso,
        ...(locationId !== "all" ? { locationId } : {}),
      })
      if (!result.ok) return []
      return result.expenses
    },
    enabled: authReady && isAdmin && Boolean(token) && Boolean(dateFromIso) && Boolean(dateToIso),
  })

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

  const revenue = React.useMemo(() => {
    if (!dateFromIso || !dateToIso) return []
    return getRevenueByDateRange(filteredSales, dateFromIso, dateToIso)
  }, [filteredSales, dateFromIso, dateToIso])

  const byLoc = React.useMemo(() => getSalesByLocation(filteredSales, locations), [filteredSales, locations])

  const byPkg = React.useMemo(() => getPackageTypeDistribution(filteredSales), [filteredSales])

  const metrics = React.useMemo(() => getDashboardMetrics(filteredSales, packages), [filteredSales, packages])

  const netProfit = React.useMemo(() => {
    if (!rangeComplete) return null
    return computeReportNetProfit({
      sales: filteredSales,
      locations,
      expenses: expensesQuery.data ?? [],
      locationId,
    })
  }, [rangeComplete, filteredSales, locations, expensesQuery.data, locationId])

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
        description={
          rangeComplete
            ? `Revenue and sales for ${locationLabel} · ${dateLabel}.`
            : "Filter by wifi location and date range. Defaults to this week (Tuesday–Monday)."
        }
      >
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <div className="space-y-1 sm:text-right">
              <Label
                htmlFor="report-location-top"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Location
              </Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="report-location-top" className="h-9 w-full min-w-[11rem] shadow-none sm:w-52">
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
            <div className="space-y-1 sm:text-right">
              <Label
                htmlFor="report-date-range-top"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Date range
              </Label>
              <DateRangePicker
                id="report-date-range-top"
                value={dateRange}
                onChange={handleDateRangeChange}
                align="end"
                className="h-9 w-full min-w-[11rem] shadow-none sm:w-56"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDateRangeChange(currentWeekRange())}
            >
              This week
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDateRangeChange(getLastNDaysRange(7))}
            >
              Last 7 days
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDateRangeChange(getLastNDaysRange(30))}
            >
              Last 30 days
            </Button>
          </div>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportStat
          icon={BarChart3}
          label="Total revenue (completed)"
          value={formatCedis(metrics.totalRevenue)}
          hint={`${metrics.sold} completed · ${metrics.pending} pending`}
        />
        <ReportStat
          icon={PiggyBank}
          label="Net profit"
          value={netProfit == null ? "—" : formatCedis(netProfit)}
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

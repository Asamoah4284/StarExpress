import * as React from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Calendar, DollarSign, Percent, ShoppingCart, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { GrossRevenueTrendChart } from "@/components/charts/GrossRevenueTrendChart.jsx"
import { WeekdayRevenuePieChart } from "@/components/charts/WeekdayRevenuePieChart.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { StatCard } from "@/components/shared/StatCard.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { fetchVoucherStats } from "@/lib/api.js"
import {
  filterSalesByDateRange,
  filterSalesByLocation,
  getAgentCommissionMetrics,
  getCompletedRevenueByWeekday,
  getDashboardMetrics,
  getDayOverDaySummary,
  getDayOverDaySummaryForAgent,
  getMonthlyGrossRevenueTrend,
  getSparklineCumulativeCommission,
  getSparklineCumulativeRevenue,
  getSparklineCumulativeSoldCount,
  getSparklineDailyCommission,
  getSparklineDailyCompletedRevenue,
  getSparklineDailySalesCount,
  getSparklineDailySoldCount,
} from "@/lib/aggregations.js"
import { findAgentStoreLocation } from "@/lib/agentLocation.js"
import { useSalesAgentCommissionRate } from "@/hooks/useAppSettings.js"
import { ROLE_SALES_AGENT } from "@/lib/roles.js"
import {
  formatDateRangeLabel,
  getLastNDaysRange,
  isCompleteDateRange,
  localDateToIso,
  normalizeDateRange,
} from "@/lib/dates.js"
import { formatCedis } from "@/lib/utils"

function moneyDayTrend(delta) {
  if (delta > 0) return { text: `↑ + ${formatCedis(delta)} today`, positive: true }
  if (delta < 0) return { text: `↓ ${formatCedis(-delta)} today`, positive: false }
  return { text: `↑ ${formatCedis(0)} today`, positive: true }
}

function countDayTrend(delta) {
  if (delta > 0) return { text: `↑ +${delta} today`, positive: true }
  if (delta < 0) return { text: `↓ ${delta} today`, positive: false }
  return { text: "↑ +0 today", positive: true }
}

/** Matched height for line + doughnut in Sales breakdown (lg two-column row). */
const SALES_BREAKDOWN_CHART_HEIGHT = 340

export default function Dashboard() {
  const { user, token, authReady } = useAuth()
  const isAdmin = user?.role === "Admin"
  const isSalesAgent = user?.role === ROLE_SALES_AGENT
  const catalog = useCatalog()
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
  const dateLabel = formatDateRangeLabel(dateRange)
  const rangeEndIso =
    rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : localDateToIso(new Date())
  const calendarTodayIso = localDateToIso(new Date())
  const endDayCommissionLabel =
    rangeEndIso === calendarTodayIso ? "Today's Commission" : "End-day Commission"
  const endDaySalesLabel = rangeEndIso === calendarTodayIso ? "Today's Sales" : "End-day Sales"

  const rawLocations = catalog.data?.locations
  const locations = React.useMemo(() => rawLocations ?? [], [rawLocations])
  const agentStore = React.useMemo(() => findAgentStoreLocation(locations, user), [locations, user])

  const statsLocationId = React.useMemo(() => {
    if (isSalesAgent) return agentStore?.id ?? ""
    if (locationId === "all") return ""
    return locationId
  }, [isSalesAgent, agentStore?.id, locationId])

  const voucherStatsQuery = useQuery({
    queryKey: ["voucher-stats", token, statsLocationId],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchVoucherStats(token, { locationId: statsLocationId || undefined })
      if (!r.ok) throw new Error(r.error || "Failed to load voucher stats")
      return r
    },
    enabled: authReady && Boolean(token) && isAdmin,
    staleTime: 30_000,
  })

  const filtered = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    let rows
    if (isSalesAgent) {
      if (!agentStore) return []
      rows = filterSalesByLocation(sales, agentStore.id)
    } else {
      rows = filterSalesByLocation(sales, locationId)
    }
    if (rangeComplete && dateRange?.from && dateRange?.to) {
      rows = filterSalesByDateRange(
        rows,
        localDateToIso(dateRange.from),
        localDateToIso(dateRange.to),
      )
    }
    return rows
  }, [catalog.data, locationId, isSalesAgent, agentStore, dateRange, rangeComplete])

  const totalVouchersInScope = voucherStatsQuery.data?.total ?? 0
  const remainingVouchers = voucherStatsQuery.data?.remaining ?? 0

  const commissionRate = useSalesAgentCommissionRate()

  const m = React.useMemo(() => {
    const packages = catalog.data?.packages ?? []
    return getDashboardMetrics(filtered, packages)
  }, [catalog.data, filtered])

  const agentKpi = React.useMemo(
    () =>
      isSalesAgent ? getAgentCommissionMetrics(filtered, commissionRate, rangeEndIso) : null,
    [isSalesAgent, filtered, commissionRate, rangeEndIso],
  )

  const sparkTotalRevenue = React.useMemo(() => getSparklineCumulativeRevenue(filtered, 14), [filtered])
  const sparkTodayRevenue = React.useMemo(() => getSparklineDailyCompletedRevenue(filtered, 14), [filtered])
  const sparkTotalSales = React.useMemo(() => getSparklineDailySalesCount(filtered, 14), [filtered])
  const sparkSold = React.useMemo(() => getSparklineDailySoldCount(filtered, 14), [filtered])
  const sparkTotalCommission = React.useMemo(
    () => getSparklineCumulativeCommission(filtered, commissionRate, 14),
    [filtered, commissionRate],
  )
  const sparkTodayCommission = React.useMemo(
    () => getSparklineDailyCommission(filtered, commissionRate, 14),
    [filtered, commissionRate],
  )
  const sparkCumulativeSales = React.useMemo(() => getSparklineCumulativeSoldCount(filtered, 14), [filtered])
  const grossRevenueTrend = React.useMemo(() => getMonthlyGrossRevenueTrend(filtered, 6), [filtered])
  const revenueByWeekday = React.useMemo(() => getCompletedRevenueByWeekday(filtered), [filtered])
  const dod = React.useMemo(() => getDayOverDaySummary(filtered, rangeEndIso), [filtered, rangeEndIso])
  const agentDod = React.useMemo(
    () =>
      isSalesAgent ? getDayOverDaySummaryForAgent(filtered, commissionRate, rangeEndIso) : null,
    [isSalesAgent, filtered, commissionRate, rangeEndIso],
  )

  const commissionPercentLabel = `${Math.round(commissionRate * 1000) / 10}% of completed sales`

  const overviewDescription = isAdmin
    ? "Key revenue and sales totals for the selected location and date range (defaults to the last 7 days through today)."
    : `Commission and sale counts for your wifi location (${commissionPercentLabel}). Filter by date range below.`

  const salesBreakdownHint = isAdmin
    ? "Completed gross revenue trend and revenue by day of week (Mon–Sun) for the selected location and date range."
    : "Completed gross revenue trend and revenue by day of week (Mon–Sun) for your wifi location and selected date range."

  const applyPresetDays = (days) => {
    setDateRange(getLastNDaysRange(days))
  }

  const filterSummary = rangeComplete
    ? dateLabel
    : `${dateLabel} (complete both dates to filter)`

  return (
    <div className="space-y-8">
      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading dashboard data…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load data"}
        </p>
      ) : null}

      <PageHeader title="Overview" description={overviewDescription} />

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Choose a date range (defaults to the last 7 days through today). Commission and sales totals update
            for the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="overview-location">{isSalesAgent ? "Wifi location" : "Location"}</Label>
              {isAdmin ? (
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger id="overview-location" className="w-full shadow-none">
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
              ) : (
                <div
                  id="overview-location"
                  className="border-border bg-card text-card-foreground w-full rounded-md border px-3 py-2 text-sm shadow-none"
                >
                  {agentStore ? (
                    <div className="space-y-0.5">
                      <p className="font-medium leading-snug">{agentStore.name}</p>
                      {agentStore.address ? (
                        <p className="text-muted-foreground text-xs leading-snug">{agentStore.address}</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-muted-foreground leading-snug">
                      No store assigned yet. Ask an administrator to link your account to a location.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="overview-date-range">Date range</Label>
              <DateRangePicker
                id="overview-date-range"
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

      <div className="grid auto-rows-auto grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {isSalesAgent && agentKpi && agentDod ? (
          <>
            <StatCard
              tone="violet"
              icon={Percent}
              label="Total Commission"
              value={formatCedis(agentKpi.totalCommission)}
              subline={`${agentKpi.totalSales} completed in range`}
              trend={{ text: commissionPercentLabel, positive: true }}
              sparkline={{ data: sparkTotalCommission, variant: "area" }}
            />
            <StatCard
              tone="emerald"
              icon={DollarSign}
              label={endDayCommissionLabel}
              value={formatCedis(agentKpi.todayCommission)}
              subline={`Previous day ${formatCedis(agentDod.prevDayCommission)}`}
              trend={moneyDayTrend(agentDod.commissionDelta)}
              sparkline={{ data: sparkTodayCommission, variant: "bar" }}
            />
            <StatCard
              tone="amber"
              icon={ShoppingCart}
              label="Total Sales"
              value={String(agentKpi.totalSales)}
              subline={agentKpi.pending > 0 ? `${agentKpi.pending} pending` : "All completed"}
              trend={countDayTrend(agentDod.soldDelta)}
              sparkline={{ data: sparkCumulativeSales, variant: "bar" }}
            />
            <StatCard
              tone="sky"
              icon={Calendar}
              label={endDaySalesLabel}
              value={String(agentKpi.todaySales)}
              subline={`${agentKpi.totalSales} in selected range`}
              trend={countDayTrend(agentDod.soldDelta)}
              sparkline={{ data: sparkSold, variant: "area" }}
            />
          </>
        ) : (
          <>
            <StatCard
              tone="violet"
              icon={DollarSign}
              label="Total Revenue"
              value={formatCedis(m.totalRevenue)}
              subline={`${m.sold} completed`}
              trend={{ text: `${m.utilizationRate}% utilized`, positive: true }}
              sparkline={{ data: sparkTotalRevenue, variant: "area" }}
            />
            <StatCard
              tone="emerald"
              icon={Calendar}
              label="Today's Revenue"
              value={formatCedis(m.todaysRevenue)}
              subline={`Yesterday ${formatCedis(dod.prevDayCompletedRevenue)}`}
              trend={moneyDayTrend(dod.revenueDelta)}
              sparkline={{ data: sparkTodayRevenue, variant: "bar" }}
            />
            <StatCard
              tone="amber"
              icon={ShoppingCart}
              label="Total Vouchers"
              value={
                voucherStatsQuery.isLoading
                  ? "…"
                  : voucherStatsQuery.isError
                    ? "—"
                    : String(totalVouchersInScope)
              }
              subline={
                voucherStatsQuery.isError
                  ? "Could not load vouchers"
                  : `${remainingVouchers} remaining`
              }
              trend={countDayTrend(dod.salesDelta)}
              sparkline={{ data: sparkTotalSales, variant: "bar" }}
            />
            <StatCard
              tone="sky"
              icon={Wallet}
              label="Sold Vouchers"
              value={String(m.sold)}
              subline={
                voucherStatsQuery.isLoading
                  ? "…"
                  : voucherStatsQuery.isError
                    ? "Could not load vouchers"
                    : `${remainingVouchers} remaining`
              }
              trend={countDayTrend(dod.soldDelta)}
              sparkline={{ data: sparkSold, variant: "area" }}
            />
          </>
        )}
      </div>

      <Card className="border-border bg-card shadow-none ring-0">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-lg font-semibold tracking-tight">Sales breakdown</CardTitle>
          <CardDescription className="text-sm leading-relaxed">{salesBreakdownHint}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
            <div className="flex min-h-0 flex-col gap-2 lg:h-full">
              <h3 className="text-muted-foreground shrink-0 text-xs font-semibold uppercase tracking-wider">
                Gross revenue trend
              </h3>
              <div className="border-border/60 bg-muted/25 flex min-h-0 flex-1 flex-col rounded-lg border p-3 sm:p-4 dark:bg-muted/15">
                <div className="w-full shrink-0" style={{ height: SALES_BREAKDOWN_CHART_HEIGHT }}>
                  <GrossRevenueTrendChart data={grossRevenueTrend} height={SALES_BREAKDOWN_CHART_HEIGHT} />
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-col gap-2 lg:h-full">
              <h3 className="text-muted-foreground shrink-0 text-xs font-semibold uppercase tracking-wider">
                Mon–Sun revenue
              </h3>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="w-full shrink-0" style={{ height: SALES_BREAKDOWN_CHART_HEIGHT }}>
                  <WeekdayRevenuePieChart data={revenueByWeekday} height={SALES_BREAKDOWN_CHART_HEIGHT} />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold tracking-tight">Quick actions</CardTitle>
          <CardDescription className="text-sm">Shortcuts to common workflows.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          {isAdmin ? (
            <Button asChild className="font-medium">
              <Link to="/packages">Add package</Link>
            </Button>
          ) : (
            <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
              <Link to="/packages">Packages</Link>
            </Button>
          )}
          {isAdmin ? (
            <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
              <Link to="/packages">Record sale</Link>
            </Button>
          ) : null}
          {isAdmin ? (
            <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
              <Link to="/locations">Manage locations</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
            <Link to="/sales-history">Sales history</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Calendar, DollarSign, MapPin, Percent, ShoppingCart, Wallet } from "lucide-react"
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
import { LiveIndicator } from "@/components/customers/LiveIndicator.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { fetchVoucherStats } from "@/lib/api.js"
import {
  currentWeekRange,
  filterSalesByDateRange,
  filterSalesByLocation,
  filterSalesForAgentAttribution,
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
import { LIVE_POLL_MS } from "@/hooks/useLiveCustomerDashboard.js"
import { ROLE_SALES_AGENT } from "@/lib/roles.js"
import {
  accraTodayIso,
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
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, token, authReady } = useAuth()
  const [flashMessage, setFlashMessage] = React.useState(/** @type {string | null} */ (null))
  const [pulseKey, setPulseKey] = React.useState(0)
  const [lastUpdated, setLastUpdated] = React.useState(/** @type {Date | null} */ (null))
  const prevMetricsSigRef = React.useRef(/** @type {string | null} */ (null))

  React.useEffect(() => {
    const msg = location.state?.flashMessage
    if (typeof msg === "string" && msg.trim()) {
      setFlashMessage(msg.trim())
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.pathname, location.state, navigate])
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
    setDateRange(currentWeekRange())
  }, [])

  const rangeComplete = isCompleteDateRange(dateRange)
  const rangeEndIso =
    rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : localDateToIso(new Date())
  const rangeStartIso =
    rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : rangeEndIso
  const calendarTodayIso = accraTodayIso()
  const reportingDayIso =
    rangeStartIso <= calendarTodayIso && calendarTodayIso <= rangeEndIso
      ? calendarTodayIso
      : rangeEndIso
  const endDayCommissionLabel =
    reportingDayIso === calendarTodayIso ? "Today's Commission" : "End-day Commission"
  const endDaySalesLabel = reportingDayIso === calendarTodayIso ? "Today's Sales" : "End-day Sales"

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
    staleTime: 0,
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })

  React.useEffect(() => {
    if (!token) return
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["catalog", token] })
    }, LIVE_POLL_MS)
    return () => window.clearInterval(id)
  }, [token, queryClient])

  const filtered = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    let rows
    if (isSalesAgent) {
      if (!agentStore) return []
      rows = filterSalesForAgentAttribution(filterSalesByLocation(sales, agentStore.id))
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
    return getDashboardMetrics(filtered, packages, reportingDayIso)
  }, [catalog.data, filtered, reportingDayIso])

  const agentKpi = React.useMemo(
    () =>
      isSalesAgent ? getAgentCommissionMetrics(filtered, commissionRate, reportingDayIso) : null,
    [isSalesAgent, filtered, commissionRate, reportingDayIso],
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
  const dod = React.useMemo(
    () => getDayOverDaySummary(filtered, reportingDayIso),
    [filtered, reportingDayIso],
  )
  const agentDod = React.useMemo(
    () =>
      isSalesAgent ? getDayOverDaySummaryForAgent(filtered, commissionRate, reportingDayIso) : null,
    [isSalesAgent, filtered, commissionRate, reportingDayIso],
  )

  const commissionPercentLabel = `${Math.round(commissionRate * 1000) / 10}% of completed sales`

  const overviewDescription = isAdmin
    ? "Key revenue and sales totals for the selected location and date range (defaults to this week, Tuesday–Monday)."
    : `Commission and sale counts for your wifi location (${commissionPercentLabel}). Use the date range picker above.`

  const salesBreakdownHint = isAdmin
    ? "Completed gross revenue trend and revenue by day of week (Mon–Sun) for the selected location and date range."
    : "Completed gross revenue trend and revenue by day of week (Mon–Sun) for your wifi location and selected date range."

  const statsScopeKey = React.useMemo(() => {
    const from = rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : ""
    const to = rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : ""
    const loc = isSalesAgent ? agentStore?.id ?? "agent" : locationId
    return `${loc}:${from}:${to}`
  }, [isSalesAgent, agentStore?.id, locationId, rangeComplete, dateRange])

  const metricsSig = React.useMemo(() => {
    if (isSalesAgent && agentKpi) {
      return `${agentKpi.totalCommission}-${agentKpi.todayCommission}-${agentKpi.totalSales}-${agentKpi.todaySales}`
    }
    return `${m.totalRevenue}-${m.todaysRevenue}-${m.sold}-${totalVouchersInScope}-${remainingVouchers}`
  }, [isSalesAgent, agentKpi, m, totalVouchersInScope, remainingVouchers])

  React.useEffect(() => {
    if (catalog.isLoading) return
    if (prevMetricsSigRef.current != null && prevMetricsSigRef.current !== metricsSig) {
      setPulseKey((k) => k + 1)
    }
    prevMetricsSigRef.current = metricsSig
    setLastUpdated(new Date())
  }, [metricsSig, catalog.isLoading])

  React.useEffect(() => {
    if (!catalog.isFetching && !catalog.isLoading && catalog.data) {
      setLastUpdated(new Date())
    }
  }, [catalog.isFetching, catalog.isLoading, catalog.dataUpdatedAt, catalog.data])

  const statsReady = !catalog.isLoading && rangeComplete && Boolean(catalog.data)
  const isLiveFetching = catalog.isFetching || (isAdmin && voucherStatsQuery.isFetching)

  return (
    <div className="space-y-8">
      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading dashboard data…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load data"}
        </p>
      ) : null}

      <PageHeader title="Overview" description={overviewDescription}>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            {isAdmin ? (
              <div className="space-y-1 sm:text-right">
                <Label
                  htmlFor="overview-location-top"
                  className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
                >
                  Location
                </Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger id="overview-location-top" className="h-9 w-full min-w-[11rem] shadow-none sm:w-52">
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
            ) : (
              <p className="text-muted-foreground flex items-center gap-1.5 pb-2 text-xs sm:justify-end">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span>{agentStore?.name ?? "No store assigned"}</span>
              </p>
            )}
            <div className="space-y-1 sm:text-right">
              <Label
                htmlFor="overview-date-range"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Date range
              </Label>
              <DateRangePicker
                id="overview-date-range"
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
          <LiveIndicator lastUpdated={lastUpdated} isFetching={isLiveFetching} />
        </div>
      </PageHeader>

      {flashMessage ? (
        <p
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100"
          role="status"
        >
          {flashMessage}
        </p>
      ) : null}

      <div className="grid auto-rows-auto grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {isSalesAgent && agentKpi && agentDod ? (
          <>
            <StatCard
              tone="violet"
              icon={Percent}
              label="Total Commission"
              value={formatCedis(agentKpi.totalCommission)}
              moneyAmount={agentKpi.totalCommission}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
              subline={`${agentKpi.totalSales} completed in range`}
              trend={{ text: commissionPercentLabel, positive: true }}
              sparkline={{ data: sparkTotalCommission, variant: "area" }}
            />
            <StatCard
              tone="emerald"
              icon={DollarSign}
              label={endDayCommissionLabel}
              value={formatCedis(agentKpi.todayCommission)}
              moneyAmount={agentKpi.todayCommission}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
              subline={`Previous day ${formatCedis(agentDod.prevDayCommission)}`}
              trend={moneyDayTrend(agentDod.commissionDelta)}
              sparkline={{ data: sparkTodayCommission, variant: "bar" }}
            />
            <StatCard
              tone="amber"
              icon={ShoppingCart}
              label="Total Sales"
              value={String(agentKpi.totalSales)}
              countValue={agentKpi.totalSales}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
              subline={agentKpi.pending > 0 ? `${agentKpi.pending} pending` : "All completed"}
              trend={countDayTrend(agentDod.soldDelta)}
              sparkline={{ data: sparkCumulativeSales, variant: "bar" }}
            />
            <StatCard
              tone="sky"
              icon={Calendar}
              label={endDaySalesLabel}
              value={String(agentKpi.todaySales)}
              countValue={agentKpi.todaySales}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
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
              moneyAmount={m.totalRevenue}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
              subline={`${m.sold} completed`}
              trend={{ text: `${m.utilizationRate}% utilized`, positive: true }}
              sparkline={{ data: sparkTotalRevenue, variant: "area" }}
            />
            <StatCard
              tone="emerald"
              icon={Calendar}
              label="Today's Revenue"
              value={formatCedis(m.todaysRevenue)}
              moneyAmount={m.todaysRevenue}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
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
              countValue={totalVouchersInScope}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady && !voucherStatsQuery.isLoading && !voucherStatsQuery.isError}
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
              countValue={m.sold}
              animate
              scopeKey={statsScopeKey}
              pulseKey={pulseKey}
              animateEnabled={statsReady}
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

import * as React from "react"
import { Link } from "react-router-dom"
import { Calendar, DollarSign, ShoppingCart, Wallet } from "lucide-react"
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
import { sales } from "@/data/sales.js"
import { locations } from "@/data/locations.js"
import {
  filterSalesByLocation,
  getCompletedRevenueByWeekday,
  getDashboardMetrics,
  getDayOverDaySummary,
  getMonthlyGrossRevenueTrend,
  getSparklineCumulativeRevenue,
  getSparklineDailyCompletedRevenue,
  getSparklineDailySalesCount,
  getSparklineDailySoldCount,
} from "@/lib/aggregations.js"
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
  const [locationId, setLocationId] = React.useState("all")
  const filtered = React.useMemo(() => filterSalesByLocation(sales, locationId), [locationId])
  const m = React.useMemo(() => getDashboardMetrics(filtered), [filtered])

  const sparkTotalRevenue = React.useMemo(() => getSparklineCumulativeRevenue(filtered, 14), [filtered])
  const sparkTodayRevenue = React.useMemo(() => getSparklineDailyCompletedRevenue(filtered, 14), [filtered])
  const sparkTotalSales = React.useMemo(() => getSparklineDailySalesCount(filtered, 14), [filtered])
  const sparkSold = React.useMemo(() => getSparklineDailySoldCount(filtered, 14), [filtered])
  const grossRevenueTrend = React.useMemo(() => getMonthlyGrossRevenueTrend(filtered, 6), [filtered])
  const revenueByWeekday = React.useMemo(() => getCompletedRevenueByWeekday(filtered), [filtered])
  const dod = React.useMemo(() => getDayOverDaySummary(filtered), [filtered])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Key revenue and sales totals for the selected location (mock data)."
      >
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Location</span>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-full border-border bg-card shadow-none sm:w-[220px]">
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
      </PageHeader>

      <div className="grid auto-rows-auto grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
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
          label="Total Sales"
          value={String(m.totalSales)}
          subline={`${m.pending} pending`}
          trend={countDayTrend(dod.salesDelta)}
          sparkline={{ data: sparkTotalSales, variant: "bar" }}
        />
        <StatCard
          tone="sky"
          icon={Wallet}
          label="Sold Vouchers"
          value={String(m.sold)}
          subline={`${m.available} available`}
          trend={countDayTrend(dod.soldDelta)}
          sparkline={{ data: sparkSold, variant: "area" }}
        />
      </div>

      <Card className="border-border bg-card shadow-none ring-0">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-lg font-semibold tracking-tight">Sales breakdown</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Six-month completed gross revenue trend and completed revenue by day of week (Mon–Sun). Respects the
            location filter above.
          </CardDescription>
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
          <Button asChild className="font-medium">
            <Link to="/packages">Add package</Link>
          </Button>
          <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
            <Link to="/sales">Record sale</Link>
          </Button>
          <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
            <Link to="/locations">Manage locations</Link>
          </Button>
          <Button asChild variant="outline" className="border-border bg-card font-medium shadow-none">
            <Link to="/sales-history">Sales history</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

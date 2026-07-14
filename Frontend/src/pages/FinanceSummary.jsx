import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Building2, Coins, HandCoins, Landmark, PiggyBank, Receipt } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { LiveIndicator } from "@/components/customers/LiveIndicator.jsx"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext.jsx"
import { fetchFinanceSummary } from "@/lib/api.js"
import { currentWeekRange, getWeekEndFromStart, getWeekStartFromDate } from "@/lib/aggregations.js"
import {
  formatDateRangeLabel,
  getLastNDaysRange,
  isCompleteDateRange,
  localDateToIso,
  normalizeDateRange,
} from "@/lib/dates.js"
import { cn, formatCedis } from "@/lib/utils"

function SummaryCard({ label, value, hint, icon: Icon }) {
  return (
    <Card className="border-border bg-card py-0 shadow-none ring-1 ring-border">
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

export default function FinanceSummary() {
  const { token, authReady } = useAuth()
  const [dateRange, setDateRange] = React.useState(/** @type {{ from?: Date, to?: Date } | undefined} */ (undefined))
  const [lastUpdated, setLastUpdated] = React.useState(/** @type {Date | null} */ (null))
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
  const fromIso = rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : ""
  const toIso = rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : ""
  const isFinanceWeek =
    Boolean(fromIso && toIso) &&
    getWeekStartFromDate(fromIso) === fromIso &&
    getWeekEndFromStart(fromIso) === toIso

  const summaryQuery = useQuery({
    queryKey: ["financeSummary", token, fromIso, toIso],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchFinanceSummary(token, { from: fromIso, to: toIso })
      if (!result.ok) throw new Error(result.error || "Failed to load finance summary.")
      return result
    },
    enabled: authReady && Boolean(token) && rangeComplete && Boolean(fromIso) && Boolean(toIso),
  })

  const data = summaryQuery.data
  const totals = data?.totals
  const locations = data?.locations ?? []

  React.useEffect(() => {
    if (!summaryQuery.isFetching && data) {
      setLastUpdated(new Date())
    }
  }, [summaryQuery.isFetching, data])

  const periodLabel =
    rangeComplete && dateRange ? formatDateRangeLabel(dateRange) : "Select a date range"

  const columns = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Location",
        cell: ({ getValue }) => <span className="font-medium">{String(getValue() ?? "")}</span>,
      },
      {
        accessorKey: "grossRevenue",
        header: "Revenue",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      {
        accessorKey: "tithe",
        header: "Tithe (10%)",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      {
        accessorKey: "lightBill",
        header: "Light bill",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      {
        accessorKey: "hostelPayout",
        header: "Manager fee",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ row, getValue }) => (
          <span title={`${Number(row.original.commissionRate) || 20}% of remainder`}>
            {formatCedis(getValue())}
          </span>
        ),
      },
      {
        accessorKey: "expenseTotal",
        header: "Expenses",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      {
        accessorKey: "netProfit",
        header: "Net profit",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ getValue }) => (
          <span className={cn(Number(getValue()) < 0 && "text-destructive")}>{formatCedis(getValue())}</span>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Finance"
        description="Weekly revenue, tithe, light bill, hostel manager fee, expenses, and net profit (Tuesday–Monday, Africa/Accra)."
      >
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" asChild>
              <Link to="/finance/expenses">Manage expenses</Link>
            </Button>
            <div className="space-y-1 sm:text-right">
              <Label
                htmlFor="finance-date-range"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Date range
              </Label>
              <DateRangePicker
                id="finance-date-range"
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
          <LiveIndicator lastUpdated={lastUpdated} isFetching={summaryQuery.isFetching} />
        </div>
      </PageHeader>

      {rangeComplete ? (
        <p className="text-muted-foreground text-sm">
          {isFinanceWeek || data?.isFinanceWeek ? (
            <>
              Finance week <span className="text-foreground font-medium">{periodLabel}</span> (Tuesday–Monday,
              Africa/Accra).
            </>
          ) : (
            <>
              Finance range <span className="text-foreground font-medium">{periodLabel}</span>
              {data?.lightBillWeeks != null && data.lightBillWeeks > 1
                ? ` · light bill × ${data.lightBillWeeks} weeks`
                : null}
              .
            </>
          )}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">Pick a start and end date to load the finance summary.</p>
      )}

      {summaryQuery.isLoading ? <p className="text-muted-foreground text-sm">Loading finance summary…</p> : null}
      {summaryQuery.error ? (
        <p className="text-destructive text-sm" role="alert">
          {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Failed to load summary."}
        </p>
      ) : null}

      {data?.snapshot?.finalizedAt ? (
        <Badge variant="outline" className="gap-1.5">
          <Landmark className="size-3.5" aria-hidden />
          Finalized {new Date(data.snapshot.finalizedAt).toLocaleString()}
        </Badge>
      ) : null}

      {totals ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <SummaryCard label="Gross revenue" value={formatCedis(totals.grossRevenue)} icon={Coins} />
          <SummaryCard label="Tithe (10%)" value={formatCedis(totals.tithe)} icon={Building2} />
          <SummaryCard
            label="Total payout"
            value={formatCedis(
              (Number(totals.tithe) || 0) +
                (Number(totals.hostelPayout) || 0) +
                (Number(totals.lightBill) || 0),
            )}
            icon={HandCoins}
          />
          <SummaryCard label="Expenses" value={formatCedis(totals.expenses)} icon={Receipt} />
          <SummaryCard label="Net profit" value={formatCedis(totals.netProfit)} icon={PiggyBank} />
        </div>
      ) : null}

      <Card className="border-border shadow-none ring-1 ring-border">
        <CardHeader>
          <CardTitle className="text-base">Per-location breakdown</CardTitle>
          <CardDescription>
            Per location: 10% tithe and light bill (GH₵ 50 where applied; Outdoor is 0), then 20% of the remainder as
            hostel manager fee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={locations} emptyMessage="No locations or sales for this week." />
        </CardContent>
      </Card>
    </div>
  )
}

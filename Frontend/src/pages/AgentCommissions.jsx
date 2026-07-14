import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Coins, ShoppingCart, Users } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { useSalesAgentCommissionRate } from "@/hooks/useAppSettings.js"
import { fetchUsersList } from "@/lib/api.js"
import {
  currentWeekRange,
  filterSalesByDateRange,
  getAgentSalesCommissionRows,
  sumAgentSalesCommissionRows,
} from "@/lib/aggregations.js"
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

export default function AgentCommissions() {
  const { token, authReady } = useAuth()
  const catalog = useCatalog()
  const commissionRate = useSalesAgentCommissionRate()
  const commissionPercentLabel = `${Math.round(commissionRate * 1000) / 10}%`

  const allSales = catalog.data?.sales ?? []

  const [dateRange, setDateRange] = React.useState(/** @type {{ from?: Date, to?: Date } | undefined} */ (undefined))
  const [allTime, setAllTime] = React.useState(false)
  const rangeInitialized = React.useRef(false)

  const handleDateRangeChange = React.useCallback((range) => {
    setAllTime(false)
    setDateRange(normalizeDateRange(range))
  }, [])

  React.useEffect(() => {
    if (rangeInitialized.current) return
    rangeInitialized.current = true
    setDateRange(currentWeekRange())
  }, [])

  const rangeComplete = isCompleteDateRange(dateRange)
  const dateLabel = allTime ? "All time" : formatDateRangeLabel(dateRange)

  const filteredSales = React.useMemo(() => {
    if (allTime) return allSales
    if (rangeComplete && dateRange?.from && dateRange?.to) {
      return filterSalesByDateRange(
        allSales,
        localDateToIso(dateRange.from),
        localDateToIso(dateRange.to),
      )
    }
    return allSales
  }, [allSales, allTime, dateRange, rangeComplete])

  const usersQuery = useQuery({
    queryKey: ["teamUsers", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchUsersList(token)
      if (!result.ok) throw new Error(result.error || "Failed to load users")
      return result.users
    },
    enabled: authReady && Boolean(token),
  })

  const rows = React.useMemo(() => {
    const locations = catalog.data?.locations ?? []
    const users = usersQuery.data ?? []
    return getAgentSalesCommissionRows(filteredSales, locations, users, commissionRate)
  }, [catalog.data, filteredSales, usersQuery.data, commissionRate])

  const totals = React.useMemo(() => sumAgentSalesCommissionRows(rows), [rows])
  const activeAgentCount = React.useMemo(() => rows.filter((r) => r.active).length, [rows])

  const applyPresetDays = (days) => {
    setAllTime(false)
    setDateRange(getLastNDaysRange(days))
  }

  const applyThisWeek = () => {
    setAllTime(false)
    setDateRange(currentWeekRange())
  }

  const columns = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Agent",
        meta: {
          wrap: true,
          headerClassName: "w-[7.5rem]",
          cellClassName: "min-w-0 align-top",
        },
        cell: ({ getValue }) => (
          <span className="block text-sm font-medium break-words">{String(getValue() ?? "")}</span>
        ),
      },
      {
        accessorKey: "locationName",
        header: "Wifi location",
        meta: {
          wrap: true,
          headerClassName: "w-[10rem]",
          cellClassName: "min-w-0 align-top",
        },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground block text-sm break-words">{String(getValue() ?? "—")}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        meta: {
          wrap: true,
          headerClassName: "w-[12rem]",
          cellClassName: "min-w-0 align-top",
        },
        cell: ({ getValue }) => {
          const email = String(getValue() ?? "")
          return (
            <span className="block text-sm leading-snug break-all [overflow-wrap:anywhere]" title={email}>
              {email}
            </span>
          )
        },
      },
      {
        accessorKey: "active",
        header: "Status",
        meta: {
          wrap: false,
          headerClassName: "w-[5.75rem]",
          cellClassName: "w-[5.75rem] align-top",
        },
        cell: ({ getValue }) => {
          const active = getValue()
          return <Badge variant={active ? "outline" : "secondary"}>{active ? "Active" : "Inactive"}</Badge>
        },
      },
      {
        accessorKey: "completedSales",
        header: "Completed sales",
        meta: {
          wrap: false,
          headerClassName: "w-[7rem] text-right",
          cellClassName: "w-[7rem] text-right align-top tabular-nums",
        },
        cell: ({ getValue }) => Number(getValue()).toLocaleString(),
      },
      {
        accessorKey: "grossRevenue",
        header: "Gross sales",
        meta: {
          wrap: false,
          headerClassName: "w-[7.5rem] text-right",
          cellClassName: "w-[7.5rem] text-right align-top tabular-nums",
        },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      {
        accessorKey: "commission",
        header: "Commission",
        meta: {
          wrap: false,
          headerClassName: "w-[7.5rem] text-right",
          cellClassName: "w-[7.5rem] text-right align-top font-medium tabular-nums",
        },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
    ],
    [],
  )

  const loading = catalog.isLoading || usersQuery.isLoading
  const error = catalog.error ?? usersQuery.error

  const filterSummary =
    allTime || rangeComplete
      ? dateLabel
      : `${dateLabel} (complete both dates to filter)`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent commissions"
        description={`Completed sales and commission owed per sales agent (${commissionPercentLabel} of gross). Assign agents under Locations; change the rate in Settings.`}
      />

      {loading ? <p className="text-muted-foreground text-sm">Loading agent performance…</p> : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error instanceof Error ? error.message : "Failed to load data."}
        </p>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Type or pick a custom date range for commission totals, or view all time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="commission-date-range">Date range</Label>
            <DateRangePicker
              id="commission-date-range"
              value={allTime ? undefined : dateRange}
              onChange={handleDateRangeChange}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">Quick range:</span>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPresetDays(7)}>
              Last 7 days
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPresetDays(30)}>
              Last 30 days
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={applyThisWeek}>
              This week
            </Button>
            <Button
              type="button"
              variant={allTime ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setAllTime(true)
                setDateRange(undefined)
              }}
            >
              All time
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAllTime(false)
                setDateRange(getLastNDaysRange(7))
              }}
            >
              Reset to last 7 days
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Showing <span className="text-foreground font-medium">{filterSummary}</span>
          </p>
        </CardContent>
      </Card>

      <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", loading && "opacity-60")}>
        <SummaryCard
          label="Active agents"
          value={String(activeAgentCount)}
          hint={`${rows.length} sales agent account(s) total`}
          icon={Users}
        />
        <SummaryCard
          label="Completed sales"
          value={totals.completedSales.toLocaleString()}
          hint={filterSummary}
          icon={ShoppingCart}
        />
        <SummaryCard
          label="Total commission"
          value={formatCedis(totals.commission)}
          hint={`${formatCedis(totals.grossRevenue)} gross · ${commissionPercentLabel}`}
          icon={Coins}
        />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        searchPlaceholder="Search agent, location, email…"
        pageSize={15}
        initialSorting={[{ id: "commission", desc: true }]}
        fixedLayout
        className={loading ? "opacity-60" : undefined}
      />
    </div>
  )
}

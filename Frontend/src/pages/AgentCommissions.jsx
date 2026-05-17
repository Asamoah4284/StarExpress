import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Coins, ShoppingCart, Users } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { useSalesAgentCommissionRate } from "@/hooks/useAppSettings.js"
import { fetchUsersList } from "@/lib/api.js"
import {
  filterSalesByDateRange,
  formatWeekRangeLabel,
  getAgentSalesCommissionRows,
  getWeekEndFromStart,
  getWeekOptionsFromSales,
  getWeekStartFromDate,
  sumAgentSalesCommissionRows,
} from "@/lib/aggregations.js"
import { cn, formatCedis } from "@/lib/utils"

const ALL_TIME_WEEK = "all"

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

  const weekOptions = React.useMemo(() => getWeekOptionsFromSales(allSales), [allSales])

  const [weekFilter, setWeekFilter] = React.useState(/** @type {string} */ (ALL_TIME_WEEK))
  const weekFilterInitialized = React.useRef(false)

  React.useEffect(() => {
    if (weekFilterInitialized.current || catalog.isLoading) return
    weekFilterInitialized.current = true
    if (weekOptions.length > 0) {
      setWeekFilter(weekOptions[0].weekStart)
    }
  }, [catalog.isLoading, weekOptions])

  const selectedWeek = React.useMemo(() => {
    if (weekFilter === ALL_TIME_WEEK) return null
    const found = weekOptions.find((w) => w.weekStart === weekFilter)
    if (found) return found
    const weekEnd = getWeekEndFromStart(weekFilter)
    return {
      weekStart: weekFilter,
      weekEnd,
      label: formatWeekRangeLabel(weekFilter, weekEnd),
    }
  }, [weekFilter, weekOptions])

  const filteredSales = React.useMemo(() => {
    if (!selectedWeek) return allSales
    return filterSalesByDateRange(allSales, selectedWeek.weekStart, selectedWeek.weekEnd)
  }, [allSales, selectedWeek])

  const weekFilterLabel = selectedWeek
    ? `${selectedWeek.label} (Mon–Sun)`
    : "All time"

  const weekNav = React.useMemo(() => {
    if (weekFilter === ALL_TIME_WEEK || !weekOptions.length) {
      return { prev: null, next: null }
    }
    const idx = weekOptions.findIndex((w) => w.weekStart === weekFilter)
    return {
      prev: idx >= 0 && idx < weekOptions.length - 1 ? weekOptions[idx + 1].weekStart : null,
      next: idx > 0 ? weekOptions[idx - 1].weekStart : null,
    }
  }, [weekFilter, weekOptions])

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
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="commission-week">Week</Label>
            <Select value={weekFilter} onValueChange={setWeekFilter}>
              <SelectTrigger id="commission-week" className="w-full">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TIME_WEEK}>All time</SelectItem>
                {weekOptions.map((w) => (
                  <SelectItem key={w.weekStart} value={w.weekStart}>
                    {w.label}
                  </SelectItem>
                ))}
                {weekFilter !== ALL_TIME_WEEK &&
                !weekOptions.some((w) => w.weekStart === weekFilter) ? (
                  <SelectItem value={weekFilter}>{selectedWeek?.label ?? weekFilter}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={weekFilter === ALL_TIME_WEEK || !weekNav.prev}
              onClick={() => weekNav.prev && setWeekFilter(weekNav.prev)}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={weekFilter === ALL_TIME_WEEK || !weekNav.next}
              onClick={() => weekNav.next && setWeekFilter(weekNav.next)}
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setWeekFilter(getWeekStartFromDate(new Date().toISOString().slice(0, 10)))
              }
            >
              This week
            </Button>
          </div>
          <p className="text-muted-foreground w-full text-sm sm:w-auto sm:flex-1 sm:text-right">
            Showing <span className="text-foreground font-medium">{weekFilterLabel}</span>
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
          hint={selectedWeek ? weekFilterLabel : "All agents, all wifi locations"}
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

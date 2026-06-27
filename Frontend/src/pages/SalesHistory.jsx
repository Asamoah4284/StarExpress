import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { LiveIndicator } from "@/components/customers/LiveIndicator.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { LIVE_POLL_MS, useLiveSales } from "@/hooks/useLiveCustomerDashboard.js"
import { useCompanyName } from "@/hooks/useAppSettings.js"
import { filterSalesByDateRange, filterSalesByLocation, salesToCsv } from "@/lib/aggregations.js"
import {
  formatDateRangeLabel,
  formatSaleDateTime,
  getLastNDaysRange,
  isCompleteDateRange,
  localDateToIso,
  normalizeDateRange,
} from "@/lib/dates.js"
import { locationNameById } from "@/lib/locations.js"
import { formatCedis } from "@/lib/utils"

export default function SalesHistory() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const catalog = useCatalog()
  const companyName = useCompanyName()
  const locations = catalog.data?.locations ?? []
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

  const locationLabel =
    locationId === "all"
      ? "All locations"
      : (locations.find((l) => l.id === locationId)?.name ?? locationId)

  const filtered = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    let rows = filterSalesByLocation(sales, locationId)
    if (rangeComplete && dateRange?.from && dateRange?.to) {
      rows = filterSalesByDateRange(
        rows,
        localDateToIso(dateRange.from),
        localDateToIso(dateRange.to),
      )
    }
    return [...rows].sort((a, b) => {
      const ta = a.soldAt || `${a.date}T00:00:00`
      const tb = b.soldAt || `${b.date}T00:00:00`
      return ta < tb ? 1 : ta > tb ? -1 : 0
    })
  }, [catalog.data, locationId, dateRange, rangeComplete])

  const salesScopeKey = React.useMemo(() => {
    const from = rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : ""
    const to = rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : ""
    return `${locationId}|${from}|${to}`
  }, [locationId, dateRange, rangeComplete])

  React.useEffect(() => {
    if (!token) return
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["catalog", token] })
    }, LIVE_POLL_MS)
    return () => window.clearInterval(id)
  }, [token, queryClient])

  const { highlightSaleIds, lastUpdated, markRefreshed } = useLiveSales({
    sales: filtered,
    scopeKey: salesScopeKey,
    enabled: Boolean(catalog.data) && !catalog.isLoading,
  })

  React.useEffect(() => {
    if (!catalog.isFetching && catalog.data) {
      markRefreshed()
    }
  }, [catalog.isFetching, catalog.dataUpdatedAt, catalog.data, markRefreshed])

  const columns = React.useMemo(
    () => {
      const locations = catalog.data?.locations ?? []
      return [
        { accessorKey: "id", header: "Sale ID" },
        {
          accessorKey: "customerPhone",
          header: "Phone",
          cell: ({ getValue }) => {
            const v = getValue()
            return v ? String(v) : "—"
          },
        },
        { accessorKey: "packageType", header: "Package Type" },
        {
          accessorKey: "voucherCode",
          header: "Voucher ID",
          cell: ({ getValue }) => {
            const v = getValue()
            return v ? String(v) : "—"
          },
        },
        {
          accessorKey: "amount",
          header: "Amount",
          cell: ({ getValue }) => formatCedis(getValue()),
        },
        {
          accessorKey: "locationId",
          header: "Location",
          cell: ({ getValue }) => locationNameById(getValue(), locations),
        },
        {
          id: "soldAt",
          accessorFn: (row) => row.soldAt || row.date,
          header: "Date & time",
          cell: ({ row }) => (
            <span className="tabular-nums whitespace-nowrap">
              {formatSaleDateTime(row.original.soldAt, row.original.date)}
            </span>
          ),
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ getValue }) => {
            const v = getValue()
            const variant =
              v === "Completed" ? "success" : v === "Pending" ? "secondary" : v === "Cancelled" ? "destructive" : "outline"
            return <Badge variant={variant}>{v}</Badge>
          },
        },
      ]
    },
    [catalog.data],
  )

  const exportCsv = () => {
    const csv = salesToCsv(filtered, { companyName })
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "sales-history.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales History"
        description={
          rangeComplete
            ? `${filtered.length} sale${filtered.length === 1 ? "" : "s"} for ${locationLabel} · ${dateLabel}.`
            : "Browse and export sales. Filter by location and date range."
        }
      >
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <div className="space-y-1 sm:text-right">
              <Label
                htmlFor="sales-history-location-top"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Location
              </Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="sales-history-location-top" className="h-9 w-full min-w-[11rem] shadow-none sm:w-52">
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
                htmlFor="sales-history-date-range-top"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Date range
              </Label>
              <DateRangePicker
                id="sales-history-date-range-top"
                value={dateRange}
                onChange={handleDateRangeChange}
                align="end"
                className="h-9 w-full min-w-[11rem] shadow-none sm:w-56"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            <LiveIndicator lastUpdated={lastUpdated} isFetching={catalog.isFetching} />
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
            <Button type="button" onClick={exportCsv} disabled={!filtered.length}>
              Export to CSV
            </Button>
          </div>
        </div>
      </PageHeader>

      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}

      <DataTable
        data={filtered}
        columns={columns}
        pageSize={10}
        searchPlaceholder="Search all columns…"
        highlightRowIds={highlightSaleIds}
      />
    </div>
  )
}

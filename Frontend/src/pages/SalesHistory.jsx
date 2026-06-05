import * as React from "react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCatalog } from "@/hooks/useCatalog.js"
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

  const applyPresetDays = (days) => {
    setDateRange(getLastNDaysRange(days))
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sales History" description="Browse and export sales. Filter by location and date range.">
        <Button type="button" onClick={exportCsv} disabled={!filtered.length}>
          Export to CSV
        </Button>
      </PageHeader>

      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Choose a location and date range, then click Apply range on the calendar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sales-history-location">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="sales-history-location" className="w-full shadow-none">
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
              <Label htmlFor="sales-history-date-range">Date range</Label>
              <DateRangePicker
                id="sales-history-date-range"
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
            Showing{" "}
            <span className="text-foreground font-medium">
              {locationLabel} · {rangeComplete ? dateLabel : `${dateLabel} (complete both dates to filter)`}
            </span>
            {rangeComplete ? (
              <>
                {" "}
                · <span className="text-foreground font-medium">{filtered.length}</span> sale
                {filtered.length === 1 ? "" : "s"}
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      <DataTable data={filtered} columns={columns} pageSize={10} searchPlaceholder="Search all columns…" />
    </div>
  )
}

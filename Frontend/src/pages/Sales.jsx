import * as React from "react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { locationNameById } from "@/lib/locations.js"
import { formatCedis } from "@/lib/utils"

function inDateRange(dateStr, start, end) {
  if (start && dateStr < start) return false
  if (end && dateStr > end) return false
  return true
}

export default function Sales() {
  const catalog = useCatalog()
  const [locationId, setLocationId] = React.useState("all")
  const [start, setStart] = React.useState("")
  const [end, setEnd] = React.useState("")

  const rows = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    return sales
      .filter((s) => (locationId === "all" ? true : s.locationId === locationId))
      .filter((s) => inDateRange(s.date, start, end))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [catalog.data, locationId, start, end])

  const columns = React.useMemo(
    () => {
      const locations = catalog.data?.locations ?? []
      return [
      { accessorKey: "customerName", header: "Customer Name" },
      { accessorKey: "packageType", header: "Package Type" },
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
      { accessorKey: "date", header: "Date" },
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

  const locations = catalog.data?.locations ?? []

  return (
    <div className="space-y-6">
      <PageHeader title="Sales" description="Recent sales with filters (from the API)." />

      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">From</span>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">To</span>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5 lg:w-56">
          <span className="text-muted-foreground text-xs font-medium">Location</span>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger>
              <SelectValue placeholder="Location" />
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
      </div>

      <DataTable data={rows} columns={columns} searchPlaceholder="Search customer, package, status…" pageSize={8} />
    </div>
  )
}

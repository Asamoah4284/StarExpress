import * as React from "react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCatalog } from "@/hooks/useCatalog.js"
import { locationNameById } from "@/lib/locations.js"
import { formatCedis } from "@/lib/utils"
import { salesToCsv } from "@/lib/aggregations.js"

export default function SalesHistory() {
  const catalog = useCatalog()

  const sorted = React.useMemo(() => {
    const sales = catalog.data?.sales ?? []
    return [...sales].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [catalog.data])

  const columns = React.useMemo(
    () => {
      const locations = catalog.data?.locations ?? []
      return [
      { accessorKey: "id", header: "Sale ID" },
      { accessorKey: "customerName", header: "Customer Name" },
      {
        accessorKey: "customerPhone",
        header: "Phone",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v) : "—"
        },
      },
      {
        accessorKey: "paymentNumber",
        header: "Payment #",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? String(v) : "—"
        },
      },
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

  const exportCsv = () => {
    const csv = salesToCsv(sorted)
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
      <PageHeader title="Sales History" description="Full paginated history from the API.">
        <Button type="button" onClick={exportCsv}>
          Export to CSV
        </Button>
      </PageHeader>

      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}

      <DataTable data={sorted} columns={columns} pageSize={10} searchPlaceholder="Search all columns…" />
    </div>
  )
}

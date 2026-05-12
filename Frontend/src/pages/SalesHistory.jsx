import * as React from "react"
import { sales } from "@/data/sales.js"
import { locations } from "@/data/locations.js"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { locationNameById } from "@/lib/locations.js"
import { formatCedis } from "@/lib/utils"
import { salesToCsv } from "@/lib/aggregations.js"

export default function SalesHistory() {
  const sorted = React.useMemo(
    () => [...sales].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [],
  )

  const columns = React.useMemo(
    () => [
      { accessorKey: "id", header: "Sale ID" },
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
    ],
    [],
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
      <PageHeader title="Sales History" description="Full paginated history of all sales (mock data).">
        <Button type="button" onClick={exportCsv}>
          Export to CSV
        </Button>
      </PageHeader>

      <DataTable data={sorted} columns={columns} pageSize={10} searchPlaceholder="Search all columns…" />
    </div>
  )
}

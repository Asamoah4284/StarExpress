import * as React from "react"
import { disputes as seedDisputes } from "@/data/disputes.js"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export default function Disputes() {
  const [rows, setRows] = React.useState(() => seedDisputes.map((d) => ({ ...d })))

  const resolve = React.useCallback((id) => {
    setRows((prev) => prev.map((d) => (d.id === id ? { ...d, status: "Resolved" } : d)))
  }, [])

  const columns = React.useMemo(
    () => [
      { accessorKey: "customer", header: "Customer" },
      {
        accessorKey: "issue",
        header: "Issue",
        meta: { cellClassName: "min-w-0 max-w-xl align-top" },
        cell: ({ getValue }) => <span className="break-words">{getValue()}</span>,
      },
      { accessorKey: "date", header: "Date", meta: { cellClassName: "whitespace-nowrap align-top" } },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const v = getValue()
          return <Badge variant={v === "Resolved" ? "success" : "outline"}>{v}</Badge>
        },
      },
      {
        id: "actions",
        accessorFn: () => "",
        header: "Actions",
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { headerClassName: "text-right", cellClassName: "text-right align-top" },
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={row.original.status === "Resolved"}
              onClick={() => resolve(row.original.id)}
            >
              Mark resolved
            </Button>
          </div>
        ),
      },
    ],
    [resolve],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Disputes" description="Customer issues tracked locally (mock)." />

      <DataTable
        data={rows}
        columns={columns}
        searchPlaceholder="Search customer, issue, status…"
        pageSize={8}
        initialSorting={[{ id: "date", desc: true }]}
      />
    </div>
  )
}

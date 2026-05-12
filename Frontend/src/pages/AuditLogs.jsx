import * as React from "react"
import { auditLogs } from "@/data/auditLogs.js"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Badge } from "@/components/ui/badge"

function formatAt(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  } catch {
    return iso
  }
}

/** @param {string} action */
function auditKind(action) {
  const a = action.toLowerCase()
  if (/deactivated|voided/.test(a)) return { variant: "destructive", label: "Revoke" }
  if (/locked reporting/.test(a) || /\blocked\b/.test(a)) return { variant: "destructive", label: "Lock" }
  if (/recorded sale/.test(a)) return { variant: "success", label: "Sale" }
  if (/exported|bulk import/.test(a)) return { variant: "success", label: "Export" }
  if (/resolved/.test(a)) return { variant: "success", label: "Resolve" }
  if (/promoted/.test(a)) return { variant: "success", label: "Role" }
  if (/\bcreated\b|\badded\b/.test(a)) return { variant: "success", label: "Create" }
  return { variant: "outline", label: "Update" }
}

export default function AuditLogs() {
  const sorted = React.useMemo(
    () => [...auditLogs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    [],
  )

  const columns = React.useMemo(
    () => [
      {
        id: "kind",
        accessorFn: (row) => row.action,
        header: "Type",
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { headerClassName: "w-[7.5rem]", cellClassName: "w-[7.5rem] align-top" },
        cell: ({ row }) => {
          const { variant, label } = auditKind(row.original.action)
          return <Badge variant={variant}>{label}</Badge>
        },
      },
      {
        accessorKey: "action",
        header: "Action",
        meta: { cellClassName: "min-w-0 max-w-xl align-top" },
        cell: ({ getValue }) => <span className="break-words">{getValue()}</span>,
      },
      { accessorKey: "actor", header: "Actor", meta: { cellClassName: "whitespace-nowrap align-top" } },
      {
        accessorKey: "at",
        header: "When",
        meta: { headerClassName: "text-right", cellClassName: "text-right whitespace-nowrap align-top" },
        cell: ({ getValue }) => formatAt(getValue()),
      },
    ],
    [],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Audit logs" description="Recent administrative actions (mock)." />

      <DataTable
        data={sorted}
        columns={columns}
        searchPlaceholder="Search action, actor, date…"
        pageSize={12}
        initialSorting={[{ id: "at", desc: true }]}
      />
    </div>
  )
}

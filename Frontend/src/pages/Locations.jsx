import * as React from "react"
import { locations as seedLocations } from "@/data/locations.js"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

let locId = 900

export default function Locations() {
  const [rows, setRows] = React.useState(() => seedLocations.map((l) => ({ ...l })))
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({ name: "", address: "", manager: "", totalSales: "" })

  const reset = () => {
    setForm({ name: "", address: "", manager: "", totalSales: "" })
    setEditing(null)
  }

  const openAdd = () => {
    reset()
    setOpen(true)
  }

  const openEdit = React.useCallback((row) => {
    setEditing(row)
    setForm({
      name: row.name,
      address: row.address,
      manager: row.manager,
      totalSales: String(row.totalSales),
    })
    setOpen(true)
  }, [])

  const save = () => {
    const total = Number(form.totalSales)
    if (!form.name.trim() || Number.isNaN(total)) return
    if (editing) {
      setRows((prev) =>
        prev.map((l) =>
          l.id === editing.id
            ? {
                ...l,
                name: form.name.trim(),
                address: form.address.trim(),
                manager: form.manager.trim(),
                totalSales: total,
              }
            : l,
        ),
      )
    } else {
      locId += 1
      setRows((prev) => [
        ...prev,
        {
          id: `loc-${locId}`,
          name: form.name.trim(),
          address: form.address.trim(),
          manager: form.manager.trim(),
          totalSales: total,
        },
      ])
    }
    setOpen(false)
    reset()
  }

  const columns = React.useMemo(
    () => [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "address", header: "Address" },
      { accessorKey: "manager", header: "Manager" },
      {
        accessorKey: "totalSales",
        header: "Total sales",
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
        cell: ({ getValue }) => Number(getValue()).toLocaleString(),
      },
      {
        id: "actions",
        accessorFn: () => "",
        header: "Actions",
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openEdit(row.original)}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [openEdit],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Locations" description="Retail and partner locations (mock data).">
        <Button type="button" onClick={openAdd}>
          Add location
        </Button>
      </PageHeader>

      <DataTable data={rows} columns={columns} searchPlaceholder="Search name, address, manager…" pageSize={8} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit location" : "Add location"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="loc-name">Location name</Label>
              <Input id="loc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-address">Address</Label>
              <Input
                id="loc-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-manager">Manager</Label>
              <Input
                id="loc-manager"
                value={form.manager}
                onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-total">Total sales (count)</Label>
              <Input
                id="loc-total"
                inputMode="numeric"
                value={form.totalSales}
                onChange={(e) => setForm((f) => ({ ...f, totalSales: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

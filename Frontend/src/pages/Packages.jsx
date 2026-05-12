import * as React from "react"
import { packages as seedPackages } from "@/data/packages.js"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCedis } from "@/lib/utils"

let idCounter = 100

export default function Packages() {
  const [rows, setRows] = React.useState(() => seedPackages.map((p) => ({ ...p })))
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({
    name: "",
    priceGHS: "",
    dataLimit: "",
    status: "Active",
    stockUnits: "",
  })

  const resetForm = () => {
    setForm({ name: "", priceGHS: "", dataLimit: "", status: "Active", stockUnits: "" })
    setEditing(null)
  }

  const openAdd = () => {
    resetForm()
    setOpen(true)
  }

  const openEdit = React.useCallback((row) => {
    setEditing(row)
    setForm({
      name: row.name,
      priceGHS: String(row.priceGHS),
      dataLimit: row.dataLimit,
      status: row.status,
      stockUnits: String(row.stockUnits),
    })
    setOpen(true)
  }, [])

  const remove = React.useCallback((id) => {
    if (!window.confirm("Delete this package? (mock only)")) return
    setRows((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const save = () => {
    const price = Number(form.priceGHS)
    const stock = Number(form.stockUnits)
    if (!form.name.trim() || Number.isNaN(price) || Number.isNaN(stock)) return

    if (editing) {
      setRows((prev) =>
        prev.map((p) =>
          p.id === editing.id
            ? {
                ...p,
                name: form.name.trim(),
                priceGHS: price,
                dataLimit: form.dataLimit.trim(),
                status: form.status,
                stockUnits: stock,
              }
            : p,
        ),
      )
    } else {
      idCounter += 1
      setRows((prev) => [
        ...prev,
        {
          id: `pkg-${idCounter}`,
          name: form.name.trim(),
          priceGHS: price,
          dataLimit: form.dataLimit.trim(),
          status: form.status,
          stockUnits: stock,
        },
      ])
    }
    setOpen(false)
    resetForm()
  }

  const columns = React.useMemo(
    () => [
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "priceGHS",
        header: "Price",
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      { accessorKey: "dataLimit", header: "Data limit" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const v = getValue()
          return <Badge variant={v === "Active" ? "default" : "secondary"}>{v}</Badge>
        },
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
            <Button type="button" size="sm" variant="destructive" onClick={() => remove(row.original.id)}>
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [openEdit, remove],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Packages" description="Starlink package catalog — changes reset on refresh (mock).">
        <Button type="button" onClick={openAdd}>
          Add package
        </Button>
      </PageHeader>

      <DataTable data={rows} columns={columns} searchPlaceholder="Search name, price, data limit, status…" pageSize={8} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit package" : "Add package"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-name">Package name</Label>
              <Input
                id="pkg-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pkg-price">Price (GH₵)</Label>
                <Input
                  id="pkg-price"
                  inputMode="decimal"
                  value={form.priceGHS}
                  onChange={(e) => setForm((f) => ({ ...f, priceGHS: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkg-stock">Stock units</Label>
                <Input
                  id="pkg-stock"
                  inputMode="numeric"
                  value={form.stockUnits}
                  onChange={(e) => setForm((f) => ({ ...f, stockUnits: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-limit">Data limit</Label>
              <Input
                id="pkg-limit"
                value={form.dataLimit}
                onChange={(e) => setForm((f) => ({ ...f, dataLimit: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-status">Status</Label>
              <Input
                id="pkg-status"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                placeholder="Active or Inactive"
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

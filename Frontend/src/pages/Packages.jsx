import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { createCatalogPackage, deleteCatalogPackage, updateCatalogPackage } from "@/lib/api.js"
import { formatCedis } from "@/lib/utils"

export default function Packages() {
  const { token, user } = useAuth()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const rows = catalog.data?.packages ?? []
  const isAdmin = user?.role === "Admin"

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({
    name: "",
    priceGHS: "",
    dataLimit: "",
    status: "Active",
    stockUnits: "",
  })
  const [formError, setFormError] = React.useState(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const price = Number(form.priceGHS)
      const stock = Number(form.stockUnits)
      if (editing) {
        const r = await updateCatalogPackage(token, editing.id, {
          name: form.name.trim(),
          priceGHS: price,
          dataLimit: form.dataLimit.trim(),
          status: form.status,
          stockUnits: stock,
        })
        if (!r.ok) throw new Error(r.error || "Update failed")
      } else {
        const r = await createCatalogPackage(token, {
          name: form.name.trim(),
          priceGHS: price,
          dataLimit: form.dataLimit.trim(),
          status: form.status,
          stockUnits: stock,
        })
        if (!r.ok) throw new Error(r.error || "Create failed")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setOpen(false)
      setEditing(null)
      setForm({ name: "", priceGHS: "", dataLimit: "", status: "Active", stockUnits: "" })
      setFormError(null)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Request failed")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!token) throw new Error("Not signed in")
      const r = await deleteCatalogPackage(token, id)
      if (!r.ok) throw new Error(r.error || "Delete failed")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
    },
  })

  const resetForm = () => {
    setForm({ name: "", priceGHS: "", dataLimit: "", status: "Active", stockUnits: "" })
    setEditing(null)
    setFormError(null)
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
    setFormError(null)
    setOpen(true)
  }, [])

  const remove = React.useCallback(
    (id) => {
      if (!window.confirm("Delete this package?")) return
      deleteMutation.mutate(id)
    },
    [deleteMutation],
  )

  const save = () => {
    setFormError(null)
    if (!isAdmin) {
      setFormError("Only administrators can edit the catalog.")
      return
    }
    const price = Number(form.priceGHS)
    const stock = Number(form.stockUnits)
    if (!form.name.trim() || Number.isNaN(price) || Number.isNaN(stock)) {
      setFormError("Valid name, price, and stock are required.")
      return
    }
    saveMutation.mutate()
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
            <Button type="button" size="sm" variant="outline" disabled={!isAdmin} onClick={() => openEdit(row.original)}>
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!isAdmin || deleteMutation.isPending}
              onClick={() => remove(row.original.id)}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [openEdit, remove, isAdmin, deleteMutation.isPending],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Packages" description="Starlink package catalog stored in MongoDB.">
        <Button type="button" onClick={openAdd} disabled={!isAdmin}>
          Add package
        </Button>
      </PageHeader>

      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}
      {deleteMutation.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
        </p>
      ) : null}

      <DataTable data={rows} columns={columns} searchPlaceholder="Search name, price, data limit, status…" pageSize={8} />

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) resetForm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit package" : "Add package"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {formError ? (
              <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
                {formError}
              </p>
            ) : null}
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
            <Button type="button" onClick={save} disabled={!isAdmin || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

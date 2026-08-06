import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { createCatalogLocation, deleteCatalogLocation, updateCatalogLocation } from "@/lib/api.js"

export default function Locations() {
  const { token, user } = useAuth()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const locations = catalog.data?.locations
  const rows = React.useMemo(() => locations ?? [], [locations])
  const isAdmin = user?.role === "Admin"

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({
    name: "",
    address: "",
    meterNumber: "",
    totalSales: "",
    managerPayoutNumber: "",
  })
  const emptyForm = () => ({
    name: "",
    address: "",
    meterNumber: "",
    totalSales: "",
    managerPayoutNumber: "",
  })
  const [formError, setFormError] = React.useState(null)
  const [deleteTarget, setDeleteTarget] = React.useState(/** @type {{ id: string, name: string } | null} */ (null))

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const total = Number(form.totalSales)
      if (editing) {
        const r = await updateCatalogLocation(token, editing.id, {
          name: form.name.trim(),
          address: form.address.trim(),
          totalSales: total,
          managerPayoutNumber: form.managerPayoutNumber.trim(),
          meterNumber: form.meterNumber.trim(),
        })
        if (!r.ok) throw new Error(r.error || "Update failed")
      } else {
        const r = await createCatalogLocation(token, {
          name: form.name.trim(),
          address: form.address.trim(),
          manager: "—",
          totalSales: total,
          managerPayoutNumber: form.managerPayoutNumber.trim(),
          meterNumber: form.meterNumber.trim(),
        })
        if (!r.ok) throw new Error(r.error || "Create failed")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm())
      setFormError(null)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Request failed")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!token) throw new Error("Not signed in")
      const r = await deleteCatalogLocation(token, id)
      if (!r.ok) throw new Error(r.error || "Delete failed")
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setDeleteTarget(null)
      setEditing((e) => {
        if (e?.id === deletedId) {
          setOpen(false)
          setForm(emptyForm())
          setFormError(null)
          return null
        }
        return e
      })
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Delete failed")
    },
  })

  const requestDelete = React.useCallback((row) => {
    setDeleteTarget({ id: row.id, name: row.name })
    setFormError(null)
  }, [])

  const reset = () => {
    setForm(emptyForm())
    setEditing(null)
    setFormError(null)
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
      meterNumber: String(row.meterNumber ?? ""),
      totalSales: String(row.totalSales),
      managerPayoutNumber: String(row.managerPayoutNumber ?? ""),
    })
    setFormError(null)
    setOpen(true)
  }, [])

  const save = () => {
    setFormError(null)
    const total = Number(form.totalSales)
    if (!form.name.trim() || Number.isNaN(total)) {
      setFormError("Name and a numeric total sales count are required.")
      return
    }
    if (!isAdmin) {
      setFormError("Only administrators can change locations.")
      return
    }
    saveMutation.mutate()
  }

  const columns = React.useMemo(
    () => [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "address", header: "Address" },
      {
        accessorKey: "meterNumber",
        header: "Meter",
        cell: ({ getValue }) => {
          const v = String(getValue() ?? "").trim()
          return v || "—"
        },
      },
      {
        accessorKey: "managerPayoutNumber",
        header: "Payout number",
        cell: ({ getValue }) => {
          const v = String(getValue() ?? "").trim()
          return v || "—"
        },
      },
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!isAdmin}
              onClick={() => openEdit(row.original)}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive shrink-0"
              disabled={!isAdmin || deleteMutation.isPending}
              aria-label={`Delete location ${row.original.name}`}
              title="Delete location"
              onClick={() => requestDelete(row.original)}
            >
              <Trash2 className="size-4 stroke-[1.5]" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    [openEdit, requestDelete, isAdmin, deleteMutation.isPending],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Locations" description="Retail and partner locations from the API.">
        <Button type="button" onClick={openAdd} disabled={!isAdmin}>
          Add location
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

      <DataTable
        data={rows}
        columns={columns}
        searchPlaceholder="Search name, address, meter, payout…"
        pageSize={8}
      />

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete location?</DialogTitle>
            <DialogDescription>
              This permanently removes{" "}
              <span className="text-foreground font-medium">{deleteTarget?.name}</span> from the catalog. Packages
              and vouchers at this location may need cleanup separately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit location" : "Add location"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {formError ? (
              <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
                {formError}
              </p>
            ) : null}
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
              <Label htmlFor="loc-meter">Assigned meter</Label>
              <Input
                id="loc-meter"
                autoComplete="off"
                placeholder="e.g. ECG meter / prepaid number"
                value={form.meterNumber}
                onChange={(e) => setForm((f) => ({ ...f, meterNumber: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">Meter number for this wifi location.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-payout">Hostel manager payout number</Label>
              <Input
                id="loc-payout"
                inputMode="tel"
                autoComplete="tel"
                placeholder="e.g. 0241234567"
                value={form.managerPayoutNumber}
                onChange={(e) => setForm((f) => ({ ...f, managerPayoutNumber: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">
                MoMo / phone number used when paying the hostel manager for this location.
              </p>
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
            <Button type="button" onClick={save} disabled={!isAdmin || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

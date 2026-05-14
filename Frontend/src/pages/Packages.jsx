import * as React from "react"
import { Trash2 } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import {
  createCatalogPackage,
  createCatalogSale,
  deleteCatalogPackage,
  updateCatalogPackage,
} from "@/lib/api.js"
import { findAgentStoreLocation } from "@/lib/agentLocation.js"
import { ROLE_ADMIN, ROLE_SALES_AGENT } from "@/lib/roles.js"
import { formatCedis } from "@/lib/utils"

export default function Packages() {
  const { token, user } = useAuth()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const rows = catalog.data?.packages ?? []
  const rawLocations = catalog.data?.locations
  const locations = React.useMemo(() => rawLocations ?? [], [rawLocations])
  const isAdmin = user?.role === ROLE_ADMIN
  const isSalesAgent = user?.role === ROLE_SALES_AGENT
  const canSell = isAdmin || isSalesAgent

  const agentStore = React.useMemo(() => findAgentStoreLocation(locations, user), [locations, user])

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

  const [sellOpen, setSellOpen] = React.useState(false)
  const [sellPkg, setSellPkg] = React.useState(
    /** @type {{ id: string, name: string, priceGHS: number, dataLimit: string, status: string, stockUnits: number } | null} */ (null),
  )
  const [sellCustomer, setSellCustomer] = React.useState("")
  const [sellCustomerPhone, setSellCustomerPhone] = React.useState("")
  const [sellPaymentNumber, setSellPaymentNumber] = React.useState("")
  const [sellLocationId, setSellLocationId] = React.useState("")
  const [sellError, setSellError] = React.useState(null)

  const sellRowRef = React.useRef(
    /** @type {{ id: string, name: string, priceGHS: number, dataLimit: string, status: string, stockUnits: number } | null} */ (null),
  )

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

  const sellPhoneValid = React.useMemo(() => {
    const t = sellCustomerPhone.trim().replace(/\s+/g, " ")
    if (t.length < 7 || t.length > 32) return false
    return t.replace(/\D/g, "").length >= 7
  }, [sellCustomerPhone])

  const sellPaymentValid = React.useMemo(() => {
    const t = sellPaymentNumber.trim()
    return t.length >= 2 && t.length <= 64
  }, [sellPaymentNumber])

  const sellMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const row = sellRowRef.current
      if (!row) throw new Error("No package selected")
      const customerName = sellCustomer.trim()
      const customerPhone = sellCustomerPhone.trim().replace(/\s+/g, " ")
      const paymentNumber = sellPaymentNumber.trim()
      if (customerName.length < 2) throw new Error("Customer name must be at least 2 characters.")
      if (customerPhone.length < 7 || customerPhone.length > 32) {
        throw new Error("Customer phone must be between 7 and 32 characters.")
      }
      if (customerPhone.replace(/\D/g, "").length < 7) {
        throw new Error("Customer phone must include at least 7 digits.")
      }
      if (paymentNumber.length < 2 || paymentNumber.length > 64) {
        throw new Error("Payment number must be between 2 and 64 characters.")
      }
      if (isAdmin) {
        if (!sellLocationId) throw new Error("Choose a store location for this sale.")
        const r = await createCatalogSale(token, {
          packageId: row.id,
          customerName,
          customerPhone,
          paymentNumber,
          locationId: sellLocationId,
        })
        if (!r.ok) throw new Error(r.error || "Sale failed")
        return
      }
      if (!agentStore) {
        throw new Error(
          "No store is linked to your account. Ask an administrator to assign you to a location.",
        )
      }
      const r = await createCatalogSale(token, {
        packageId: row.id,
        customerName,
        customerPhone,
        paymentNumber,
      })
      if (!r.ok) throw new Error(r.error || "Sale failed")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setSellOpen(false)
      sellRowRef.current = null
      setSellPkg(null)
      setSellCustomer("")
      setSellCustomerPhone("")
      setSellPaymentNumber("")
      setSellLocationId(locations[0]?.id ?? "")
      setSellError(null)
    },
    onError: (err) => {
      setSellError(err instanceof Error ? err.message : "Request failed")
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

  const openSell = React.useCallback(
    (row) => {
      sellRowRef.current = row
      setSellPkg(row)
      setSellCustomer("")
      setSellCustomerPhone("")
      setSellPaymentNumber("")
      setSellLocationId(locations[0]?.id ?? "")
      setSellError(null)
      setSellOpen(true)
    },
    [locations],
  )

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

  const confirmSell = () => {
    setSellError(null)
    sellMutation.mutate()
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
        cell: ({ row }) => {
          const pkg = row.original
          const canSellThis = pkg.status === "Active" && pkg.stockUnits > 0
          const agentBlocked = isSalesAgent && !agentStore

          return (
            <div className="flex flex-wrap justify-end gap-2">
              {canSell ? (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={!canSellThis || sellMutation.isPending || (isSalesAgent && agentBlocked)}
                  onClick={() => openSell(pkg)}
                >
                  Sell
                </Button>
              ) : null}
              {isAdmin ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => openEdit(pkg)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="size-8 shrink-0"
                    disabled={deleteMutation.isPending}
                    onClick={() => remove(pkg.id)}
                    aria-label="Delete package"
                    title="Delete package"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </>
              ) : null}
            </div>
          )
        },
      },
    ],
    [
      isAdmin,
      canSell,
      isSalesAgent,
      agentStore,
      openEdit,
      openSell,
      remove,
      deleteMutation.isPending,
      sellMutation.isPending,
    ],
  )

  const pageDescription = isAdmin
    ? "Starlink package catalog stored in MongoDB."
    : "Choose a package, tap Sell, and enter the customer name to record a sale for your store."

  return (
    <div className="space-y-6">
      <PageHeader title="Packages" description={pageDescription}>
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
      {isSalesAgent && !agentStore ? (
        <p className="text-amber-800 dark:text-amber-200 bg-amber-500/15 rounded-md px-3 py-2 text-sm" role="status">
          You are not linked to a store location yet. Sales stay disabled until an administrator assigns you.
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

      <Dialog
        open={sellOpen}
        onOpenChange={(o) => {
          setSellOpen(o)
          if (!o) {
            sellRowRef.current = null
            setSellPkg(null)
            setSellCustomer("")
            setSellCustomerPhone("")
            setSellPaymentNumber("")
            setSellError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record sale</DialogTitle>
          </DialogHeader>
          {sellPkg ? (
            <div className="grid gap-3 py-2">
              {sellError ? (
                <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
                  {sellError}
                </p>
              ) : null}
              <div className="bg-muted/50 space-y-1 rounded-md border px-3 py-2 text-sm">
                <p className="font-medium">{sellPkg.name}</p>
                <p className="text-muted-foreground">
                  {formatCedis(sellPkg.priceGHS)} · {sellPkg.dataLimit} · Stock: {sellPkg.stockUnits}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sell-customer">Customer name</Label>
                <Input
                  id="sell-customer"
                  value={sellCustomer}
                  onChange={(e) => setSellCustomer(e.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sell-phone">Customer phone</Label>
                <Input
                  id="sell-phone"
                  type="tel"
                  inputMode="tel"
                  value={sellCustomerPhone}
                  onChange={(e) => setSellCustomerPhone(e.target.value)}
                  placeholder="e.g. 0241234567"
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sell-payment">Payment number</Label>
                <Input
                  id="sell-payment"
                  value={sellPaymentNumber}
                  onChange={(e) => setSellPaymentNumber(e.target.value)}
                  placeholder="Transaction / reference ID"
                  autoComplete="off"
                />
              </div>
              {isAdmin ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sell-location">Store location</Label>
                  {locations.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No locations in the catalog. Add a store first.</p>
                  ) : (
                    <Select value={sellLocationId} onValueChange={setSellLocationId}>
                      <SelectTrigger id="sell-location" className="w-full">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Your store</Label>
                  <p className="text-muted-foreground text-sm">
                    {agentStore ? `${agentStore.name} (${agentStore.address})` : "—"}
                  </p>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSellOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmSell}
              disabled={
                sellMutation.isPending ||
                sellCustomer.trim().length < 2 ||
                !sellPhoneValid ||
                !sellPaymentValid ||
                (isAdmin && (!sellLocationId || locations.length === 0)) ||
                (isSalesAgent && !agentStore)
              }
            >
              {sellMutation.isPending ? "Recording…" : "Confirm sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

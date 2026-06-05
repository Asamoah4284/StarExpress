import * as React from "react"
import { Trash2 } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  deleteCatalogPackage,
  fetchAgentSalePaymentStatus,
  fetchPackageStock,
  fetchPackageVoucherInventory,
  initiateAgentSalePayment,
  updateCatalogPackage,
} from "@/lib/api.js"
import { findAgentStoreLocation } from "@/lib/agentLocation.js"
import { ROLE_ADMIN, ROLE_SALES_AGENT } from "@/lib/roles.js"
import { formatCedis } from "@/lib/utils"

const PAYMENT_POLL_INTERVAL_MS = 3000
const PAYMENT_POLL_TIMEOUT_MS = 3 * 60 * 1000

export default function Packages() {
  const { token, user } = useAuth()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const allPackages = catalog.data?.packages ?? []
  const rawLocations = catalog.data?.locations
  const locations = React.useMemo(() => rawLocations ?? [], [rawLocations])
  const isAdmin = user?.role === ROLE_ADMIN
  const isSalesAgent = user?.role === ROLE_SALES_AGENT
  const canSell = isAdmin || isSalesAgent

  const agentStore = React.useMemo(() => findAgentStoreLocation(locations, user), [locations, user])

  const [locationFilterId, setLocationFilterId] = React.useState("all")

  const viewingAllLocations = isAdmin && locationFilterId === "all"

  const inventoryLocationId = React.useMemo(() => {
    if (isSalesAgent) return agentStore?.id ?? ""
    if (locationFilterId === "all") return ""
    return locationFilterId
  }, [isSalesAgent, agentStore?.id, locationFilterId])

  const inventoryFromCatalog =
    isAdmin && locationFilterId === "all" && Array.isArray(catalog.data?.packageVoucherInventory)

  const locationFilterLabel =
    locationFilterId === "all"
      ? "All locations"
      : (locations.find((l) => l.id === locationFilterId)?.name ?? locationFilterId)

  const scopedLocationLabel = isSalesAgent
    ? (agentStore?.name ?? "your wifi location")
    : locationFilterLabel

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({
    name: "",
    priceGHS: "",
    dataLimit: "",
    status: "Active",
  })
  const [formError, setFormError] = React.useState(null)

  const [sellOpen, setSellOpen] = React.useState(false)
  const [sellPkg, setSellPkg] = React.useState(
    /** @type {{ id: string, name: string, priceGHS: number, dataLimit: string, status: string, stockUnits: number } | null} */ (null),
  )
  const [sellCustomerPhone, setSellCustomerPhone] = React.useState("")
  const [sellLocationId, setSellLocationId] = React.useState("")
  const [sellError, setSellError] = React.useState(null)
  const [sellSuccess, setSellSuccess] = React.useState(/** @type {string | null} */ (null))
  const [sellAwaitingPayment, setSellAwaitingPayment] = React.useState(false)
  const [sellPaymentRef, setSellPaymentRef] = React.useState(/** @type {string | null} */ (null))
  const sellPaymentStartedAtRef = React.useRef(/** @type {number | null} */ (null))

  const sellRowRef = React.useRef(
    /** @type {{ id: string, name: string, priceGHS: number, dataLimit: string, status: string, stockUnits: number } | null} */ (null),
  )

  const [saveSuccess, setSaveSuccess] = React.useState(/** @type {string | null} */ (null))

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const price = Number(form.priceGHS)
      if (editing) {
        const editLocationId =
          isAdmin && locationFilterId !== "all" ? locationFilterId : ""
        const r = await updateCatalogPackage(
          token,
          editing.id,
          {
            name: form.name.trim(),
            priceGHS: price,
            dataLimit: form.dataLimit.trim(),
            status: form.status,
          },
          editLocationId ? { locationId: editLocationId } : undefined,
        )
        if (!r.ok) throw new Error(r.error || "Update failed")
        return { mode: /** @type {"edit"} */ ("edit"), forked: Boolean(r.forked) }
      }
      const r = await createCatalogPackage(token, {
        name: form.name.trim(),
        priceGHS: price,
        dataLimit: form.dataLimit.trim(),
        status: form.status,
      })
      if (!r.ok) throw new Error(r.error || "Create failed")
      return { mode: /** @type {"create"} */ ("create"), forked: false }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
      setOpen(false)
      setEditing(null)
      setForm({ name: "", priceGHS: "", dataLimit: "", status: "Active" })
      setFormError(null)
      if (result?.mode === "edit" && result.forked) {
        setSaveSuccess(
          `Changes applied to ${locationFilterLabel} only. A separate package copy was created for this hostel; other hostels keep the original.`,
        )
      } else {
        setSaveSuccess(null)
      }
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
      queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
    },
  })

  const packageInventoryQuery = useQuery({
    queryKey: ["package-voucher-inventory", token, inventoryLocationId],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchPackageVoucherInventory(
        token,
        inventoryLocationId ? { locationId: inventoryLocationId } : {},
      )
      if (!r.ok) throw new Error(r.error || "Failed to load voucher inventory")
      return r.packages
    },
    enabled:
      Boolean(token) && !inventoryFromCatalog && (isAdmin || Boolean(inventoryLocationId)),
    staleTime: 30_000,
  })

  const inventoryByPackageId = React.useMemo(() => {
    const map = new Map()
    const rows = inventoryFromCatalog
      ? (catalog.data?.packageVoucherInventory ?? [])
      : (packageInventoryQuery.data ?? [])
    for (const row of rows) {
      if (row && typeof row.id === "string") {
        map.set(row.id, {
          total: typeof row.total === "number" ? row.total : typeof row.count === "number" ? row.count : 0,
          remaining: typeof row.remaining === "number" ? row.remaining : 0,
        })
      }
    }
    return map
  }, [catalog.data?.packageVoucherInventory, packageInventoryQuery.data, inventoryFromCatalog])

  const inventoryLoading = inventoryFromCatalog
    ? catalog.isLoading
    : catalog.isLoading || packageInventoryQuery.isLoading
  const inventoryError = catalog.error ?? packageInventoryQuery.error

  /** Single-location view: only packages with vouchers at that site. All locations: full catalog. */
  const scopedToSingleLocation =
    !viewingAllLocations &&
    ((isAdmin && locationFilterId !== "all") || (isSalesAgent && Boolean(inventoryLocationId)))

  const tableRows = React.useMemo(() => {
    if (viewingAllLocations) return allPackages
    if (!scopedToSingleLocation) return allPackages
    if (inventoryLoading) return []
    return allPackages.filter((pkg) => inventoryByPackageId.has(pkg.id))
  }, [allPackages, viewingAllLocations, scopedToSingleLocation, inventoryLoading, inventoryByPackageId])

  const sellPhoneValid = React.useMemo(() => {
    const t = sellCustomerPhone.trim().replace(/\s+/g, " ")
    if (t.length < 7 || t.length > 32) return false
    return t.replace(/\D/g, "").length >= 7
  }, [sellCustomerPhone])

  const sellStockLocationId = isAdmin ? sellLocationId : (agentStore?.id ?? "")

  const sellStockQuery = useQuery({
    queryKey: ["package-stock", token, sellPkg?.id, sellStockLocationId],
    queryFn: async () => {
      if (!token || !sellPkg?.id || !sellStockLocationId) throw new Error("Missing package or location")
      const r = await fetchPackageStock(token, {
        packageId: sellPkg.id,
        locationId: sellStockLocationId,
      })
      if (!r.ok) throw new Error(r.error || "Failed to load stock")
      return r.remaining
    },
    enabled: sellOpen && Boolean(token) && Boolean(sellPkg?.id) && Boolean(sellStockLocationId),
    staleTime: 10_000,
  })

  const sellStockRemaining = sellStockQuery.data
  const sellStockLabel = !sellStockLocationId
    ? "—"
    : sellStockQuery.isLoading
      ? "…"
      : sellStockQuery.isError
        ? "—"
        : String(sellStockRemaining ?? 0)

  const invalidateSaleQueries = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["catalog"] })
    queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
    queryClient.invalidateQueries({ queryKey: ["package-stock"] })
    queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
    queryClient.invalidateQueries({ queryKey: ["vouchers"] })
    queryClient.invalidateQueries({ queryKey: ["vouchers-summary"] })
    queryClient.invalidateQueries({ queryKey: ["voucher-stats"] })
  }, [queryClient])

  const completeAgentSale = React.useCallback(
    (/** @type {{ voucherCode?: string, smsSent?: boolean }} */ result) => {
      invalidateSaleQueries()
      const code = result.voucherCode
      setSellSuccess(
        code
          ? result.smsSent
            ? `Payment received. Voucher ${code} was sent by SMS to the customer.`
            : `Payment received. Voucher ${code} was issued but SMS delivery may have failed — check with the customer.`
          : "Payment received and sale completed.",
      )
      setSellAwaitingPayment(false)
      setSellPaymentRef(null)
      sellPaymentStartedAtRef.current = null
      setSellOpen(false)
      sellRowRef.current = null
      setSellPkg(null)
      setSellCustomerPhone("")
      setSellLocationId(locations[0]?.id ?? "")
      setSellError(null)
    },
    [invalidateSaleQueries, locations],
  )

  const sellMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const row = sellRowRef.current
      if (!row) throw new Error("No package selected")
      const customerPhone = sellCustomerPhone.trim().replace(/\s+/g, " ")
      if (customerPhone.length < 7 || customerPhone.length > 32) {
        throw new Error("Customer phone must be between 7 and 32 characters.")
      }
      if (customerPhone.replace(/\D/g, "").length < 7) {
        throw new Error("Customer phone must include at least 7 digits.")
      }
      let result
      if (isAdmin) {
        if (!sellLocationId) throw new Error("Choose a wifi location for this sale.")
        result = await initiateAgentSalePayment(token, {
          packageId: row.id,
          customerPhone,
          locationId: sellLocationId,
        })
      } else {
        if (!agentStore) {
          throw new Error(
            "No wifi location is linked to your account. Ask an administrator to assign you to a location.",
          )
        }
        result = await initiateAgentSalePayment(token, {
          packageId: row.id,
          customerPhone,
        })
      }
      if (!result.ok) throw new Error(result.error || "Could not send payment prompt")
      return result
    },
    onSuccess: (result) => {
      setSellAwaitingPayment(true)
      setSellPaymentRef(result.paymentReference)
      sellPaymentStartedAtRef.current = Date.now()
      setSellError(null)
    },
    onError: (err) => {
      setSellError(err instanceof Error ? err.message : "Request failed")
    },
  })

  React.useEffect(() => {
    if (!sellAwaitingPayment || !sellPaymentRef || !token) return

    let cancelled = false

    const poll = async () => {
      if (cancelled) return
      const startedAt = sellPaymentStartedAtRef.current ?? Date.now()
      if (Date.now() - startedAt > PAYMENT_POLL_TIMEOUT_MS) {
        setSellAwaitingPayment(false)
        setSellPaymentRef(null)
        sellPaymentStartedAtRef.current = null
        setSellError("Payment timed out. Ask the customer to try again or check their MoMo wallet.")
        return
      }

      const status = await fetchAgentSalePaymentStatus(token, sellPaymentRef)
      if (cancelled) return

      if (!status.ok) {
        setSellError(status.error || "Could not check payment status")
        return
      }

      if (status.status === "completed") {
        completeAgentSale({
          voucherCode: status.voucherCode ?? status.sale?.voucherCode,
          smsSent: status.smsSent,
        })
        return
      }

      if (status.status === "failed") {
        setSellAwaitingPayment(false)
        setSellPaymentRef(null)
        sellPaymentStartedAtRef.current = null
        setSellError(status.message || "Payment was not completed.")
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, PAYMENT_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sellAwaitingPayment, sellPaymentRef, token, completeAgentSale])

  const resetForm = () => {
    setForm({ name: "", priceGHS: "", dataLimit: "", status: "Active" })
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
    })
    setFormError(null)
    setOpen(true)
  }, [])

  const openSell = React.useCallback(
    (row) => {
      sellRowRef.current = row
      setSellPkg(row)
      setSellCustomerPhone("")
      const defaultLoc =
        isAdmin && locationFilterId !== "all"
          ? locationFilterId
          : (locations[0]?.id ?? "")
      setSellLocationId(defaultLoc)
      setSellError(null)
      setSellSuccess(null)
      setSellAwaitingPayment(false)
      setSellPaymentRef(null)
      sellPaymentStartedAtRef.current = null
      setSellOpen(true)
    },
    [locations, isAdmin, locationFilterId],
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
    if (!form.name.trim() || Number.isNaN(price)) {
      setFormError("Valid name and price are required.")
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
        id: "voucherTotal",
        accessorFn: (row) => inventoryByPackageId.get(row.id)?.total ?? null,
        header: "Total vouchers",
        cell: ({ getValue }) => {
          const v = getValue()
          if (inventoryLoading) return <span className="text-muted-foreground tabular-nums">…</span>
          if (inventoryError) return <span className="text-muted-foreground">—</span>
          if (v == null) return <span className="text-muted-foreground tabular-nums">—</span>
          return <span className="tabular-nums">{Number(v).toLocaleString()}</span>
        },
      },
      {
        id: "voucherRemaining",
        accessorFn: (row) => inventoryByPackageId.get(row.id)?.remaining ?? null,
        header: "Remaining",
        cell: ({ getValue }) => {
          const v = getValue()
          if (inventoryLoading) return <span className="text-muted-foreground tabular-nums">…</span>
          if (inventoryError) return <span className="text-muted-foreground">—</span>
          if (v == null) return <span className="text-muted-foreground tabular-nums">—</span>
          const n = v == null ? 0 : Number(v)
          return (
            <span className={n === 0 ? "text-destructive font-medium tabular-nums" : "tabular-nums"}>
              {n.toLocaleString()}
            </span>
          )
        },
      },
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
          const inv = inventoryByPackageId.get(pkg.id)
          const remaining = inv?.remaining ?? (inventoryLoading ? 1 : 0)
          const canSellThis = pkg.status === "Active" && remaining > 0
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
      inventoryByPackageId,
      inventoryLoading,
      inventoryError,
    ],
  )

  const pageDescription = isAdmin
    ? locationFilterId === "all"
      ? "Package catalog with live voucher inventory (total uploaded and remaining unused across all wifi locations)."
      : `Voucher totals and remaining stock at ${locationFilterLabel}. Tap Sell to send a MoMo payment prompt to the customer.`
    : "Packages at your wifi location with voucher totals and remaining stock. Tap Sell to send a MoMo payment prompt to the customer."

  return (
    <div className="space-y-6">
      <PageHeader title="Packages" description={pageDescription}>
        <Button type="button" onClick={openAdd} disabled={!isAdmin}>
          Add package
        </Button>
      </PageHeader>

      {sellSuccess ? (
        <p className="text-foreground bg-primary/10 border-primary/25 rounded-md border px-3 py-2 text-sm" role="status">
          {sellSuccess}
        </p>
      ) : null}

      {saveSuccess ? (
        <div
          className="text-foreground bg-primary/10 border-primary/25 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          role="status"
        >
          <span>{saveSuccess}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline"
            onClick={() => setSaveSuccess(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

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
          You are not linked to a WIfi location yet. Sales stay disabled until an administrator assigns you.
        </p>
      ) : null}

      {inventoryError ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {inventoryError instanceof Error ? inventoryError.message : "Could not load voucher counts."}
        </p>
      ) : null}

      {isAdmin ? (
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>
              Choose a location to show only packages with vouchers at that site. Totals and remaining stock are
              scoped to that location.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="packages-location-filter">Location</Label>
              <Select value={locationFilterId} onValueChange={setLocationFilterId}>
                <SelectTrigger id="packages-location-filter" className="w-full shadow-none">
                  <SelectValue placeholder="All locations" />
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
            <p className="text-muted-foreground text-sm">
              {viewingAllLocations ? (
                <>
                  Showing all <span className="text-foreground font-medium">{allPackages.length}</span>{" "}
                  package{allPackages.length === 1 ? "" : "s"} with combined inventory across{" "}
                  <span className="text-foreground font-medium">{locationFilterLabel}</span>
                </>
              ) : inventoryLoading ? (
                <>Loading packages for {locationFilterLabel}…</>
              ) : (
                <>
                  Showing{" "}
                  <span className="text-foreground font-medium">{tableRows.length}</span> package
                  {tableRows.length === 1 ? "" : "s"} at{" "}
                  <span className="text-foreground font-medium">{locationFilterLabel}</span>
                </>
              )}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {scopedToSingleLocation && !inventoryLoading && !inventoryError && tableRows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
          No packages with vouchers at {scopedLocationLabel}. Upload vouchers for this location to list them here.
        </p>
      ) : null}

      <DataTable
        data={tableRows}
        columns={columns}
        searchPlaceholder="Search name, price, data limit, status, vouchers…"
        pageSize={8}
      />

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
            {editing && isAdmin && locationFilterId !== "all" ? (
              <p
                className="bg-primary/10 text-foreground border-primary/25 rounded-md border px-2 py-1.5 text-xs"
                role="status"
              >
                Saving for <span className="font-medium">{locationFilterLabel}</span> only.
                If this package is also used at other hostels, a separate copy is created for this
                hostel and its vouchers/sales are moved onto it — other hostels keep the original.
              </p>
            ) : editing ? (
              <p
                className="bg-muted/60 text-muted-foreground rounded-md border px-2 py-1.5 text-xs"
                role="status"
              >
                Editing the global package — applies to every hostel still sharing this package.
                To change only one hostel, filter to that hostel first.
              </p>
            ) : null}
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
            <div className="space-y-1.5">
              <Label htmlFor="pkg-price">Price (GH₵)</Label>
              <Input
                id="pkg-price"
                inputMode="decimal"
                value={form.priceGHS}
                onChange={(e) => setForm((f) => ({ ...f, priceGHS: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">
                Remaining stock is calculated from uploaded vouchers, not entered here.
              </p>
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
            setSellCustomerPhone("")
            setSellError(null)
            setSellSuccess(null)
            setSellAwaitingPayment(false)
            setSellPaymentRef(null)
            sellPaymentStartedAtRef.current = null
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record sale</DialogTitle>
          </DialogHeader>
          {sellPkg ? (
            <div className="grid gap-3 py-2">
              {sellAwaitingPayment ? (
                <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm" role="status">
                  Payment prompt sent to <span className="font-medium">{sellCustomerPhone}</span>. Ask the
                  customer to approve the MoMo charge and enter their PIN on their phone. The voucher will be
                  sent by SMS after payment.
                </p>
              ) : null}
              {sellError ? (
                <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
                  {sellError}
                </p>
              ) : null}
              <div className="bg-muted/50 space-y-1 rounded-md border px-3 py-2 text-sm">
                <p className="font-medium">{sellPkg.name}</p>
                <p className="text-muted-foreground">
                  {formatCedis(sellPkg.priceGHS)} · {sellPkg.dataLimit} · Stock: {sellStockLabel}
                  {sellStockQuery.isError ? (
                    <span className="text-destructive"> (could not load stock)</span>
                  ) : null}
                </p>
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
                  disabled={sellAwaitingPayment || sellMutation.isPending}
                />
              </div>
              {isAdmin ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sell-location">Wifi location</Label>
                  {locations.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No wifi locations in the catalog. Add one first.</p>
                  ) : (
                    <Select value={sellLocationId} onValueChange={setSellLocationId}>
                      <SelectTrigger id="sell-location" className="w-full">
                        <SelectValue placeholder="Select wifi location" />
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
                  <Label>Wifi location</Label>
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
                sellAwaitingPayment ||
                sellMutation.isPending ||
                !sellPhoneValid ||
                (isAdmin && (!sellLocationId || locations.length === 0)) ||
                (isSalesAgent && !agentStore) ||
                !sellStockLocationId ||
                sellStockQuery.isLoading ||
                sellStockQuery.isError ||
                sellStockRemaining === 0
              }
            >
              {sellAwaitingPayment
                ? "Waiting for payment…"
                : sellMutation.isPending
                  ? "Sending payment prompt…"
                  : "Confirm sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

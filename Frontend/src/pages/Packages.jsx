import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  MapPin,
  Pause,
  Play,
  Trash2,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { MoolrePayment } from "@/components/payments/MoolrePayment.jsx"
import {
  createCatalogPackage,
  createCatalogSale,
  createCatalogSaleWithPaymentRetry,
  deleteCatalogPackage,
  fetchPackageStock,
  fetchPackageVoucherInventory,
  initializeAgentMoolrePayment,
  updateCatalogPackage,
} from "@/lib/api.js"
import { findAgentStoreLocation } from "@/lib/agentLocation.js"
import { ROLE_ADMIN, ROLE_SALES_AGENT } from "@/lib/roles.js"
import { formatCedis } from "@/lib/utils"

function PackageStatusBadge({ status }) {
  switch (status) {
    case "Active":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap"
        >
          <span className="size-1.5 rounded-full bg-emerald-500 inline-block mr-1.5 animate-pulse" aria-hidden />
          Active
        </Badge>
      )
    case "Paused":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium whitespace-nowrap"
        >
          <Pause className="size-3 mr-1 inline" aria-hidden />
          Paused
        </Badge>
      )
    case "Suspended":
      return (
        <Badge
          variant="outline"
          className="border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400 font-medium whitespace-nowrap"
        >
          <Ban className="size-3 mr-1 inline" aria-hidden />
          Suspended
        </Badge>
      )
    case "Inactive":
    default:
      return (
        <Badge
          variant="secondary"
          className="text-muted-foreground font-normal whitespace-nowrap"
        >
          <span className="size-1.5 rounded-full bg-muted-foreground/40 inline-block mr-1.5" aria-hidden />
          {status || "Inactive"}
        </Badge>
      )
  }
}

export default function Packages() {
  const navigate = useNavigate()
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

  const [locationFilterId, setLocationFilterId] = React.useState("")

  React.useEffect(() => {
    if (locations.length === 0) return
    if (!locationFilterId || !locations.some((l) => l.id === locationFilterId)) {
      setLocationFilterId(locations[0].id)
    }
  }, [locations, locationFilterId])

  const viewingAllLocations = false

  const inventoryLocationId = React.useMemo(() => {
    if (isSalesAgent) return agentStore?.id ?? ""
    return locationFilterId || locations[0]?.id || ""
  }, [isSalesAgent, agentStore?.id, locationFilterId, locations])

  const inventoryFromCatalog = false

  const activeLocation = React.useMemo(
    () => locations.find((l) => l.id === locationFilterId) ?? locations[0] ?? null,
    [locations, locationFilterId],
  )

  const locationFilterLabel = activeLocation?.name ?? locationFilterId

  const scopedLocationLabel = isSalesAgent
    ? (agentStore?.name ?? "your wifi location")
    : locationFilterLabel

  const emptyPackageForm = () => ({
    name: "",
    description: "",
    priceGHS: "",
    dataLimit: "",
    status: "Active",
    sessionHours: "",
    dataCapGb: "",
    uploadSpeed: "",
    downloadSpeed: "",
  })

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState(emptyPackageForm)
  const [formError, setFormError] = React.useState(null)

  const [sellOpen, setSellOpen] = React.useState(false)
  const [sellPkg, setSellPkg] = React.useState(
    /** @type {{ id: string, name: string, priceGHS: number, dataLimit: string, status: string, stockUnits: number } | null} */ (null),
  )
  const [sellCustomerPhone, setSellCustomerPhone] = React.useState("")
  const [sellLocationId, setSellLocationId] = React.useState("")
  const [sellError, setSellError] = React.useState(null)
  const [sellSuccess, setSellSuccess] = React.useState(/** @type {string | null} */ (null))
  const [soldVoucherCode, setSoldVoucherCode] = React.useState(/** @type {string | null} */ (null))
  const [voucherCopied, setVoucherCopied] = React.useState(false)
  const [showMoolre, setShowMoolre] = React.useState(false)
  const [moolreAuthUrl, setMoolreAuthUrl] = React.useState(/** @type {string | null} */ (null))
  const [moolreReference, setMoolreReference] = React.useState(/** @type {string | null} */ (null))
  const [moolreRedirectUrl, setMoolreRedirectUrl] = React.useState(/** @type {string | null} */ (null))
  const [isInitializingMomo, setIsInitializingMomo] = React.useState(false)

  const sellRowRef = React.useRef(
    /** @type {{ id: string, name: string, priceGHS: number, dataLimit: string, status: string, stockUnits: number } | null} */ (null),
  )

  const [saveSuccess, setSaveSuccess] = React.useState(/** @type {string | null} */ (null))

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const price = Number(form.priceGHS)
      const sessionHours = Number(form.sessionHours)
      const radiusSessionTimeout = Math.round(sessionHours * 3600)
      const dataCapGbTrim = form.dataCapGb.trim()
      const radiusMaxOctets = dataCapGbTrim
        ? Math.round(Number(dataCapGbTrim) * 1024 ** 3)
        : null
      const uploadTrim = form.uploadSpeed.trim()
      const downloadTrim = form.downloadSpeed.trim()
      const uploadSpeed = uploadTrim ? Number(uploadTrim) : null
      const downloadSpeed = downloadTrim ? Number(downloadTrim) : null
      /** @type {Parameters<typeof createCatalogPackage>[1]} */
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        priceGHS: price,
        dataLimit: form.dataLimit.trim(),
        status: form.status,
        radiusSessionTimeout,
        radiusMaxOctets,
        uploadSpeed,
        downloadSpeed,
        currency: "GHS",
      }
      if (editing) {
        const editLocationId = isSalesAgent ? (agentStore?.id ?? "") : locationFilterId
        const r = await updateCatalogPackage(
          token,
          editing.id,
          body,
          editLocationId ? { locationId: editLocationId } : undefined,
        )
        if (!r.ok) throw new Error(r.error || "Update failed")
        return { mode: /** @type {"edit"} */ ("edit"), forked: Boolean(r.forked) }
      }
      const targetLocationId = isSalesAgent ? (agentStore?.id ?? "") : locationFilterId
      const r = await createCatalogPackage(token, {
        ...body,
        locationId: targetLocationId,
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
      setForm(emptyPackageForm())
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
      return id
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["catalog"] })
      const snapshots = queryClient.getQueriesData({ queryKey: ["catalog"] })
      queryClient.setQueriesData({ queryKey: ["catalog"] }, (old) => {
        if (!old || !Array.isArray(old.packages)) return old
        return { ...old, packages: old.packages.filter((p) => p.id !== id) }
      })
      return { snapshots }
    },
    onError: (_err, _id, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({ pkg, nextStatus }) => {
      if (!token) throw new Error("Not signed in")
      const editLocationId = isSalesAgent ? (agentStore?.id ?? "") : locationFilterId
      const r = await updateCatalogPackage(
        token,
        pkg.id,
        { status: nextStatus },
        editLocationId ? { locationId: editLocationId } : undefined,
      )
      if (!r.ok) throw new Error(r.error || `Failed to update status to ${nextStatus}`)
      return { pkg, nextStatus, forked: Boolean(r.forked) }
    },
    onSuccess: ({ pkg, nextStatus, forked }) => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
      queryClient.invalidateQueries({ queryKey: ["package-stock"] })

      const actionWord =
        nextStatus === "Paused"
          ? "paused"
          : nextStatus === "Suspended"
            ? "suspended"
            : nextStatus === "Active"
              ? "activated"
              : "deactivated"

      const portalNote =
        nextStatus === "Active"
          ? "It is now visible on the captive portal buy page."
          : "It will not show when users are buying from the captive portal."

      const locationScopeNote =
        forked
          ? ` at ${locationFilterLabel} (other locations keep the original)`
          : ` at ${locationFilterLabel}`

      setSaveSuccess(`Package "${pkg.name}" is now ${actionWord}${locationScopeNote}. ${portalNote}`)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Status update failed")
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

  /** Location-specific package view: strictly packages for the selected wifi location. */
  const scopedToSingleLocation = true

  const tableRows = React.useMemo(() => {
    const currentLocId = isSalesAgent ? (agentStore?.id ?? "") : locationFilterId
    if (!currentLocId) return []
    return allPackages.filter((pkg) => {
      // 1. Explicit assigned locationId on package
      if (pkg.locationId) {
        return String(pkg.locationId).trim() === String(currentLocId).trim()
      }
      // 2. Voucher inventory at this location
      return inventoryByPackageId.has(pkg.id)
    })
  }, [allPackages, isSalesAgent, agentStore?.id, locationFilterId, inventoryByPackageId])

  const packageSalesStats = React.useMemo(() => {
    const map = new Map()
    const allSales = catalog.data?.sales ?? []
    const currentLocId = isSalesAgent ? (agentStore?.id ?? "") : locationFilterId

    for (const sale of allSales) {
      if (sale.status !== "Completed") continue
      if (currentLocId && sale.locationId && String(sale.locationId).trim() !== String(currentLocId).trim()) {
        continue
      }
      const pkgId = sale.packageId ? String(sale.packageId).trim() : ""
      const pkgType = sale.packageType ? String(sale.packageType).trim().toLowerCase() : ""

      if (pkgId) {
        const prev = map.get(pkgId) || { count: 0, revenue: 0 }
        map.set(pkgId, { count: prev.count + 1, revenue: prev.revenue + (Number(sale.amount) || 0) })
      }
      if (pkgType) {
        const prev = map.get(pkgType) || { count: 0, revenue: 0 }
        map.set(pkgType, { count: prev.count + 1, revenue: prev.revenue + (Number(sale.amount) || 0) })
      }
    }
    return map
  }, [catalog.data?.sales, isSalesAgent, agentStore?.id, locationFilterId])

  const locationSummary = React.useMemo(() => {
    let totalVouchers = 0
    let remaining = 0
    let sold = 0
    let revenue = 0

    for (const pkg of tableRows) {
      const inv = inventoryByPackageId.get(pkg.id)
      const t = inv?.total ?? 0
      const rem = inv?.remaining ?? 0
      const voucherSold = Math.max(0, t - rem)

      const statsById = packageSalesStats.get(String(pkg.id).trim())
      const statsByName = pkg.name ? packageSalesStats.get(String(pkg.name).trim().toLowerCase()) : null
      const directCount = Math.max(statsById?.count ?? 0, statsByName?.count ?? 0)
      const directRevenue = Math.max(statsById?.revenue ?? 0, statsByName?.revenue ?? 0)

      const pkgSold = Math.max(voucherSold, directCount)
      const pkgRev = directRevenue > 0 ? directRevenue : pkgSold * (Number(pkg.priceGHS) || 0)

      totalVouchers += t
      remaining += rem
      sold += pkgSold
      revenue += pkgRev
    }

    return { totalVouchers, remaining, sold, revenue }
  }, [tableRows, inventoryByPackageId, packageSalesStats])

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

  const sellMutation = useMutation({
    mutationFn: async (/** @type {string | undefined} */ paymentReference) => {
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
      /** @type {Parameters<typeof createCatalogSale>[1]} */
      const saleBody = {
        packageId: row.id,
        customerPhone,
        ...(paymentReference ? { paymentReference } : {}),
      }
      if (isAdmin) {
        if (!sellLocationId) throw new Error("Choose a wifi location for this sale.")
        saleBody.locationId = sellLocationId
      } else {
        if (!agentStore) {
          throw new Error(
            "No wifi location is linked to your account. Ask an administrator to assign you to a location.",
          )
        }
      }
      const result = paymentReference
        ? await createCatalogSaleWithPaymentRetry(token, saleBody)
        : await createCatalogSale(token, saleBody)
      if (!result.ok) throw new Error(result.error || "Sale failed")
      return { sale: result.sale, paymentReference: paymentReference ?? null }
    },
    onSuccess: ({ sale, paymentReference }) => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      queryClient.invalidateQueries({ queryKey: ["package-stock"] })
      queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
      queryClient.invalidateQueries({ queryKey: ["vouchers"] })
      queryClient.invalidateQueries({ queryKey: ["vouchers-summary"] })
      queryClient.invalidateQueries({ queryKey: ["voucher-stats"] })

      const code = typeof sale?.voucherCode === "string" ? sale.voucherCode.trim() : ""
      const successMsg = code
        ? `Sale recorded. SMS sent to the customer. Show or copy the WiFi code below.`
        : "Sale recorded. Voucher SMS was sent and marked as used."

      resetMoolreState()
      sellRowRef.current = null
      setSellPkg(null)
      setSellCustomerPhone("")
      setSellLocationId(locations[0]?.id ?? "")
      setSellError(null)
      setSellOpen(false)

      if (paymentReference && isSalesAgent) {
        navigate("/", {
          replace: true,
          state: {
            flashMessage: successMsg,
            ...(code ? { voucherCode: code } : {}),
          },
        })
        return
      }

      setSellSuccess(successMsg)
      setSoldVoucherCode(code || null)
      setVoucherCopied(false)
    },
    onError: (err) => {
      setSellError(err instanceof Error ? err.message : "Request failed")
      setSellOpen(true)
    },
  })

  const resetForm = () => {
    setForm(emptyPackageForm())
    setEditing(null)
    setFormError(null)
  }

  const openAdd = () => {
    resetForm()
    setOpen(true)
  }

  const openEdit = React.useCallback((row) => {
    setEditing(row)
    const timeoutSec = Number(row.radiusSessionTimeout)
    const sessionHours =
      Number.isFinite(timeoutSec) && timeoutSec > 0
        ? String(Math.round((timeoutSec / 3600) * 1000) / 1000)
        : ""
    const octets = Number(row.radiusMaxOctets)
    const dataCapGb =
      Number.isFinite(octets) && octets > 0
        ? String(Math.round((octets / 1024 ** 3) * 1000) / 1000)
        : ""
    setForm({
      name: row.name,
      description: String(row.description ?? ""),
      priceGHS: String(row.priceGHS),
      dataLimit: row.dataLimit,
      status: row.status,
      sessionHours,
      dataCapGb,
      uploadSpeed: row.uploadSpeed != null && row.uploadSpeed !== "" ? String(row.uploadSpeed) : "",
      downloadSpeed:
        row.downloadSpeed != null && row.downloadSpeed !== "" ? String(row.downloadSpeed) : "",
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
      setSoldVoucherCode(null)
      setVoucherCopied(false)
      setSellOpen(true)
    },
    [locations, isAdmin, locationFilterId],
  )

  const remove = React.useCallback(
    (id) => {
      const packageId = typeof id === "string" ? id.trim() : String(id ?? "").trim()
      if (!packageId) return
      if (!window.confirm("Delete this package? It will be removed from the catalog and WiFi buy page.")) return
      deleteMutation.mutate(packageId)
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
    const sessionHours = Number(form.sessionHours)
    if (!form.name.trim() || form.name.trim().length < 2) {
      setFormError("Package name is required (at least 2 characters).")
      return
    }
    if (!form.description.trim()) {
      setFormError("Description is required.")
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError("Enter a valid price (GH₵).")
      return
    }
    if (!form.dataLimit.trim()) {
      setFormError("Data limit label is required (e.g. Unlimited · 1 week).")
      return
    }
    if (!Number.isFinite(sessionHours) || sessionHours <= 0) {
      setFormError("Session duration in hours is required (e.g. 1, 24, or 168 for a week).")
      return
    }
    const dataCapTrim = form.dataCapGb.trim()
    if (dataCapTrim) {
      const gb = Number(dataCapTrim)
      if (!Number.isFinite(gb) || gb <= 0) {
        setFormError("Data cap must be empty for unlimited, or a positive GB amount.")
        return
      }
    }
    for (const [label, value] of [
      ["Upload speed", form.uploadSpeed],
      ["Download speed", form.downloadSpeed],
    ]) {
      const trim = String(value).trim()
      if (!trim) continue
      const n = Number(trim)
      if (!Number.isFinite(n) || n < 0) {
        setFormError(`${label} must be empty or a non-negative number.`)
        return
      }
    }
    const status = form.status.trim()
    if (!["Active", "Paused", "Suspended", "Inactive"].includes(status)) {
      setFormError("Status must be Active, Paused, Suspended, or Inactive.")
      return
    }
    saveMutation.mutate()
  }

  const resetMoolreState = () => {
    setShowMoolre(false)
    setMoolreAuthUrl(null)
    setMoolreReference(null)
    setMoolreRedirectUrl(null)
    setIsInitializingMomo(false)
  }

  const confirmCashSale = () => {
    setSellError(null)
    sellMutation.mutate(undefined)
  }

  const handleCollectMomo = async () => {
    setSellError(null)
    const row = sellRowRef.current
    if (!token || !row) return
    if (!sellPhoneValid) {
      setSellError("Enter a valid customer phone number first.")
      return
    }
    if (isAdmin && !sellLocationId) {
      setSellError("Choose a wifi location for this sale.")
      return
    }
    if (isSalesAgent && !agentStore) {
      setSellError("No wifi location is linked to your account.")
      return
    }

    setIsInitializingMomo(true)
    try {
      const customerPhone = sellCustomerPhone.trim().replace(/\s+/g, " ")
      const init = await initializeAgentMoolrePayment(token, {
        packageId: row.id,
        customerPhone,
        ...(isAdmin && sellLocationId ? { locationId: sellLocationId } : {}),
      })
      if (!init.ok) throw new Error(init.error || "Failed to start MoMo payment")
      setMoolreAuthUrl(init.authorization_url)
      setMoolreReference(init.reference)
      setMoolreRedirectUrl(init.redirect_url)
      // Hide the sell form so the MoMo screen can take over (esp. on mobile,
      // where both use z-50 and the Dialog portal otherwise covers payment).
      setSellOpen(false)
      setShowMoolre(true)
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Failed to start payment")
    } finally {
      setIsInitializingMomo(false)
    }
  }

  const handleMoolreSuccess = (/** @type {{ reference?: string, externalref?: string }} */ response) => {
    const ref = response?.reference || response?.externalref || moolreReference
    if (!ref) {
      setSellError("No payment reference returned from Moolre.")
      resetMoolreState()
      setSellOpen(true)
      return
    }
    setSellError(null)
    sellMutation.mutate(ref, {
      onSettled: () => resetMoolreState(),
    })
  }

  const handleMoolreCancel = () => {
    resetMoolreState()
    // Restore the sell form so the agent can edit and try again.
    setSellOpen(true)
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
        id: "allTimeSales",
        accessorFn: (row) => {
          const inv = inventoryByPackageId.get(row.id)
          const voucherSold = inv ? Math.max(0, (inv.total ?? 0) - (inv.remaining ?? 0)) : 0
          const statsById = packageSalesStats.get(String(row.id).trim())
          const statsByName = row.name ? packageSalesStats.get(String(row.name).trim().toLowerCase()) : null
          const directCount = Math.max(statsById?.count ?? 0, statsByName?.count ?? 0)
          return Math.max(voucherSold, directCount)
        },
        header: "All-time sales",
        cell: ({ row }) => {
          const pkg = row.original
          const inv = inventoryByPackageId.get(pkg.id)
          const voucherSold = inv ? Math.max(0, (inv.total ?? 0) - (inv.remaining ?? 0)) : 0
          const statsById = packageSalesStats.get(String(pkg.id).trim())
          const statsByName = pkg.name ? packageSalesStats.get(String(pkg.name).trim().toLowerCase()) : null
          const directCount = Math.max(statsById?.count ?? 0, statsByName?.count ?? 0)
          const directRevenue = Math.max(statsById?.revenue ?? 0, statsByName?.revenue ?? 0)
          const soldCount = Math.max(voucherSold, directCount)
          const revenue = directRevenue > 0 ? directRevenue : soldCount * (Number(pkg.priceGHS) || 0)

          if (inventoryLoading) return <span className="text-muted-foreground tabular-nums">…</span>

          return (
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">
                {soldCount.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">sold</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatCedis(revenue)}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row, getValue }) => {
          const v = getValue()
          const pkg = row.original
          if (!isAdmin) {
            return <PackageStatusBadge status={v} />
          }
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="group inline-flex items-center gap-1 rounded-full cursor-pointer transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Click to change package status"
                >
                  <PackageStatusBadge status={v} />
                  <ChevronDown className="size-3 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold">Change status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={v === "Active" || statusMutation.isPending}
                  onClick={() => statusMutation.mutate({ pkg, nextStatus: "Active" })}
                  className="cursor-pointer"
                >
                  <CheckCircle2 className="size-4 mr-2 text-emerald-600 dark:text-emerald-400" />
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Active</span>
                    <span className="text-[10px] text-muted-foreground">Visible on portal</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={v === "Paused" || statusMutation.isPending}
                  onClick={() => statusMutation.mutate({ pkg, nextStatus: "Paused" })}
                  className="cursor-pointer"
                >
                  <Pause className="size-4 mr-2 text-amber-600 dark:text-amber-400" />
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Pause</span>
                    <span className="text-[10px] text-muted-foreground">Hide from captive portal</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={v === "Suspended" || statusMutation.isPending}
                  onClick={() => statusMutation.mutate({ pkg, nextStatus: "Suspended" })}
                  className="cursor-pointer"
                >
                  <Ban className="size-4 mr-2 text-rose-600 dark:text-rose-400" />
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Suspend</span>
                    <span className="text-[10px] text-muted-foreground">Suspend package</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={v === "Inactive" || statusMutation.isPending}
                  onClick={() => statusMutation.mutate({ pkg, nextStatus: "Inactive" })}
                  className="cursor-pointer"
                >
                  <AlertCircle className="size-4 mr-2 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Inactive</span>
                    <span className="text-[10px] text-muted-foreground">Deactivate package</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
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
          const isPausedOrSuspended = pkg.status === "Paused" || pkg.status === "Suspended"

          return (
            <div className="flex flex-wrap justify-end items-center gap-2">
              {canSell ? (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={!canSellThis || sellMutation.isPending || (isSalesAgent && agentBlocked)}
                  onClick={() => openSell(pkg)}
                  title={
                    pkg.status !== "Active"
                      ? "Package is paused/suspended"
                      : remaining <= 0
                        ? "No vouchers remaining"
                        : "Record sale"
                  }
                >
                  Sell
                </Button>
              ) : null}
              {isAdmin ? (
                <>
                  {pkg.status === "Active" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={statusMutation.isPending}
                          className="text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:border-amber-800/80 dark:hover:bg-amber-950/40"
                          title="Pause or suspend this package so it won't show on the captive portal"
                        >
                          <Pause className="size-3.5 mr-1" />
                          Pause
                          <ChevronDown className="size-3 ml-1 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          onClick={() => statusMutation.mutate({ pkg, nextStatus: "Paused" })}
                          className="cursor-pointer"
                        >
                          <Pause className="size-4 mr-2 text-amber-600 dark:text-amber-400" />
                          <div>
                            <div className="font-medium text-xs">Pause package</div>
                            <div className="text-[10px] text-muted-foreground">Hide from captive portal buyers</div>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => statusMutation.mutate({ pkg, nextStatus: "Suspended" })}
                          className="cursor-pointer"
                        >
                          <Ban className="size-4 mr-2 text-rose-600 dark:text-rose-400" />
                          <div>
                            <div className="font-medium text-xs">Suspend package</div>
                            <div className="text-[10px] text-muted-foreground">Suspend & hide from portal</div>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : isPausedOrSuspended ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ pkg, nextStatus: "Active" })}
                      className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:border-emerald-800/80 dark:hover:bg-emerald-950/40"
                      title="Resume package and show it on the captive portal"
                    >
                      <Play className="size-3.5 mr-1 fill-current" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ pkg, nextStatus: "Active" })}
                      className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:border-emerald-800/80 dark:hover:bg-emerald-950/40"
                      title="Activate package"
                    >
                      <Play className="size-3.5 mr-1 fill-current" />
                      Activate
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => openEdit(pkg)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="size-8 shrink-0"
                    disabled={deleteMutation.isPending}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      remove(pkg.id)
                    }}
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
      statusMutation,
      inventoryByPackageId,
      inventoryLoading,
      inventoryError,
      packageSalesStats,
    ],
  )

  const pageDescription = isAdmin
    ? `Showing packages and live voucher inventory for ${locationFilterLabel}. Only packages for this location show on its captive portal.`
    : "Packages at your wifi location with voucher totals and remaining stock. Tap Sell to record a sale."

  return (
    <div className="space-y-6">
      <PageHeader title="Packages" description={pageDescription}>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          {isAdmin ? (
            <div className="space-y-1 sm:text-right">
              <Label
                htmlFor="packages-location-top"
                className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              >
                Location
              </Label>
              <Select value={locationFilterId} onValueChange={setLocationFilterId}>
                <SelectTrigger id="packages-location-top" className="h-9 w-full min-w-[11rem] shadow-none sm:w-52">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs sm:justify-end">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span>{agentStore?.name ?? "No store assigned"}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button type="button" onClick={openAdd} disabled={!isAdmin}>
              Add package
            </Button>
          </div>
        </div>
      </PageHeader>

      {sellSuccess || soldVoucherCode ? (
        <div
          className="text-foreground bg-primary/10 border-primary/25 space-y-3 rounded-md border px-3 py-3 text-sm"
          role="status"
        >
          {sellSuccess ? <p>{sellSuccess}</p> : null}
          {soldVoucherCode ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                WiFi code (also sent by SMS)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="bg-background border-border/80 rounded-md border px-3 py-2 font-mono text-base tracking-[0.14em]">
                  {soldVoucherCode}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(soldVoucherCode)
                      setVoucherCopied(true)
                      setTimeout(() => setVoucherCopied(false), 1500)
                    } catch {
                      /* clipboard unavailable */
                    }
                  }}
                >
                  {voucherCopied ? (
                    <>
                      <Check className="size-4 text-emerald-500" aria-hidden />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" aria-hidden />
                      Copy code
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline"
            onClick={() => {
              setSellSuccess(null)
      setSoldVoucherCode(null)
      setVoucherCopied(false)
              setSoldVoucherCode(null)
              setVoucherCopied(false)
            }}
          >
            Dismiss
          </button>
        </div>
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

      {!inventoryLoading && !inventoryError && tableRows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
          No packages found for {scopedLocationLabel}. Tap &ldquo;Add package&rdquo; or upload vouchers for this location to display them here.
        </p>
      ) : null}

      {/* Location All-Time Sales & Stock Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-3 shadow-none">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">All-time sales</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {locationSummary.sold.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">sold</span>
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{formatCedis(locationSummary.revenue)} total revenue</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 shadow-none">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active Packages</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {tableRows.filter((p) => p.status === "Active").length} <span className="text-xs font-normal text-muted-foreground">/ {tableRows.length} total</span>
          </p>
          <p className="text-xs text-muted-foreground truncate">{locationFilterLabel}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 shadow-none">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vouchers In Stock</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
            {locationSummary.remaining.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">Available to sell</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 shadow-none">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Uploaded</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {locationSummary.totalVouchers.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {locationSummary.totalVouchers > 0
              ? `${((locationSummary.sold / locationSummary.totalVouchers) * 100).toFixed(1)}% sold rate`
              : "0% sold"}
          </p>
        </div>
      </div>

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
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit package (${locationFilterLabel})` : `Add package for ${locationFilterLabel}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {isAdmin && locationFilterLabel ? (
              <p
                className="bg-primary/10 text-foreground border-primary/25 rounded-md border px-2.5 py-2 text-xs"
                role="status"
              >
                {editing
                  ? `Saving changes for ${locationFilterLabel}. If this package is shared with another location, a separate copy is created for this site so others remain unchanged.`
                  : `This package will be created specifically for ${locationFilterLabel} and will appear on its captive portal.`}
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
                placeholder="e.g. 1 Week Unlimited"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-description">Description</Label>
              <Input
                id="pkg-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Unlimited internet for 7 days"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-price">Price (GH₵)</Label>
              <Input
                id="pkg-price"
                inputMode="decimal"
                value={form.priceGHS}
                onChange={(e) => setForm((f) => ({ ...f, priceGHS: e.target.value }))}
                placeholder="e.g. 50"
                required
              />
              <p className="text-muted-foreground text-xs">
                Remaining stock is calculated from uploaded vouchers, not entered here.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-limit">Data limit label</Label>
              <Input
                id="pkg-limit"
                value={form.dataLimit}
                onChange={(e) => setForm((f) => ({ ...f, dataLimit: e.target.value }))}
                placeholder="e.g. Unlimited · 1 week"
                required
              />
              <p className="text-muted-foreground text-xs">Shown to customers on SMS and menus.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-session">Session duration (hours)</Label>
              <Input
                id="pkg-session"
                inputMode="decimal"
                value={form.sessionHours}
                onChange={(e) => setForm((f) => ({ ...f, sessionHours: e.target.value }))}
                placeholder="e.g. 1, 24, or 168 for a week"
                required
              />
              <p className="text-muted-foreground text-xs">
                WiFi session length for RADIUS (required). 24 = 1 day, 168 = 1 week.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-cap">Data cap (GB)</Label>
              <Input
                id="pkg-cap"
                inputMode="decimal"
                value={form.dataCapGb}
                onChange={(e) => setForm((f) => ({ ...f, dataCapGb: e.target.value }))}
                placeholder="Leave blank for unlimited"
              />
              <p className="text-muted-foreground text-xs">Optional. Blank means no data byte limit.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pkg-upload">Upload speed</Label>
                <Input
                  id="pkg-upload"
                  inputMode="numeric"
                  value={form.uploadSpeed}
                  onChange={(e) => setForm((f) => ({ ...f, uploadSpeed: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkg-download">Download speed</Label>
                <Input
                  id="pkg-download"
                  inputMode="numeric"
                  value={form.downloadSpeed}
                  onChange={(e) => setForm((f) => ({ ...f, downloadSpeed: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger id="pkg-status" className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-500 inline-block" />
                      <span>Active</span>
                      <span className="text-muted-foreground text-xs">(Visible on captive portal)</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="Paused">
                    <span className="flex items-center gap-2">
                      <Pause className="size-3 text-amber-500 inline" />
                      <span>Paused</span>
                      <span className="text-muted-foreground text-xs">(Hidden from captive portal)</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="Suspended">
                    <span className="flex items-center gap-2">
                      <Ban className="size-3 text-rose-500 inline" />
                      <span>Suspended</span>
                      <span className="text-muted-foreground text-xs">(Hidden from captive portal)</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="Inactive">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-muted-foreground/40 inline-block" />
                      <span>Inactive</span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Paused or suspended packages do not show when users are buying from the captive portal.
              </p>
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
          // Payment screen owns the flow — don't wipe MoMo state if the sell
          // dialog tries to close while checkout is open.
          if (!o && showMoolre) return
          setSellOpen(o)
          if (!o) {
            sellRowRef.current = null
            setSellPkg(null)
            setSellCustomerPhone("")
            setSellError(null)
            setSellSuccess(null)
      setSoldVoucherCode(null)
      setVoucherCopied(false)
            resetMoolreState()
          }
        }}
      >
        <DialogContent className="overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isSalesAgent ? "Sell package" : "Record sale"}</DialogTitle>
          </DialogHeader>
          {sellPkg ? (
            <div className="grid min-w-0 gap-4 py-1">
              {sellError ? (
                <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
                  {sellError}
                </p>
              ) : null}
              <div className="bg-muted/50 min-w-0 space-y-1 overflow-hidden rounded-md border px-3 py-2 text-sm">
                <p className="font-medium">{sellPkg.name}</p>
                <p className="text-muted-foreground break-words">
                  {formatCedis(sellPkg.priceGHS)} · {sellPkg.dataLimit} · Stock: {sellStockLabel}
                  {sellStockQuery.isError ? (
                    <span className="text-destructive"> (could not load stock)</span>
                  ) : null}
                </p>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="sell-phone">Customer phone (SMS voucher)</Label>
                <Input
                  id="sell-phone"
                  type="tel"
                  inputMode="tel"
                  className="w-full min-w-0"
                  value={sellCustomerPhone}
                  onChange={(e) => setSellCustomerPhone(e.target.value)}
                  placeholder="e.g. 0241234567"
                  autoComplete="tel"
                />
              </div>
              {isAdmin ? (
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="sell-location">Wifi location</Label>
                  {locations.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No wifi locations in the catalog. Add one first.</p>
                  ) : (
                    <Select value={sellLocationId} onValueChange={setSellLocationId}>
                      <SelectTrigger id="sell-location" className="w-full min-w-0">
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
                <div className="min-w-0 space-y-1.5">
                  <Label>Wifi location</Label>
                  <p className="text-muted-foreground break-words text-sm">
                    {agentStore ? `${agentStore.name} (${agentStore.address})` : "—"}
                  </p>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch sm:justify-stretch">
            <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2">
              {isAdmin || isSalesAgent ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-w-0"
                  onClick={confirmCashSale}
                  disabled={
                    sellMutation.isPending ||
                    isInitializingMomo ||
                    !sellPhoneValid ||
                    (isAdmin && (!sellLocationId || locations.length === 0)) ||
                    (isSalesAgent && !agentStore) ||
                    !sellStockLocationId ||
                    sellStockQuery.isLoading ||
                    sellStockQuery.isError ||
                    sellStockRemaining === 0
                  }
                >
                  {sellMutation.isPending ? "Recording…" : "Record cash sale"}
                </Button>
              ) : null}
              <Button
                type="button"
                className="w-full min-w-0"
                onClick={handleCollectMomo}
                disabled={
                  sellMutation.isPending ||
                  isInitializingMomo ||
                  !sellPhoneValid ||
                  (isAdmin && (!sellLocationId || locations.length === 0)) ||
                  (isSalesAgent && !agentStore) ||
                  !sellStockLocationId ||
                  sellStockQuery.isLoading ||
                  sellStockQuery.isError ||
                  sellStockRemaining === 0
                }
              >
                {isInitializingMomo
                  ? "Starting payment…"
                  : sellMutation.isPending
                    ? "Completing sale…"
                    : "Collect MoMo payment"}
              </Button>
            </div>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setSellOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoolrePayment
        open={showMoolre}
        authorizationUrl={moolreAuthUrl}
        callbackUrl={moolreRedirectUrl}
        paymentReference={moolreReference}
        onCancel={handleMoolreCancel}
        onSuccess={handleMoolreSuccess}
      />
    </div>
  )
}

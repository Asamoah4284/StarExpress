import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { ServerVouchersTable } from "@/components/vouchers/ServerVouchersTable.jsx"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { deleteAllVouchers, deleteVoucher, fetchVouchers } from "@/lib/api.js"
import { filterVouchersByPackage } from "@/lib/aggregations.js"
import { ROLE_ADMIN } from "@/lib/roles.js"

/** @typedef {"all" | "unused" | "used"} StatusFilter */
/** @typedef {"all" | "unassigned" | string} PackageFilter */

/**
 * @param {Record<string, string> | undefined} columns
 * @returns {string | null}
 */
function statusColumnKey(columns) {
  if (!columns || typeof columns !== "object") return null
  for (const k of Object.keys(columns)) {
    const normalized = String(k).replace(/·/g, ".").trim()
    if (/^status$/i.test(normalized)) return k
  }
  return null
}

/**
 * @param {{ columns?: Record<string, string> }} v
 */
function voucherStatusRaw(v) {
  const key = statusColumnKey(v.columns)
  if (!key) return ""
  return String(v.columns?.[key] ?? "").trim()
}

/**
 * @param {{ columns?: Record<string, string> }} v
 * @param {StatusFilter} filter
 */
function voucherMatchesStatusFilter(v, filter) {
  if (filter === "all") return true
  const raw = voucherStatusRaw(v)
  const s = raw.toLowerCase()
  if (filter === "unused") return s === "unused"
  if (filter === "used") return s === "used"
  return true
}

/**
 * @param {{ packageId?: string }} v
 * @param {PackageFilter} filter
 */
function voucherMatchesPackageFilter(v, filter) {
  if (filter === "all") return true
  if (filter === "unassigned") {
    return !v.packageId || !String(v.packageId).trim()
  }
  return v.packageId === filter
}

/**
 * @param {Array<{ packageId?: string, packageName?: string }>} vouchers
 */
function packageFilterOptions(vouchers) {
  /** @type {Map<string, string>} */
  const byId = new Map()
  for (const v of vouchers) {
    const id = typeof v.packageId === "string" ? v.packageId.trim() : ""
    if (!id) continue
    const name =
      typeof v.packageName === "string" && v.packageName.trim() ? v.packageName.trim() : id
    if (!byId.has(id)) byId.set(id, name)
  }
  return [...byId.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => ({ id, name }))
}

export default function UploadedVouchers() {
  const { token, user, authReady } = useAuth()
  const isAdmin = user?.role === ROLE_ADMIN
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState(/** @type {StatusFilter} */ ("all"))
  const [packageFilter, setPackageFilter] = React.useState(/** @type {PackageFilter} */ ("all"))

  const deleteMutation = useMutation({
    mutationFn: async (/** @type {string} */ id) => {
      if (!token) throw new Error("Not signed in")
      const r = await deleteVoucher(token, id)
      if (!r.ok) throw new Error(r.error || "Delete failed")
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers", token] })
      void queryClient.invalidateQueries({ queryKey: ["auditLogs", token] })
    },
  })

  const confirmDelete = React.useCallback(
    (/** @type {{ id: string, documentId?: string }} */ voucher) => {
      const docId = voucher.documentId ?? voucher.id
      if (!window.confirm(`Delete voucher ${voucher.id}? This cannot be undone.`)) return
      deleteMutation.mutate(docId)
    },
    [deleteMutation],
  )

  const vouchersQuery = useQuery({
    queryKey: ["vouchers", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchVouchers(token)
      if (!r.ok) throw new Error(r.error || "Failed to load vouchers")
      return r.vouchers
    },
    enabled: authReady && Boolean(token) && isAdmin,
  })

  const allVouchers = vouchersQuery.data ?? []

  const packageOptions = React.useMemo(() => {
    const fromVouchers = packageFilterOptions(allVouchers)
    const catalogPkgs = catalog.data?.packages ?? []
    /** @type {Map<string, string>} */
    const merged = new Map(fromVouchers.map((p) => [p.id, p.name]))
    for (const p of catalogPkgs) {
      if (p.id && !merged.has(p.id)) {
        merged.set(p.id, typeof p.name === "string" && p.name.trim() ? p.name.trim() : p.id)
      }
    }
    return [...merged.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, name }))
  }, [allVouchers, catalog.data?.packages])

  const hasUnassigned = React.useMemo(
    () => allVouchers.some((v) => !v.packageId || !String(v.packageId).trim()),
    [allVouchers],
  )

  const selectedPackageLabel = React.useMemo(() => {
    if (packageFilter === "all") return null
    if (packageFilter === "unassigned") return "vouchers without a package"
    const opt = packageOptions.find((p) => p.id === packageFilter)
    return opt ? `package "${opt.name}"` : `package ${packageFilter}`
  }, [packageFilter, packageOptions])

  const deleteAllMutation = useMutation({
    mutationFn: async (/** @type {{ packageId?: string } | undefined} */ scope) => {
      if (!token) throw new Error("Not signed in")
      const r = await deleteAllVouchers(token, scope ?? {})
      if (!r.ok) throw new Error(r.error || "Bulk delete failed")
      return r.deleted
    },
    onSuccess: (_deleted, scope) => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers", token] })
      void queryClient.invalidateQueries({ queryKey: ["auditLogs", token] })
      if (scope?.packageId) setPackageFilter("all")
    },
  })

  const confirmDeleteAll = React.useCallback(() => {
    const n = allVouchers.length
    if (n === 0) return
    if (
      !window.confirm(
        "Delete EVERY voucher in the database? This removes all locations, packages, and statuses. This cannot be undone.",
      )
    ) {
      return
    }
    if (!window.confirm(`Final confirmation: permanently remove all voucher documents (at least ${n} loaded in this view).`))
      return
    deleteAllMutation.mutate(undefined)
  }, [deleteAllMutation, allVouchers.length])

  const confirmDeleteForPackage = React.useCallback(() => {
    if (packageFilter === "all" || packageFilter === "unassigned") return
    const inView = filterVouchersByPackage(allVouchers, packageFilter).length
    const label = selectedPackageLabel ?? "this package"
    if (
      !window.confirm(
        `Delete all vouchers assigned to ${label}? This removes every voucher with that package in the database (${inView} shown in the current list). This cannot be undone.`,
      )
    ) {
      return
    }
    deleteAllMutation.mutate({ packageId: packageFilter })
  }, [deleteAllMutation, packageFilter, allVouchers, selectedPackageLabel])

  const filteredVouchers = React.useMemo(() => {
    let list = allVouchers
    list = list.filter((v) => voucherMatchesPackageFilter(v, packageFilter))
    if (statusFilter !== "all") {
      list = list.filter((v) => voucherMatchesStatusFilter(v, statusFilter))
    }
    return list
  }, [allVouchers, statusFilter, packageFilter])

  const totalCount = allVouchers.length
  const emptyFilterMessage =
    filteredVouchers.length === 0 && totalCount > 0
      ? "No vouchers match the current filters."
      : undefined

  const canDeletePackageScope = packageFilter !== "all" && packageFilter !== "unassigned"

  return (
    <div className="w-full min-w-0 space-y-3">
      <PageHeader
        title="Uploaded vouchers"
        description="Filter by package and status. Delete one row, all vouchers for a package, or the entire inventory."
      />

      <Card className="border-border bg-card w-full min-w-0 gap-2 py-2 shadow-none ring-1 ring-border">
        <CardContent className="w-full min-w-0 space-y-2 px-3 pb-3 pt-1 sm:px-4">
          {isAdmin ? (
            <>
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                    <Label htmlFor="voucher-package-filter" className="text-muted-foreground shrink-0 text-xs font-medium">
                      Package
                    </Label>
                    <Select
                      value={packageFilter}
                      onValueChange={(v) => setPackageFilter(v === "unassigned" ? "unassigned" : v || "all")}
                    >
                      <SelectTrigger id="voucher-package-filter" size="sm" className="h-8 w-full sm:w-[14rem]">
                        <SelectValue placeholder="All packages" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All packages</SelectItem>
                        {hasUnassigned ? <SelectItem value="unassigned">No package assigned</SelectItem> : null}
                        {packageOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                    <Label htmlFor="voucher-status-filter" className="text-muted-foreground shrink-0 text-xs font-medium">
                      Status
                    </Label>
                    <Select
                      value={statusFilter}
                      onValueChange={(v) => setStatusFilter(v === "used" || v === "unused" ? v : "all")}
                    >
                      <SelectTrigger id="voucher-status-filter" size="sm" className="h-8 w-full sm:w-[11rem]">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="unused">Unused</SelectItem>
                        <SelectItem value="used">Used</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {filteredVouchers.length > 0 || totalCount > 0 ? (
                    <p className="text-muted-foreground text-xs tabular-nums">
                      Showing {filteredVouchers.length}
                      {packageFilter !== "all" || statusFilter !== "all" ? ` of ${totalCount}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-shrink-0 sm:flex-row sm:flex-wrap sm:items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full shrink-0 text-xs sm:w-auto"
                    onClick={() => void vouchersQuery.refetch()}
                    disabled={vouchersQuery.isFetching || deleteAllMutation.isPending}
                  >
                    {vouchersQuery.isFetching ? "Refreshing…" : "Refresh"}
                  </Button>
                  {canDeletePackageScope ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full shrink-0 border-destructive/50 text-xs text-destructive hover:bg-destructive/10 sm:w-auto"
                      onClick={confirmDeleteForPackage}
                      disabled={
                        vouchersQuery.isLoading ||
                        vouchersQuery.isFetching ||
                        deleteMutation.isPending ||
                        deleteAllMutation.isPending
                      }
                    >
                      {deleteAllMutation.isPending ? "Deleting…" : "Delete package vouchers"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full shrink-0 border-destructive/50 text-xs text-destructive hover:bg-destructive/10 sm:w-auto"
                    onClick={confirmDeleteAll}
                    disabled={
                      totalCount === 0 ||
                      vouchersQuery.isLoading ||
                      vouchersQuery.isFetching ||
                      deleteMutation.isPending ||
                      deleteAllMutation.isPending
                    }
                  >
                    {deleteAllMutation.isPending ? "Deleting…" : "Delete all vouchers"}
                  </Button>
                </div>
              </div>
              {vouchersQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">Loading vouchers from server…</p>
              ) : vouchersQuery.isError ? (
                <p className="text-destructive text-sm">
                  {vouchersQuery.error instanceof Error ? vouchersQuery.error.message : "Could not load vouchers."}
                </p>
              ) : (
                <>
                  {deleteMutation.isError ? (
                    <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
                      {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed."}
                    </p>
                  ) : null}
                  {deleteAllMutation.isError ? (
                    <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
                      {deleteAllMutation.error instanceof Error
                        ? deleteAllMutation.error.message
                        : "Bulk delete failed."}
                    </p>
                  ) : null}
                  <ServerVouchersTable
                    vouchers={filteredVouchers}
                    emptyMessage={emptyFilterMessage}
                    onDelete={confirmDelete}
                    deletingId={
                      deleteMutation.isPending && typeof deleteMutation.variables === "string"
                        ? deleteMutation.variables
                        : null
                    }
                  />
                </>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Only administrators can view vouchers stored on the server.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

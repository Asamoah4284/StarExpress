import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { ServerVouchersTable } from "@/components/vouchers/ServerVouchersTable.jsx"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  deleteAllVouchers,
  deleteVoucher,
  fetchVouchers,
  fetchVouchersSummary,
} from "@/lib/api.js"
import { ROLE_ADMIN } from "@/lib/roles.js"

/** @typedef {"all" | "unused" | "used"} StatusFilter */
/** @typedef {"all" | "unassigned" | string} PackageFilter */

const DEFAULT_PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 350

export default function UploadedVouchers() {
  const { token, user, authReady } = useAuth()
  const isAdmin = user?.role === ROLE_ADMIN
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState(/** @type {StatusFilter} */ ("all"))
  const [packageFilter, setPackageFilter] = React.useState(/** @type {PackageFilter} */ ("all"))
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    setPage(1)
  }, [packageFilter, statusFilter, pageSize, debouncedSearch])

  const summaryQuery = useQuery({
    queryKey: ["vouchers-summary", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchVouchersSummary(token)
      if (!r.ok) throw new Error(r.error || "Failed to load voucher summary")
      return r
    },
    enabled: authReady && Boolean(token) && isAdmin,
    staleTime: 60_000,
  })

  const vouchersQuery = useQuery({
    queryKey: ["vouchers", token, packageFilter, statusFilter, debouncedSearch, page, pageSize],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchVouchers(token, {
        page,
        limit: pageSize,
        packageId: packageFilter,
        status: statusFilter,
        search: debouncedSearch || undefined,
      })
      if (!r.ok) throw new Error(r.error || "Failed to load vouchers")
      return r
    },
    enabled: authReady && Boolean(token) && isAdmin,
    staleTime: 30_000,
    placeholderData: (previousData, previousQuery) => {
      if (!previousData || !previousQuery?.queryKey) return undefined
      const [, , pkg, status, search, , size] = previousQuery.queryKey
      if (
        pkg === packageFilter &&
        status === statusFilter &&
        search === debouncedSearch &&
        size === pageSize
      ) {
        return previousData
      }
      return undefined
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (/** @type {string} */ id) => {
      if (!token) throw new Error("Not signed in")
      const r = await deleteVoucher(token, id)
      if (!r.ok) throw new Error(r.error || "Delete failed")
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] })
      void queryClient.invalidateQueries({ queryKey: ["vouchers-summary"] })
      void queryClient.invalidateQueries({ queryKey: ["voucher-stats"] })
      void queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
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

  const packageOptions = React.useMemo(() => {
    const fromSummary = summaryQuery.data?.packages ?? []
    const catalogPkgs = catalog.data?.packages ?? []
    /** @type {Map<string, { name: string, count?: number }>} */
    const merged = new Map(fromSummary.map((p) => [p.id, { name: p.name, count: p.count }]))
    for (const p of catalogPkgs) {
      if (p.id && !merged.has(p.id)) {
        merged.set(p.id, { name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : p.id })
      }
    }
    return [...merged.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, { name, count }]) => ({ id, name, count }))
  }, [summaryQuery.data?.packages, catalog.data?.packages])

  const hasUnassigned = (summaryQuery.data?.unassignedCount ?? 0) > 0
  const totalInventory = summaryQuery.data?.totalCount ?? 0

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
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] })
      void queryClient.invalidateQueries({ queryKey: ["vouchers-summary"] })
      void queryClient.invalidateQueries({ queryKey: ["voucher-stats"] })
      void queryClient.invalidateQueries({ queryKey: ["package-voucher-inventory"] })
      void queryClient.invalidateQueries({ queryKey: ["auditLogs", token] })
      if (scope?.packageId) setPackageFilter("all")
      setPage(1)
    },
  })

  const confirmDeleteAll = React.useCallback(() => {
    if (totalInventory === 0) return
    if (
      !window.confirm(
        "Delete EVERY voucher in the database? This removes all locations, packages, and statuses. This cannot be undone.",
      )
    ) {
      return
    }
    if (
      !window.confirm(
        `Final confirmation: permanently remove all ${totalInventory.toLocaleString()} voucher document(s).`,
      )
    )
      return
    deleteAllMutation.mutate(undefined)
  }, [deleteAllMutation, totalInventory])

  const confirmDeleteForPackage = React.useCallback(() => {
    if (packageFilter === "all" || packageFilter === "unassigned") return
    const pkg = packageOptions.find((p) => p.id === packageFilter)
    const count = pkg?.count ?? vouchersQuery.data?.total ?? 0
    const label = selectedPackageLabel ?? "this package"
    if (
      !window.confirm(
        `Delete all vouchers assigned to ${label}? This removes ${count.toLocaleString()} voucher(s) from the database. This cannot be undone.`,
      )
    ) {
      return
    }
    deleteAllMutation.mutate({ packageId: packageFilter })
  }, [deleteAllMutation, packageFilter, packageOptions, vouchersQuery.data?.total, selectedPackageLabel])

  const list = vouchersQuery.data?.vouchers ?? []
  const filteredTotal = vouchersQuery.data?.total ?? 0
  const totalPages = Math.max(1, vouchersQuery.data?.totalPages ?? 1)

  React.useEffect(() => {
    if (vouchersQuery.isFetching) return
    const serverPage = vouchersQuery.data?.page
    if (typeof serverPage === "number" && serverPage >= 1 && serverPage !== page) {
      setPage(serverPage)
    }
  }, [page, vouchersQuery.isFetching, vouchersQuery.data?.page])

  const safePage = Number.isFinite(page) && page >= 1 ? page : 1
  const pageIndex = Math.max(0, safePage - 1)

  const emptyFilterMessage =
    list.length === 0 && filteredTotal === 0 && !vouchersQuery.isLoading
      ? totalInventory > 0
        ? debouncedSearch
          ? `No vouchers match "${debouncedSearch}". Try another search or clear filters.`
          : "No vouchers match the current filters."
        : undefined
      : undefined

  const clearSearch = React.useCallback(() => {
    setSearch("")
    setDebouncedSearch("")
    setPage(1)
  }, [])

  const searchPending = search.trim() !== debouncedSearch

  const canDeletePackageScope = packageFilter !== "all" && packageFilter !== "unassigned"

  const goToFirstPage = React.useCallback(() => setPage(1), [])
  const goToLastPage = React.useCallback(() => setPage(totalPages), [totalPages])

  const serverPagination = React.useMemo(
    () => ({
      pageIndex,
      pageCount: totalPages,
      total: filteredTotal,
      pageSize,
      isLoading: vouchersQuery.isFetching,
      onPageIndexChange: (index) => {
        const nextIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
        setPage(Math.min(totalPages, nextIndex + 1))
      },
      onGoToFirstPage: goToFirstPage,
      onGoToLastPage: goToLastPage,
      onPageSizeChange: (size) => setPageSize(size),
    }),
    [pageIndex, totalPages, filteredTotal, pageSize, vouchersQuery.isFetching, goToFirstPage, goToLastPage],
  )

  return (
    <div className="w-full min-w-0 space-y-3">
      <PageHeader
        title="Uploaded vouchers"
        description="Filter by package and status, or search voucher IDs and column values across the full inventory."
      />

      <Card className="border-border bg-card w-full min-w-0 gap-2 py-2 shadow-none ring-1 ring-border">
        <CardContent className="w-full min-w-0 space-y-2 px-3 pb-3 pt-1 sm:px-4">
          {isAdmin ? (
            <>
              <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search as you type — voucher ID, location, package, policy…"
                  className="border-border bg-card h-8 flex-1 shadow-none"
                  aria-label="Search vouchers"
                />
                {search.trim() ? (
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={clearSearch}>
                    Clear
                  </Button>
                ) : null}
              </div>
              {search.trim() || debouncedSearch ? (
                <p className="text-muted-foreground text-xs">
                  {searchPending || vouchersQuery.isFetching ? (
                    <span>Searching…</span>
                  ) : debouncedSearch ? (
                    <>
                      Results for{" "}
                      <span className="text-foreground font-medium">&quot;{debouncedSearch}&quot;</span>
                      {filteredTotal > 0 ? (
                        <>
                          {" "}
                          · <span className="text-foreground font-medium">{filteredTotal.toLocaleString()}</span>{" "}
                          match{filteredTotal === 1 ? "" : "es"}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </p>
              ) : null}
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
                            {typeof p.count === "number" ? ` (${p.count.toLocaleString()})` : ""}
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
                  {filteredTotal > 0 || totalInventory > 0 ? (
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {filteredTotal.toLocaleString()} match
                      {packageFilter !== "all" || statusFilter !== "all"
                        ? ` · ${totalInventory.toLocaleString()} total in inventory`
                        : ""}
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
                      totalInventory === 0 ||
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
              {vouchersQuery.isLoading && !vouchersQuery.data ? (
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
                    vouchers={list}
                    emptyMessage={emptyFilterMessage}
                    onDelete={confirmDelete}
                    deletingId={
                      deleteMutation.isPending && typeof deleteMutation.variables === "string"
                        ? deleteMutation.variables
                        : null
                    }
                    serverPagination={serverPagination}
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
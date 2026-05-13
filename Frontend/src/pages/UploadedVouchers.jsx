import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
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
import { fetchVouchers } from "@/lib/api.js"
import { ROLE_ADMIN } from "@/lib/roles.js"

/** @typedef {"all" | "unused" | "used"} StatusFilter */

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

export default function UploadedVouchers() {
  const { token, user, authReady } = useAuth()
  const isAdmin = user?.role === ROLE_ADMIN
  const [statusFilter, setStatusFilter] = React.useState(/** @type {StatusFilter} */ ("all"))

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

  const filteredVouchers = React.useMemo(() => {
    const list = vouchersQuery.data ?? []
    if (statusFilter === "all") return list
    return list.filter((v) => voucherMatchesStatusFilter(v, statusFilter))
  }, [vouchersQuery.data, statusFilter])

  const totalCount = vouchersQuery.data?.length ?? 0
  const emptyFilterMessage =
    filteredVouchers.length === 0 && totalCount > 0 ? "No vouchers match this status filter." : undefined

  return (
    <div className="w-full min-w-0 space-y-3">
      <PageHeader title="Uploaded vouchers" />

      <Card className="border-border bg-card w-full min-w-0 gap-2 py-2 shadow-none ring-1 ring-border">
        <CardContent className="w-full min-w-0 space-y-2 px-3 pb-3 pt-1 sm:px-4">
          {isAdmin ? (
            <>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Label htmlFor="voucher-status-filter" className="text-muted-foreground shrink-0 text-xs font-medium">
                    Status
                  </Label>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === "used" || v === "unused" ? v : "all")}>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full shrink-0 text-xs sm:w-auto"
                  onClick={() => void vouchersQuery.refetch()}
                  disabled={vouchersQuery.isFetching}
                >
                  {vouchersQuery.isFetching ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
              {vouchersQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">Loading vouchers from server…</p>
              ) : vouchersQuery.isError ? (
                <p className="text-destructive text-sm">
                  {vouchersQuery.error instanceof Error ? vouchersQuery.error.message : "Could not load vouchers."}
                </p>
              ) : (
                <ServerVouchersTable vouchers={filteredVouchers} emptyMessage={emptyFilterMessage} />
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

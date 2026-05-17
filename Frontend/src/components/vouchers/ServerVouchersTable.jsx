import * as React from "react"
import { ChevronsLeft, ChevronsRight, Trash2 } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isHiddenVoucherThroughputColumnKey } from "@/lib/voucherColumnDisplay.js"

const MAX_SERVER_COLUMN_KEYS = 28
const COLUMN_KEY_SAMPLE_SIZE = 150
const DEFAULT_PAGE_SIZE = 25

/**
 * @param {string} k
 */
function isRedundantVoucherIdKey(k) {
  const normalized = String(k).replace(/·/g, ".").trim()
  return /^voucher\s*id$/i.test(normalized)
}

/**
 * @param {Array<{ columns?: Record<string, string> }>} vouchers
 */
function dynamicColumnKeys(vouchers) {
  const s = new Set()
  const sample = vouchers.slice(0, COLUMN_KEY_SAMPLE_SIZE)
  for (const v of sample) {
    if (!v?.columns || typeof v.columns !== "object") continue
    for (const k of Object.keys(v.columns)) {
      if (isRedundantVoucherIdKey(k)) continue
      if (isHiddenVoucherThroughputColumnKey(k)) continue
      s.add(k)
      if (s.size >= MAX_SERVER_COLUMN_KEYS) return [...s].sort((a, b) => a.localeCompare(b))
    }
  }
  return [...s].sort((a, b) => a.localeCompare(b))
}

/**
 * @param {{ uploadedAt?: string }} v
 */
function formatUploadedAt(v) {
  return typeof v.uploadedAt === "string" ? v.uploadedAt.slice(0, 19).replace("T", " ") : "—"
}

/** @param {{ id: string, documentId?: string }} v */
function voucherRowKey(v) {
  return v.documentId ?? v.id
}

/** @param {{ locationName?: string, locationId?: string }} v */
function locationLabel(v) {
  const n = typeof v.locationName === "string" && v.locationName.trim() ? v.locationName.trim() : ""
  if (n) return n
  const id = typeof v.locationId === "string" && v.locationId.trim() ? v.locationId.trim() : ""
  return id || "—"
}

/** @param {{ packageName?: string, packageId?: string }} v */
function packageLabel(v) {
  const n = typeof v.packageName === "string" && v.packageName.trim() ? v.packageName.trim() : ""
  if (n) return n
  const id = typeof v.packageId === "string" && v.packageId.trim() ? v.packageId.trim() : ""
  return id || "—"
}

/**
 * @param {{
 *   voucher: {
 *     id: string
 *     documentId?: string
 *     columns?: Record<string, string>
 *     uploadedAt?: string
 *     locationId?: string
 *     locationName?: string
 *     packageId?: string
 *     packageName?: string
 *   }
 *   columnKeys: string[]
 *   onDelete?: (voucher: { id: string, documentId?: string }) => void
 *   deletingId?: string | null
 * }} props
 */
const VoucherMobileCard = React.memo(function VoucherMobileCard({ voucher, columnKeys, onDelete, deletingId }) {
  const uploaded = formatUploadedAt(voucher)
  const rowKey = voucherRowKey(voucher)

  return (
    <div
      role="listitem"
      className="border-border bg-card overflow-hidden rounded-lg border shadow-none"
    >
      <div className="border-border/80 bg-muted/15 border-b px-4 py-3">
        <p className="text-foreground text-base font-semibold leading-snug tracking-tight tabular-nums break-all">
          {voucher.id}
        </p>
        {uploaded !== "—" ? (
          <p className="text-muted-foreground mt-1.5 text-sm font-normal leading-relaxed break-words">
            Uploaded · {uploaded}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-1.5 text-sm font-normal leading-relaxed break-words">
          Location · {locationLabel(voucher)}
        </p>
        <p className="text-muted-foreground mt-1.5 text-sm font-normal leading-relaxed break-words">
          Package · {packageLabel(voucher)}
        </p>
      </div>
      <div className="divide-border/60 divide-y px-4 py-1">
        {columnKeys.map((k) => (
          <div key={k} className="flex items-start justify-between gap-4 py-2.5 first:pt-2 last:pb-2">
            <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide uppercase">{k}</span>
            <span className="text-foreground max-w-[58%] min-w-0 text-right text-sm font-medium leading-snug break-words">
              {voucher.columns?.[k] ?? "—"}
            </span>
          </div>
        ))}
      </div>
      {onDelete ? (
        <div className="border-border flex justify-end border-t px-4 py-2">
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="size-8 shrink-0"
            disabled={deletingId === rowKey}
            onClick={() => onDelete(voucher)}
            aria-label={`Delete voucher ${voucher.id}`}
            title="Delete voucher"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  )
})

/**
 * @param {{
 *   voucher: {
 *     id: string
 *     documentId?: string
 *     columns?: Record<string, string>
 *     uploadedAt?: string
 *     locationId?: string
 *     locationName?: string
 *     packageId?: string
 *     packageName?: string
 *   }
 *   columnKeys: string[]
 *   onDelete?: (voucher: { id: string, documentId?: string }) => void
 *   deletingId?: string | null
 * }} props
 */
const VoucherTableRow = React.memo(function VoucherTableRow({ voucher, columnKeys, onDelete, deletingId }) {
  const rowKey = voucherRowKey(voucher)

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap px-2 font-medium tabular-nums">{voucher.id}</TableCell>
      <TableCell className="max-w-[10rem] truncate px-2 text-sm" title={locationLabel(voucher)}>
        {locationLabel(voucher)}
      </TableCell>
      <TableCell className="max-w-[10rem] truncate px-2 text-sm" title={packageLabel(voucher)}>
        {packageLabel(voucher)}
      </TableCell>
      {columnKeys.map((k) => (
        <TableCell key={k} className="max-w-[12rem] truncate px-2 sm:max-w-[220px]" title={voucher.columns?.[k] ?? ""}>
          {voucher.columns?.[k] ?? "—"}
        </TableCell>
      ))}
      <TableCell className="text-muted-foreground whitespace-nowrap px-2 text-xs tabular-nums">
        {formatUploadedAt(voucher)}
      </TableCell>
      {onDelete ? (
        <TableCell className="px-2 text-right">
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="size-8 shrink-0"
            disabled={deletingId === rowKey}
            onClick={() => onDelete(voucher)}
            aria-label={`Delete voucher ${voucher.id}`}
            title="Delete voucher"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </TableCell>
      ) : null}
    </TableRow>
  )
})

/**
 * @param {{
 *   vouchers: Array<{
 *     id: string
 *     documentId?: string
 *     columns?: Record<string, string>
 *     uploadedAt?: string
 *     locationId?: string
 *     locationName?: string
 *     packageId?: string
 *     packageName?: string
 *   }>
 *   emptyMessage?: string
 *   onDelete?: (voucher: { id: string, documentId?: string }) => void
 *   deletingId?: string | null
 *   serverPagination?: {
 *     pageIndex: number
 *     pageCount: number
 *     total: number
 *     pageSize: number
 *     onPageIndexChange: (index: number) => void
 *     onPageSizeChange: (size: number) => void
 *   }
 * }} props
 */
function ServerVouchersTableInner({ vouchers, emptyMessage, onDelete, deletingId, serverPagination }) {
  const [clientPageIndex, setClientPageIndex] = React.useState(0)
  const [clientPageSize, setClientPageSize] = React.useState(DEFAULT_PAGE_SIZE)

  const columnKeys = React.useMemo(() => dynamicColumnKeys(vouchers), [vouchers])

  const pageIndex = serverPagination?.pageIndex ?? clientPageIndex
  const pageSize = serverPagination?.pageSize ?? clientPageSize
  const setPageIndex = serverPagination?.onPageIndexChange ?? setClientPageIndex
  const setPageSize = serverPagination?.onPageSizeChange ?? setClientPageSize

  const pageCount = serverPagination?.pageCount ?? Math.max(1, Math.ceil(vouchers.length / pageSize))
  const totalCount = serverPagination?.total ?? vouchers.length

  React.useEffect(() => {
    if (serverPagination) return
    setClientPageIndex(0)
  }, [vouchers, clientPageSize, serverPagination])

  React.useEffect(() => {
    if (serverPagination) return
    if (clientPageIndex > pageCount - 1) {
      setClientPageIndex(Math.max(0, pageCount - 1))
    }
  }, [clientPageIndex, pageCount, serverPagination])

  const pageStart = pageIndex * pageSize
  const clientPageVouchers = React.useMemo(
    () => vouchers.slice(pageStart, pageStart + pageSize),
    [vouchers, pageStart, pageSize],
  )
  const pageVouchers = serverPagination ? vouchers : clientPageVouchers

  if (!vouchers.length && totalCount === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-6 text-center text-sm">
        {emptyMessage ??
          "No vouchers stored yet. Use Upload vouchers in the sidebar, import a CSV, then open Uploaded vouchers."}
      </p>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs tabular-nums">
          {totalCount.toLocaleString()} voucher{totalCount === 1 ? "" : "s"}
          {totalCount > pageSize
            ? ` · showing ${pageStart + 1}–${Math.min(pageStart + pageSize, totalCount)}`
            : null}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="h-8 w-[5.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-muted-foreground hidden px-0.5 text-xs md:block">
        Swipe horizontally to see all columns. Only one page of rows is rendered at a time for performance.
      </p>

      <div className="space-y-3 md:hidden" role="list" aria-label="Voucher list">
        {pageVouchers.map((v) => (
          <VoucherMobileCard
            key={voucherRowKey(v)}
            voucher={v}
            columnKeys={columnKeys}
            onDelete={onDelete}
            deletingId={deletingId}
          />
        ))}
      </div>

      <div
        className="hidden max-h-[min(70vh,85dvh)] w-full min-w-0 overflow-auto overscroll-x-contain rounded-lg border border-border [-webkit-overflow-scrolling:touch] md:block"
        role="region"
        aria-label="Voucher data table"
      >
        <Table className="w-max min-w-full text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap px-2">Voucher ID</TableHead>
              <TableHead className="whitespace-nowrap px-2">Location</TableHead>
              <TableHead className="whitespace-nowrap px-2">Package</TableHead>
              {columnKeys.map((k) => (
                <TableHead key={k} className="whitespace-nowrap px-2 sm:max-w-[200px]">
                  {k}
                </TableHead>
              ))}
              <TableHead className="whitespace-nowrap px-2">Uploaded</TableHead>
              {onDelete ? (
                <TableHead className="text-foreground w-[4.5rem] whitespace-nowrap px-2 text-right">Actions</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageVouchers.map((v) => (
              <VoucherTableRow
                key={voucherRowKey(v)}
                voucher={v}
                columnKeys={columnKeys}
                onDelete={onDelete}
                deletingId={deletingId}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Page {pageIndex + 1} of {pageCount}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => setPageIndex(0)}
            disabled={pageIndex === 0}
            aria-label="First page"
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={pageIndex === 0}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
            disabled={pageIndex >= pageCount - 1}
          >
            Next
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => setPageIndex(pageCount - 1)}
            disabled={pageIndex >= pageCount - 1}
            aria-label="Last page"
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export const ServerVouchersTable = React.memo(ServerVouchersTableInner)

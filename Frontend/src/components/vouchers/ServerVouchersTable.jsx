import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { isHiddenVoucherThroughputColumnKey } from "@/lib/voucherColumnDisplay.js"

const MAX_SERVER_COLUMN_KEYS = 28

/**
 * Column keys that duplicate the document id already shown in the first column.
 * Stored `columns` still includes the CSV "Voucher ID" field from import.
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
  for (const v of vouchers) {
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

/**
 * @param {{
 *   vouchers: Array<{
 *     id: string
 *     columns?: Record<string, string>
 *     uploadedAt?: string
 *     locationId?: string
 *     locationName?: string
 *   }>
 *   emptyMessage?: string
 *   onDelete?: (id: string) => void
 *   deletingId?: string | null
 * }} props
 */
export function ServerVouchersTable({ vouchers, emptyMessage, onDelete, deletingId }) {
  if (!vouchers.length) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-6 text-center text-sm">
        {emptyMessage ??
          "No vouchers stored yet. Use Upload vouchers in the sidebar, import a CSV, then open Uploaded vouchers."}
      </p>
    )
  }
  const keys = dynamicColumnKeys(vouchers)

  /** @param {{ locationName?: string, locationId?: string }} v */
  function locationLabel(v) {
    const n = typeof v.locationName === "string" && v.locationName.trim() ? v.locationName.trim() : ""
    if (n) return n
    const id = typeof v.locationId === "string" && v.locationId.trim() ? v.locationId.trim() : ""
    return id || "—"
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      <p className="text-muted-foreground hidden px-0.5 text-xs md:block">
        Swipe horizontally to see all columns.
      </p>

      {/* Mobile: card rows (matches Packages / DataTable pattern) */}
      <div className="space-y-3 md:hidden" role="list" aria-label="Voucher list">
        {vouchers.map((v) => {
          const uploaded = formatUploadedAt(v)
          return (
            <div
              key={v.id}
              role="listitem"
              className="border-border bg-card overflow-hidden rounded-lg border shadow-none"
            >
              <div className="border-border/80 bg-muted/15 border-b px-4 py-3">
                <p className="text-foreground text-base font-semibold leading-snug tracking-tight tabular-nums break-all">
                  {v.id}
                </p>
                {uploaded !== "—" ? (
                  <p className="text-muted-foreground mt-1.5 text-sm font-normal leading-relaxed break-words">
                    Uploaded · {uploaded}
                  </p>
                ) : null}
                <p className="text-muted-foreground mt-1.5 text-sm font-normal leading-relaxed break-words">
                  Location · {locationLabel(v)}
                </p>
              </div>
              <div className="divide-border/60 divide-y px-4 py-1">
                {keys.map((k) => (
                  <div
                    key={k}
                    className="flex items-start justify-between gap-4 py-2.5 first:pt-2 last:pb-2"
                  >
                    <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide uppercase">
                      {k}
                    </span>
                    <span className="text-foreground max-w-[58%] min-w-0 text-right text-sm font-medium leading-snug break-words">
                      {v.columns?.[k] ?? "—"}
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
                    disabled={deletingId === v.id}
                    onClick={() => onDelete(v.id)}
                    aria-label={`Delete voucher ${v.id}`}
                    title="Delete voucher"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Desktop: scrollable table */}
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
              {keys.map((k) => (
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
            {vouchers.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="whitespace-nowrap px-2 font-medium tabular-nums">{v.id}</TableCell>
                <TableCell className="max-w-[10rem] truncate px-2 text-sm" title={locationLabel(v)}>
                  {locationLabel(v)}
                </TableCell>
                {keys.map((k) => (
                  <TableCell key={k} className="max-w-[12rem] truncate px-2 sm:max-w-[220px]" title={v.columns?.[k] ?? ""}>
                    {v.columns?.[k] ?? "—"}
                  </TableCell>
                ))}
                <TableCell className="text-muted-foreground whitespace-nowrap px-2 text-xs tabular-nums">
                  {formatUploadedAt(v)}
                </TableCell>
                {onDelete ? (
                  <TableCell className="px-2 text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="size-8 shrink-0"
                      disabled={deletingId === v.id}
                      onClick={() => onDelete(v.id)}
                      aria-label={`Delete voucher ${v.id}`}
                      title="Delete voucher"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

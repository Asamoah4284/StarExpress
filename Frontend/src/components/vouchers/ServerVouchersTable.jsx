import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
 *   vouchers: Array<{ id: string, columns?: Record<string, string>, uploadedAt?: string }>
 *   emptyMessage?: string
 * }} props
 */
export function ServerVouchersTable({ vouchers, emptyMessage }) {
  if (!vouchers.length) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-6 text-center text-sm">
        {emptyMessage ??
          "No vouchers stored yet. Use Upload vouchers in the sidebar, import a CSV, then open Uploaded vouchers."}
      </p>
    )
  }
  const keys = dynamicColumnKeys(vouchers)

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
              {keys.map((k) => (
                <TableHead key={k} className="whitespace-nowrap px-2 sm:max-w-[200px]">
                  {k}
                </TableHead>
              ))}
              <TableHead className="whitespace-nowrap px-2">Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vouchers.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="whitespace-nowrap px-2 font-medium tabular-nums">{v.id}</TableCell>
                {keys.map((k) => (
                  <TableCell key={k} className="max-w-[12rem] truncate px-2 sm:max-w-[220px]" title={v.columns?.[k] ?? ""}>
                    {v.columns?.[k] ?? "—"}
                  </TableCell>
                ))}
                <TableCell className="text-muted-foreground whitespace-nowrap px-2 text-xs tabular-nums">
                  {formatUploadedAt(v)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

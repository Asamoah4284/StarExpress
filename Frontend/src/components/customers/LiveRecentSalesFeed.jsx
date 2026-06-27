import * as React from "react"
import { ShoppingBag, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatGhanaPhoneDisplayLocal } from "@/lib/ghanaPhone.js"
import { formatSaleDateTime } from "@/lib/dates.js"
import { cn, formatCedis } from "@/lib/utils"

/**
 * @param {{
 *   sales: object[],
 *   highlightIds?: string[],
 *   pulseKey?: number,
 * }} props
 */
export function LiveRecentSalesFeed({ sales, highlightIds = [], pulseKey = 0 }) {
  const listRef = React.useRef(/** @type {HTMLUListElement | null} */ (null))
  const prevPulseRef = React.useRef(pulseKey)

  React.useEffect(() => {
    if (pulseKey > prevPulseRef.current && listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: "smooth" })
    }
    prevPulseRef.current = pulseKey
  }, [pulseKey])

  return (
    <Card
      className={cn(
        "border-border/80 overflow-hidden shadow-none ring-1 ring-border transition-[box-shadow] duration-500",
        pulseKey > 0 && highlightIds.length > 0 && "ring-success/40 ring-2",
      )}
    >
      <CardHeader className="border-border/60 flex flex-row items-start justify-between gap-3 border-b pb-3">
        <div className="flex items-start gap-2">
          <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Zap className="size-4" aria-hidden />
          </div>
          <div>
            <CardTitle className="text-base">Live sales</CardTitle>
            <CardDescription className="text-xs">New purchases appear here instantly</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {sales.length === 0 ? (
          <p className="text-muted-foreground px-5 py-10 text-center text-sm">Waiting for the next sale…</p>
        ) : (
          <ul ref={listRef} className="max-h-[320px] divide-y overflow-y-auto">
            {sales.map((sale) => {
              const id = String(sale.id)
              const isNew = highlightIds.includes(id)
              const phone = sale.customerPhone
                ? formatGhanaPhoneDisplayLocal(sale.customerPhone)
                : sale.customerName || "—"
              return (
                <li
                  key={id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors sm:px-5",
                    isNew && "animate-sale-flash",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      isNew ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <ShoppingBag className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold tabular-nums">{phone}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {sale.packageType || "WiFi bundle"}
                      {isNew ? (
                        <span className="text-emerald-600 dark:text-emerald-400 ml-1.5 font-medium">· Just now</span>
                      ) : (
                        <> · {formatSaleDateTime(sale.soldAt, sale.date)}</>
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums">{formatCedis(Number(sale.amount) || 0)}</p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

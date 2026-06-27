import * as React from "react"
import { filterSalesByLocation } from "@/lib/aggregations.js"
import { playLiveSaleBeep } from "@/lib/liveSaleNotify.js"

export const LIVE_POLL_MS = 4000

/**
 * Tracks new completed sales in scope and fires beep + pulse when live data changes.
 * @param {{
 *   sales: object[] | undefined,
 *   locationId: string,
 *   customerTotal: number,
 *   enabled?: boolean,
 * }} options
 */
export function useLiveCustomerDashboard({ sales, locationId, customerTotal, enabled = true }) {
  const seenSaleIdsRef = React.useRef(new Set())
  const initRef = React.useRef(false)
  const prevCustomerTotalRef = React.useRef(/** @type {number | null} */ (null))
  const [pulseKey, setPulseKey] = React.useState(0)
  const [highlightSaleIds, setHighlightSaleIds] = React.useState(/** @type {string[]} */ ([]))
  const [lastUpdated, setLastUpdated] = React.useState(/** @type {Date | null} */ (null))

  const recentSales = React.useMemo(() => {
    const rows = (sales ?? []).filter((s) => s.status === "Completed")
    const scoped = filterSalesByLocation(rows, locationId)
    return [...scoped].sort((a, b) => {
      const ta = a.soldAt || `${a.date}T00:00:00`
      const tb = b.soldAt || `${b.date}T00:00:00`
      return ta < tb ? 1 : ta > tb ? -1 : 0
    })
  }, [sales, locationId])

  React.useEffect(() => {
    if (!enabled) return

    if (!initRef.current) {
      recentSales.forEach((s) => seenSaleIdsRef.current.add(String(s.id)))
      prevCustomerTotalRef.current = customerTotal
      initRef.current = true
      setLastUpdated(new Date())
      return
    }

    const fresh = recentSales.filter((s) => !seenSaleIdsRef.current.has(String(s.id)))
    fresh.forEach((s) => seenSaleIdsRef.current.add(String(s.id)))

    const customerGrew =
      prevCustomerTotalRef.current != null && customerTotal > prevCustomerTotalRef.current
    prevCustomerTotalRef.current = customerTotal

    if (fresh.length === 0 && !customerGrew) return

    playLiveSaleBeep(fresh.length > 0 ? fresh.length : 1)
    setPulseKey((k) => k + 1)
    setLastUpdated(new Date())

    if (fresh.length > 0) {
      const ids = fresh.map((s) => String(s.id))
      setHighlightSaleIds(ids)
      const clear = window.setTimeout(() => setHighlightSaleIds([]), 4500)
      return () => window.clearTimeout(clear)
    }
  }, [recentSales, customerTotal, enabled])

  const markRefreshed = React.useCallback(() => {
    setLastUpdated(new Date())
  }, [])

  return {
    recentSales: recentSales.slice(0, 10),
    pulseKey,
    highlightSaleIds,
    lastUpdated,
    markRefreshed,
  }
}

/**
 * Detects new sales in a filtered list (e.g. sales history) and highlights them live.
 * @param {{
 *   sales: object[],
 *   scopeKey: string,
 *   enabled?: boolean,
 * }} options
 */
export function useLiveSales({ sales, scopeKey, enabled = true }) {
  const seenSaleIdsRef = React.useRef(new Set())
  const initRef = React.useRef(false)
  const scopeRef = React.useRef(scopeKey)
  const [pulseKey, setPulseKey] = React.useState(0)
  const [highlightSaleIds, setHighlightSaleIds] = React.useState(/** @type {string[]} */ ([]))
  const [lastUpdated, setLastUpdated] = React.useState(/** @type {Date | null} */ (null))

  React.useEffect(() => {
    if (scopeRef.current === scopeKey) return
    scopeRef.current = scopeKey
    seenSaleIdsRef.current = new Set()
    initRef.current = false
    setHighlightSaleIds([])
  }, [scopeKey])

  React.useEffect(() => {
    if (!enabled) return

    if (!initRef.current) {
      sales.forEach((s) => seenSaleIdsRef.current.add(String(s.id)))
      initRef.current = true
      setLastUpdated(new Date())
      return
    }

    const fresh = sales.filter((s) => !seenSaleIdsRef.current.has(String(s.id)))
    fresh.forEach((s) => seenSaleIdsRef.current.add(String(s.id)))

    if (fresh.length === 0) return

    playLiveSaleBeep(fresh.length)
    setPulseKey((k) => k + 1)
    setLastUpdated(new Date())
    const ids = fresh.map((s) => String(s.id))
    setHighlightSaleIds(ids)
    const clear = window.setTimeout(() => setHighlightSaleIds([]), 4500)
    return () => window.clearTimeout(clear)
  }, [sales, enabled])

  const markRefreshed = React.useCallback(() => {
    setLastUpdated(new Date())
  }, [])

  return { pulseKey, highlightSaleIds, lastUpdated, markRefreshed }
}

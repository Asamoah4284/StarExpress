import { ghanaPhoneDedupeKey } from "@/lib/ghanaPhone.js"

export const INACTIVE_THRESHOLD_DAYS = 8
export const NEW_BUYER_LOOKBACK_DAYS = 1

/**
 * @param {{
 *   purchases?: number,
 *   activeDays?: number,
 *   firstPurchase?: string,
 *   lastPurchase?: string,
 * }} customer
 * @param {{ lookbackDays?: number, now?: Date }} [options]
 */
export function isNewBuyer(customer, options = {}) {
  const lookbackDays = options.lookbackDays ?? NEW_BUYER_LOOKBACK_DAYS
  const now = options.now ?? new Date()
  if ((customer.purchases ?? 0) !== 1) return false
  if ((customer.activeDays ?? 0) !== 1) return false
  const firstSeen = customer.firstPurchase || customer.lastPurchase || ""
  const daysSinceFirst = daysSincePurchase(firstSeen, now)
  if (daysSinceFirst == null) return false
  return daysSinceFirst <= lookbackDays
}

/**
 * @param {ReturnType<typeof enrichCustomerRow>[]} customers
 * @param {number} [topCount]
 * @param {{ lookbackDays?: number, now?: Date }} [options]
 */
export function pickNewBuyersOutsideTop(customers, topCount = 5, options = {}) {
  const now = options.now ?? new Date()
  const topKeys = new Set(
    customers.slice(0, topCount).map((c) => ghanaPhoneDedupeKey(c.phone)).filter(Boolean),
  )
  return customers
    .filter((c) => isNewBuyer(c, options) && !topKeys.has(ghanaPhoneDedupeKey(c.phone)))
    .sort((a, b) => {
      const daysA = daysSincePurchase(a.firstPurchase || a.lastPurchase || "", now) ?? 999
      const daysB = daysSincePurchase(b.firstPurchase || b.lastPurchase || "", now) ?? 999
      if (daysA !== daysB) return daysA - daysB
      const ta = a.firstPurchase || a.lastPurchase || ""
      const tb = b.firstPurchase || b.lastPurchase || ""
      return tb.localeCompare(ta)
    })
}

/**
 * @param {string} firstPurchase
 * @param {Date} [now]
 */
export function formatFirstSeenLabel(firstPurchase, now = new Date()) {
  const days = daysSincePurchase(firstPurchase, now)
  if (days == null) return "Unknown"
  if (days === 0) return "First seen today"
  if (days === 1) return "First seen yesterday"
  return `First seen ${days} days ago`
}

/**
 * @param {string} isoOrDate
 * @param {Date} [now]
 * @returns {number | null}
 */
export function daysSincePurchase(isoOrDate, now = new Date()) {
  if (!isoOrDate || typeof isoOrDate !== "string") return null
  const day = isoOrDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const last = new Date(`${day}T00:00:00.000Z`)
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
  const diffMs = today.getTime() - last.getTime()
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)))
}

/**
 * @param {number} purchases
 * @param {number | null} daysSinceLastPurchase
 * @param {number} [thresholdDays]
 * @returns {"active" | "inactive" | "one_time" | "repeat"}
 */
export function deriveCustomerSegment(purchases, daysSinceLastPurchase, thresholdDays = INACTIVE_THRESHOLD_DAYS) {
  const isInactive =
    daysSinceLastPurchase != null && Number.isFinite(daysSinceLastPurchase) && daysSinceLastPurchase >= thresholdDays
  if (isInactive) return "inactive"
  if (purchases <= 1) return "one_time"
  return "repeat"
}

/**
 * @param {string} firstPurchase
 * @param {string} lastPurchase
 * @param {number} purchases
 * @returns {number | null}
 */
export function avgDaysBetweenPurchases(firstPurchase, lastPurchase, purchases) {
  if (purchases < 2) return null
  const firstDays = daysSincePurchase(firstPurchase)
  const lastDays = daysSincePurchase(lastPurchase)
  if (firstDays == null || lastDays == null) return null
  const tenureDays = Math.max(0, firstDays - lastDays)
  return Math.round((tenureDays / (purchases - 1)) * 10) / 10
}

/**
 * @param {{
 *   phone: string,
 *   purchases: number,
 *   totalSpent: number,
 *   firstPurchase?: string,
 *   lastPurchase: string,
 *   activeDays: number,
 *   daysSinceLastPurchase?: number | null,
 *   avgDaysBetweenPurchases?: number | null,
 *   segment?: string,
 * }} row
 * @param {Date} [now]
 */
export function enrichCustomerRow(row, now = new Date()) {
  const firstPurchase = row.firstPurchase || row.lastPurchase || ""
  const lastPurchase = row.lastPurchase || ""
  const daysSinceLastPurchase =
    row.daysSinceLastPurchase != null ? row.daysSinceLastPurchase : daysSincePurchase(lastPurchase, now)
  const segment = row.segment || deriveCustomerSegment(row.purchases, daysSinceLastPurchase)
  return {
    phone: row.phone,
    purchases: row.purchases,
    totalSpent: row.totalSpent,
    firstPurchase,
    lastPurchase,
    activeDays: row.activeDays,
    daysSinceLastPurchase,
    avgDaysBetweenPurchases:
      row.avgDaysBetweenPurchases != null
        ? row.avgDaysBetweenPurchases
        : avgDaysBetweenPurchases(firstPurchase, lastPurchase, row.purchases),
    segment,
    ...(typeof row.displayName === "string" && row.displayName.trim()
      ? { displayName: row.displayName.trim() }
      : {}),
  }
}

/**
 * @param {ReturnType<typeof enrichCustomerRow>[]} customers
 * @param {number} [thresholdDays]
 */
export function summarizeCustomers(customers, thresholdDays = INACTIVE_THRESHOLD_DAYS) {
  let active = 0
  let inactive = 0
  let repeat = 0
  let oneTime = 0
  for (const c of customers) {
    if (c.purchases >= 2) repeat += 1
    if (c.purchases <= 1) oneTime += 1
    if (c.segment === "inactive") inactive += 1
    else active += 1
  }
  return {
    total: customers.length,
    active,
    inactive,
    repeat,
    oneTime,
    inactiveThresholdDays: thresholdDays,
  }
}

/**
 * @param {number | null | undefined} days
 */
export function formatDaysSinceLastPurchase(days) {
  if (days == null || !Number.isFinite(days)) return "Unknown"
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}

/**
 * @param {string} segment
 */
export function segmentLabel(segment) {
  switch (segment) {
    case "inactive":
      return "Inactive"
    case "repeat":
      return "Repeat"
    case "one_time":
      return "One-time"
    default:
      return "Active"
  }
}

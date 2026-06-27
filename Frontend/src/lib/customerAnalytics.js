export const INACTIVE_THRESHOLD_DAYS = 5

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

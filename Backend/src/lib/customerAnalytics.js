import { formatGhanaPhoneLocal, ghanaPhoneDedupeKey } from "./ghanaPhone.js"
import { roundMoney } from "./promoDiscount.js"

/** @typedef {"active" | "inactive" | "one_time" | "repeat"} CustomerSegment */

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
 * @returns {CustomerSegment}
 */
export function deriveCustomerSegment(purchases, daysSinceLastPurchase, thresholdDays = INACTIVE_THRESHOLD_DAYS) {
  const isInactive =
    daysSinceLastPurchase != null && Number.isFinite(daysSinceLastPurchase) && daysSinceLastPurchase >= thresholdDays
  if (isInactive) return "inactive"
  if (purchases <= 1) return "one_time"
  return purchases >= 2 ? "repeat" : "one_time"
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
 * Collapse sale docs into one row per real buyer with analytics fields.
 * @param {import("mongodb").Document[]} saleDocs
 * @param {{ thresholdDays?: number, now?: Date }} [options]
 * @returns {{
 *   phone: string,
 *   purchases: number,
 *   totalSpent: number,
 *   firstPurchase: string,
 *   lastPurchase: string,
 *   activeDays: number,
 *   daysSinceLastPurchase: number | null,
 *   avgDaysBetweenPurchases: number | null,
 *   segment: CustomerSegment,
 * }[]}
 */
export function aggregateCustomers(saleDocs, options = {}) {
  const thresholdDays = options.thresholdDays ?? INACTIVE_THRESHOLD_DAYS
  const now = options.now ?? new Date()

  /** @type {Map<string, { phone: string, purchases: number, totalSpent: number, firstPurchase: string, lastPurchase: string, days: Set<string> }>} */
  const byKey = new Map()
  for (const sale of saleDocs) {
    const raw = typeof sale.customerPhone === "string" ? sale.customerPhone.trim() : ""
    if (!raw) continue
    const key = ghanaPhoneDedupeKey(raw)
    if (!key || key.length < 7) continue
    const localPhone = formatGhanaPhoneLocal(raw)
    if (!localPhone) continue
    const amount = Number(sale.amount)
    const soldAt =
      typeof sale.soldAt === "string" && sale.soldAt
        ? sale.soldAt
        : typeof sale.date === "string"
          ? sale.date
          : ""
    const day = soldAt ? soldAt.slice(0, 10) : ""
    const existing = byKey.get(key)
    if (existing) {
      existing.purchases += 1
      if (Number.isFinite(amount)) existing.totalSpent += amount
      if (soldAt) {
        if (!existing.firstPurchase || soldAt < existing.firstPurchase) existing.firstPurchase = soldAt
        if (!existing.lastPurchase || soldAt > existing.lastPurchase) existing.lastPurchase = soldAt
      }
      if (day) existing.days.add(day)
    } else {
      byKey.set(key, {
        phone: localPhone,
        purchases: 1,
        totalSpent: Number.isFinite(amount) ? amount : 0,
        firstPurchase: soldAt,
        lastPurchase: soldAt,
        days: new Set(day ? [day] : []),
      })
    }
  }

  return Array.from(byKey.values())
    .map((c) => {
      const daysSinceLastPurchase = daysSincePurchase(c.lastPurchase, now)
      const segment = deriveCustomerSegment(c.purchases, daysSinceLastPurchase, thresholdDays)
      return {
        phone: c.phone,
        purchases: c.purchases,
        totalSpent: roundMoney(c.totalSpent),
        firstPurchase: c.firstPurchase,
        lastPurchase: c.lastPurchase,
        activeDays: c.days.size,
        daysSinceLastPurchase,
        avgDaysBetweenPurchases: avgDaysBetweenPurchases(c.firstPurchase, c.lastPurchase, c.purchases),
        segment,
      }
    })
    .sort((a, b) => {
      if (b.purchases !== a.purchases) return b.purchases - a.purchases
      if (b.activeDays !== a.activeDays) return b.activeDays - a.activeDays
      if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent
      return a.phone.localeCompare(b.phone, undefined, { numeric: true })
    })
}

/**
 * @param {ReturnType<typeof aggregateCustomers>} customers
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

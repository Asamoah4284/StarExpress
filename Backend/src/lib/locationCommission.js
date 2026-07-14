export const DEFAULT_HOSTEL_COMMISSION_RATE = 20
export const DEFAULT_LIGHT_BILL_AMOUNT = 50

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeHostelCommissionRate(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_HOSTEL_COMMISSION_RATE
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

/**
 * @param {{ commissionRate?: unknown }} doc
 */
export function hostelCommissionRateFromDoc(doc) {
  return normalizeHostelCommissionRate(doc?.commissionRate ?? DEFAULT_HOSTEL_COMMISSION_RATE)
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeLightBillAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LIGHT_BILL_AMOUNT
  return Math.round(n * 100) / 100
}

/**
 * Weekly light bill (GH₵) for a location. Outdoor locations default to 0 when unset.
 * @param {{ name?: unknown, lightBillAmount?: unknown }} doc
 */
export function lightBillAmountFromDoc(doc) {
  if (doc?.lightBillAmount !== undefined && doc?.lightBillAmount !== null && doc?.lightBillAmount !== "") {
    return normalizeLightBillAmount(doc.lightBillAmount)
  }
  const name = String(doc?.name || "").toUpperCase()
  if (name.includes("OUTDOOR")) return 0
  return DEFAULT_LIGHT_BILL_AMOUNT
}

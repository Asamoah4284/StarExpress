/**
 * Shared promo-discount math. Kept tiny and pure so the catalog route, payment
 * initialization, and fulfillment all compute the same discounted price.
 */

/**
 * Clamp an arbitrary value to a whole-number percentage between 0 and 100.
 * Anything invalid or <= 0 becomes 0 (i.e. "no discount").
 * @param {unknown} value
 * @returns {number}
 */
export function normalizePercentOff(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, n)
}

/**
 * Round a money amount to 2 decimals (pesewas), avoiding float drift.
 * @param {number} amount
 * @returns {number}
 */
export function roundMoney(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Apply a percentage discount to a price and round to pesewas.
 * @param {number} price
 * @param {unknown} percentOff
 * @returns {number}
 */
export function applyPercentOff(price, percentOff) {
  const base = Number(price)
  if (!Number.isFinite(base) || base <= 0) return 0
  const pct = normalizePercentOff(percentOff)
  if (pct <= 0) return roundMoney(base)
  return roundMoney(Math.max(0, base * (1 - pct / 100)))
}

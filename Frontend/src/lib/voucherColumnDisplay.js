/**
 * Normalize CSV / Mongo column labels for comparisons (handles middle-dot variants).
 * @param {string} k
 */
export function normalizeVoucherColumnKey(k) {
  return String(k).replace(/·/g, ".").trim()
}

/**
 * Throughput limit columns we do not show in voucher tables (data may still be stored).
 * @param {string} k
 */
export function isHiddenVoucherThroughputColumnKey(k) {
  const n = normalizeVoucherColumnKey(k)
  if (/^download\s*limit/i.test(n)) return true
  if (/^upload\s*limit/i.test(n)) return true
  return false
}

/**
 * Normalize Ghana mobile numbers to E.164 (+233…).
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeGhanaPhone(input) {
  const s = String(input || "")
    .trim()
    .replace(/\s/g, "")
  if (!s) return ""
  if (s.startsWith("+")) return s
  if (s.startsWith("0")) return `+233${s.slice(1)}`
  if (s.startsWith("233")) return `+${s}`
  return `+233${s}`
}

/**
 * Digits-only key for indexes (233XXXXXXXXX).
 * @param {string} e164
 */
export function phoneNormalizedKey(e164) {
  return normalizeGhanaPhone(e164).replace(/\D/g, "")
}

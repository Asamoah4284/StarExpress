/**
 * Ghana phone formatting for display (mirrors Backend/src/lib/ghanaPhone.js).
 */

/** @param {unknown} input */
export function formatGhanaPhoneLocal(input) {
  const digits = String(input || "").replace(/\D/g, "")
  if (!digits) return ""
  if (digits.startsWith("233") && digits.length >= 12) {
    return `0${digits.slice(3, 12)}`
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return digits.slice(0, 10)
  }
  if (digits.length === 9) {
    return `0${digits}`
  }
  if (digits.startsWith("0")) return digits
  return `0${digits}`
}

/** @param {unknown} input */
export function formatGhanaPhoneDisplayLocal(input) {
  const local = formatGhanaPhoneLocal(input)
  const digits = local.replace(/\D/g, "")
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  }
  return local
}

/** @param {unknown} input */
export function ghanaPhoneDedupeKey(input) {
  const local = formatGhanaPhoneLocal(input)
  const digits = local.replace(/\D/g, "")
  if (digits.length >= 9) return digits.slice(-9)
  return digits
}

/**
 * Dedupe a list of phone strings to unique local 0-prefixed numbers.
 * @param {string[]} phones
 */
export function dedupeGhanaPhonesLocal(phones) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const raw of phones) {
    const key = ghanaPhoneDedupeKey(raw)
    if (!key || key.length < 7) continue
    const local = formatGhanaPhoneLocal(raw)
    if (!local) continue
    if (!map.has(key)) map.set(key, local)
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

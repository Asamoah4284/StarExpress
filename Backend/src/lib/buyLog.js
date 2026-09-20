/**
 * Verbose purchase diagnostics. Watch the API terminal for `[buy]` lines.
 */

/**
 * @param {unknown} phone
 */
export function maskPhoneForLog(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (digits.length <= 4) return "****"
  return `***${digits.slice(-4)}`
}

/**
 * @param {unknown} err
 */
export function errorForLog(err) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  if (err && typeof err === "object") return err
  return { message: String(err) }
}

/**
 * @param {string} step
 * @param {Record<string, unknown> | unknown} [details]
 */
export function buyLog(step, details) {
  if (details === undefined) {
    console.log(`[buy] ${step}`)
    return
  }
  console.log(`[buy] ${step}`, details)
}

/**
 * @param {string} step
 * @param {Record<string, unknown> | unknown} [details]
 */
export function buyError(step, details) {
  if (details === undefined) {
    console.error(`[buy] ${step}`)
    return
  }
  console.error(`[buy] ${step}`, details)
}

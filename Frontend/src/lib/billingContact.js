/**
 * Moolre embed/link requires an email-shaped billing id.
 * Phone-only customers use a stable synthetic address from their number.
 * @param {{ email?: string, phone?: string } | string | null | undefined} input
 */
export function getBillingEmail(input) {
  if (typeof input === "string") {
    const trimmed = input.trim()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed
    const digits = trimmed.replace(/\D/g, "")
    if (digits.length >= 7) return `${digits}@phone.starexpress.app`
    return null
  }

  const email = typeof input?.email === "string" ? input.email.trim() : ""
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email

  const phone = (input?.phone || "").replace(/\D/g, "")
  if (phone.length >= 7) return `${phone}@phone.starexpress.app`

  return null
}

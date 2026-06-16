export const RETRIEVE_VOUCHER_LIMIT = 3

/**
 * Match a sale's stored `customerPhone` on trailing national digits.
 * @param {string} formattedPhone
 */
export function customerPhoneTrailingDigitsRegex(formattedPhone) {
  const national = String(formattedPhone || "").slice(-9)
  if (national.length < 7) return null
  const pattern = national.split("").join("\\D*")
  return new RegExp(`${pattern}$`)
}

/**
 * Compact date label: "26 May".
 * @param {unknown} value
 */
export function formatVoucherDateLabel(value) {
  if (!value) return ""
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) {
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return ""
    const day = Number(m[3])
    const monthIdx = Number(m[2]) - 1
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${day} ${months[monthIdx] || ""}`.trim()
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${d.getDate()} ${months[d.getMonth()]}`
}

/**
 * @param {import("mongodb").Collection} salesCol
 * @param {string} formattedPhone
 */
export async function findRecentVouchersForPhone(salesCol, formattedPhone) {
  const regex = customerPhoneTrailingDigitsRegex(formattedPhone)
  if (!regex) return []
  const docs = await salesCol
    .find({
      customerPhone: { $regex: regex },
      voucherCode: { $exists: true, $nin: [null, ""] },
    })
    .sort({ date: -1, _id: -1 })
    .limit(RETRIEVE_VOUCHER_LIMIT)
    .toArray()
  return docs.map((d) => ({
    voucherCode: String(d.voucherCode || "").trim(),
    packageName: typeof d.packageType === "string" && d.packageType.trim() ? d.packageType.trim() : "WiFi",
    date: formatVoucherDateLabel(d.date),
  }))
}

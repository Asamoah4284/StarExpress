/**
 * @param {string} packageName
 * @param {string} dataLimit
 * @param {string} voucherCode
 */
export function buildSaleVoucherSmsMessage(packageName, dataLimit, voucherCode) {
  const limit = typeof dataLimit === "string" ? dataLimit.trim() : ""
  const packageLine = limit
    ? ` Package: ${packageName} (${limit})`
    : ` Package: ${packageName}`
  return `Your wifi access is ready!\n${packageLine}\n Voucher ID: ${voucherCode}`
}

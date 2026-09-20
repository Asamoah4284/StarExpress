/**
 * @param {string} packageName
 * @param {string} dataLimit
 */
function packageLine(packageName, dataLimit) {
  const limit = typeof dataLimit === "string" ? dataLimit.trim() : ""
  return limit ? ` Package: ${packageName} (${limit})` : ` Package: ${packageName}`
}

/**
 * @param {string} packageName
 * @param {string} dataLimit
 * @param {string} voucherCode
 */
export function buildSaleVoucherSmsMessage(packageName, dataLimit, voucherCode) {
  return `Your wifi access is ready!\n${packageLine(packageName, dataLimit)}\n Voucher ID: ${voucherCode}`
}

/**
 * Captive /buy: FreeRADIUS username and password are the same typeable code.
 * @param {string} packageName
 * @param {string} dataLimit
 * @param {string} wifiCode
 */
export function buildRadiusWifiSmsMessage(packageName, dataLimit, wifiCode) {
  const code = String(wifiCode || "").trim()
  return `Your wifi login is ready.\n${packageLine(packageName, dataLimit)}\n Username: ${code}\n Password: ${code}\nEnter these on the WiFi login page.`
}

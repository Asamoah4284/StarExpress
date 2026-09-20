/**
 * @param {string} packageName
 * @param {string} dataLimit
 */
function packageLine(packageName, dataLimit) {
  const limit = typeof dataLimit === "string" ? dataLimit.trim() : ""
  return limit ? ` Package: ${packageName} (${limit})` : ` Package: ${packageName}`
}

/**
 * @param {number} [seconds]
 */
function formatDurationLabel(seconds) {
  const sec = Number(seconds)
  if (!Number.isFinite(sec) || sec <= 0) return ""
  if (sec % 86400 === 0) {
    const d = sec / 86400
    return d === 1 ? "1 day" : `${d} days`
  }
  if (sec % 3600 === 0) {
    const h = sec / 3600
    return h === 1 ? "1 hour" : `${h} hours`
  }
  if (sec % 60 === 0) {
    const m = sec / 60
    return m === 1 ? "1 minute" : `${m} minutes`
  }
  return `${Math.round(sec)} seconds`
}

/**
 * @param {string} packageName
 * @param {string} dataLimit
 * @param {string} voucherCode
 * @param {number} [validSeconds]
 */
export function buildSaleVoucherSmsMessage(packageName, dataLimit, voucherCode, validSeconds) {
  const code = String(voucherCode || "").trim()
  const valid = formatDurationLabel(validSeconds)
  const validLine = valid ? `\n Valid for ${valid}.` : ""
  return `Your wifi code is ready.\n${packageLine(packageName, dataLimit)}\n Code: ${code}${validLine}\nEnter this code on the WiFi login page.`
}

/**
 * Same SMS as {@link buildSaleVoucherSmsMessage} (single code, no username/password lines).
 * @param {string} packageName
 * @param {string} dataLimit
 * @param {string} wifiCode
 * @param {number} [validSeconds]
 */
export function buildRadiusWifiSmsMessage(packageName, dataLimit, wifiCode, validSeconds) {
  return buildSaleVoucherSmsMessage(packageName, dataLimit, wifiCode, validSeconds)
}

/**
 * Public frontend origin for captive portal Moolre redirects.
 * @returns {string}
 */
export function resolveFrontendBaseUrl() {
  const explicit = String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "")
  if (explicit) return explicit

  const cors = String(process.env.CORS_ORIGIN || "")
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (cors.length > 0) return cors[0].replace(/\/+$/, "")

  return "http://localhost:5173"
}

/**
 * @param {string} paymentReference
 */
export function resolveCaptivePaymentRedirectUrl(paymentReference) {
  const base = resolveFrontendBaseUrl()
  return `${base}/portal-payment-success?externalref=${encodeURIComponent(paymentReference)}`
}

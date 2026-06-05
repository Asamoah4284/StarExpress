/**
 * Resolve public URLs for Moolre embed init (webhook + redirect).
 * Redirect uses the backend so Moolre never points at localhost during production payments.
 */

/**
 * @param {string | undefined} raw
 */
function stripTrailingSlashes(raw) {
  return String(raw || "").replace(/\/+$/, "")
}

/**
 * @param {string} url
 */
function collapseDuplicateSlashes(url) {
  return url.replace(/([^:]\/)\/+/g, "$1")
}

/**
 * @returns {string}
 */
export function resolveMoolreBackendBaseUrl() {
  const fromBackend = stripTrailingSlashes(process.env.BACKEND_URL || process.env.API_URL || "")
  if (fromBackend) return fromBackend

  const callback = stripTrailingSlashes(process.env.MOOLRE_PAYMENT_CALLBACK_URL || "")
  if (callback) {
    const idx = callback.indexOf("/api/")
    if (idx > 0) return callback.slice(0, idx)
    return callback
  }

  return "http://127.0.0.1:4000"
}

/**
 * @returns {string}
 */
export function resolveMoolreWebhookUrl() {
  const explicit = process.env.MOOLRE_PAYMENT_CALLBACK_URL
  if (explicit && String(explicit).trim()) {
    return collapseDuplicateSlashes(stripTrailingSlashes(String(explicit).trim()))
  }
  return `${resolveMoolreBackendBaseUrl()}/api/moolre/callback`
}

/**
 * After MoMo approval, Moolre redirects the embed iframe here (served by this API).
 * @returns {string}
 */
export function resolveMoolreRedirectUrl() {
  const explicit = process.env.MOOLRE_REDIRECT_URL
  if (explicit && String(explicit).trim()) {
    return collapseDuplicateSlashes(stripTrailingSlashes(String(explicit).trim()))
  }
  return `${resolveMoolreBackendBaseUrl()}/api/moolre/payment-success`
}

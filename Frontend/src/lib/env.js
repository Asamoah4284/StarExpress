/** @param {unknown} v */
function envTruthy(v) {
  if (v === true) return true
  if (typeof v !== "string") return false
  const s = v.trim().toLowerCase()
  return s === "true" || s === "1" || s === "yes" || s === "on"
}

/** Use API for auth when any of these env vars is truthy (restart Vite after changing .env). */
export function isBackendEnabled() {
  return (
    envTruthy(import.meta.env.VITE_USE_BACKEND) ||
    envTruthy(import.meta.env.VITE_USE_API)
  )
}

/** Base URL for API calls (empty = same origin, use Vite `/api` proxy in dev). */
export function getApiBaseUrl() {
  const v = import.meta.env.VITE_API_BASE_URL
  return typeof v === "string" ? v : ""
}

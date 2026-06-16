/** Base URL for API calls (empty = same origin, use Vite `/api` proxy in dev). */
export function getApiBaseUrl() {
  const v = import.meta.env.VITE_API_BASE_URL
  return typeof v === "string" ? v : ""
}

/** Default app name (sidebar, breadcrumbs) when settings API is unavailable. */
export function getDefaultAppName() {
  const v = import.meta.env.VITE_APP_NAME
  return typeof v === "string" && v.trim() ? v.trim() : "Tabitacum"
}

/** Default company name (exports, reports) when settings API is unavailable. */
export function getDefaultCompanyName() {
  const v = import.meta.env.VITE_COMPANY_NAME
  return typeof v === "string" && v.trim() ? v.trim() : "Tabitacum Admin"
}

/** Fallback commission rate (0–1) when settings API is unavailable. Admin can change live rate in Settings. */
export function getSalesAgentCommissionRate() {
  const raw = import.meta.env.VITE_SALES_AGENT_COMMISSION_RATE
  const n = typeof raw === "string" && raw.trim() ? Number.parseFloat(raw.trim()) : 0.2
  if (!Number.isFinite(n) || n < 0) return 0.2
  return Math.min(1, n)
}

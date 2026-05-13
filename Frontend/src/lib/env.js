/** Base URL for API calls (empty = same origin, use Vite `/api` proxy in dev). */
export function getApiBaseUrl() {
  const v = import.meta.env.VITE_API_BASE_URL
  return typeof v === "string" ? v : ""
}

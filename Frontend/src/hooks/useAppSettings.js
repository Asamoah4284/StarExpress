import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
import { fetchAppSettings } from "@/lib/api.js"
import { getDefaultAppName, getDefaultCompanyName, getSalesAgentCommissionRate } from "@/lib/env.js"

export const APP_SETTINGS_QUERY_KEY = "appSettings"

export function useAppSettings() {
  const { token, authReady } = useAuth()
  return useQuery({
    queryKey: [APP_SETTINGS_QUERY_KEY, token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchAppSettings(token)
      if (!r.ok) throw new Error(r.error || "Failed to load settings")
      return {
        salesAgentCommissionRate: r.salesAgentCommissionRate,
        appName: r.appName,
        companyName: r.companyName,
        companyLogoUrl: r.companyLogoUrl ?? null,
        alertPhone: typeof r.alertPhone === "string" ? r.alertPhone : "",
        purchaseAlertsEnabled: typeof r.purchaseAlertsEnabled === "boolean" ? r.purchaseAlertsEnabled : true,
        promosVisible: typeof r.promosVisible === "boolean" ? r.promosVisible : true,
      }
    },
    enabled: authReady && Boolean(token),
    staleTime: 60_000,
  })
}

/** Resolved commission rate (0–1): API when loaded, else env default. */
export function useSalesAgentCommissionRate() {
  const settingsQuery = useAppSettings()
  const fallback = getSalesAgentCommissionRate()
  if (settingsQuery.isSuccess && typeof settingsQuery.data?.salesAgentCommissionRate === "number") {
    const n = settingsQuery.data.salesAgentCommissionRate
    if (Number.isFinite(n) && n >= 0) return Math.min(1, n)
  }
  return fallback
}

/** App name for sidebar, breadcrumbs, and auth screens. */
export function useAppName() {
  const settingsQuery = useAppSettings()
  const fallback = getDefaultAppName()
  if (settingsQuery.isSuccess && typeof settingsQuery.data?.appName === "string") {
    const name = settingsQuery.data.appName.trim()
    if (name) return name
  }
  return fallback
}

/** Company name for exports and document headers. */
export function useCompanyName() {
  const settingsQuery = useAppSettings()
  const fallback = getDefaultCompanyName()
  if (settingsQuery.isSuccess && typeof settingsQuery.data?.companyName === "string") {
    const name = settingsQuery.data.companyName.trim()
    if (name) return name
  }
  return fallback
}

/** Company logo data URL for sidebar profile (null = default icon). */
export function useCompanyLogoUrl() {
  const settingsQuery = useAppSettings()
  if (settingsQuery.isSuccess && typeof settingsQuery.data?.companyLogoUrl === "string") {
    const url = settingsQuery.data.companyLogoUrl.trim()
    if (url) return url
  }
  return null
}

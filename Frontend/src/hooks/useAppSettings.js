import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
import { fetchAppSettings } from "@/lib/api.js"
import { getSalesAgentCommissionRate } from "@/lib/env.js"

export const APP_SETTINGS_QUERY_KEY = "appSettings"

export function useAppSettings() {
  const { token, authReady } = useAuth()
  return useQuery({
    queryKey: [APP_SETTINGS_QUERY_KEY, token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await fetchAppSettings(token)
      if (!r.ok) throw new Error(r.error || "Failed to load settings")
      return { salesAgentCommissionRate: r.salesAgentCommissionRate }
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

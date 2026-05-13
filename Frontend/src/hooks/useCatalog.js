import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
import { fetchCatalog } from "@/lib/api.js"

/**
 * Sales, locations, packages, disputes, and audit logs from `GET /api/catalog`.
 */
export function useCatalog() {
  const { token, authReady } = useAuth()
  return useQuery({
    queryKey: ["catalog", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchCatalog(token)
      if (!result.ok) throw new Error(result.error || "Failed to load catalog")
      return result.catalog
    },
    enabled: authReady && Boolean(token),
  })
}

import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext.jsx"
import { fetchAuditLogs } from "@/lib/api.js"

const POLL_MS = 4000

/**
 * Audit log rows with periodic refresh (near real-time without WebSockets).
 */
export function useAuditLogs() {
  const { token, authReady } = useAuth()
  return useQuery({
    queryKey: ["auditLogs", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchAuditLogs(token)
      if (!result.ok) throw new Error(result.error || "Failed to load audit logs")
      return result.auditLogs
    },
    enabled: authReady && Boolean(token),
    staleTime: 0,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })
}

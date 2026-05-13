import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@/context/AuthContext.jsx"
import { defaultHomePathForRole, ROLE_SALES_AGENT } from "@/lib/roles.js"

/** Nested routes sales agents must not open (admins only). */
export function BlockSalesAgentRoute() {
  const { user, authReady } = useAuth()

  if (!authReady) {
    return null
  }

  if (user?.role === ROLE_SALES_AGENT) {
    return <Navigate to={defaultHomePathForRole(ROLE_SALES_AGENT)} replace />
  }

  return <Outlet />
}

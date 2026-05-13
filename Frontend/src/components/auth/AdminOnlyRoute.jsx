import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@/context/AuthContext.jsx"
import { defaultHomePathForRole, isAdminRole } from "@/lib/roles.js"

/** Nested routes only admins may open (e.g. Users, Audit logs). */
export function AdminOnlyRoute() {
  const { user, authReady } = useAuth()

  if (!authReady) {
    return null
  }

  if (!isAdminRole(user?.role)) {
    return <Navigate to={defaultHomePathForRole(user?.role)} replace />
  }

  return <Outlet />
}

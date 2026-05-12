import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/context/AuthContext.jsx"

export function ProtectedRoute() {
  const { isAuthenticated, authReady } = useAuth()
  const location = useLocation()

  if (!authReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

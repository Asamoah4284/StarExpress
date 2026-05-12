import { Routes, Route, Navigate } from "react-router-dom"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute.jsx"
import { MainLayout } from "@/components/layout/MainLayout.jsx"
import Login from "@/pages/Login.jsx"
import Dashboard from "@/pages/Dashboard.jsx"
import Sales from "@/pages/Sales.jsx"
import SalesHistory from "@/pages/SalesHistory.jsx"
import Reports from "@/pages/Reports.jsx"
import Packages from "@/pages/Packages.jsx"
import Locations from "@/pages/Locations.jsx"
import Disputes from "@/pages/Disputes.jsx"
import Users from "@/pages/Users.jsx"
import AuditLogs from "@/pages/AuditLogs.jsx"
import Settings from "@/pages/Settings.jsx"
import Vouchers from "@/pages/Vouchers.jsx"
import RevenueSplit from "@/pages/RevenueSplit.jsx"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="sales" element={<Sales />} />
          <Route path="sales-history" element={<SalesHistory />} />
          <Route path="reports" element={<Reports />} />
          <Route path="revenue-split" element={<RevenueSplit />} />
          <Route path="packages" element={<Packages />} />
          <Route path="vouchers" element={<Vouchers />} />
          <Route path="locations" element={<Locations />} />
          <Route path="disputes" element={<Disputes />} />
          <Route path="users" element={<Users />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

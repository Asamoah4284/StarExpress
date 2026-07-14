import { Routes, Route, Navigate } from "react-router-dom"
import { AdminOnlyRoute } from "@/components/auth/AdminOnlyRoute.jsx"
import { BlockSalesAgentRoute } from "@/components/auth/BlockSalesAgentRoute.jsx"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute.jsx"
import { MainLayout } from "@/components/layout/MainLayout.jsx"
import Login from "@/pages/Login.jsx"
import Signup from "@/pages/Signup.jsx"
import Dashboard from "@/pages/Dashboard.jsx"
import SalesHistory from "@/pages/SalesHistory.jsx"
import LocationCustomers from "@/pages/LocationCustomers.jsx"
import Reports from "@/pages/Reports.jsx"
import Packages from "@/pages/Packages.jsx"
import Locations from "@/pages/Locations.jsx"
import Users from "@/pages/Users.jsx"
import AuditLogs from "@/pages/AuditLogs.jsx"
import Settings from "@/pages/Settings.jsx"
import UploadedVouchers from "@/pages/UploadedVouchers.jsx"
import Vouchers from "@/pages/Vouchers.jsx"
import RevenueSplit from "@/pages/RevenueSplit.jsx"
import AgentCommissions from "@/pages/AgentCommissions.jsx"
import FinanceSummary from "@/pages/FinanceSummary.jsx"
import FinanceExpenses from "@/pages/FinanceExpenses.jsx"
import AgentPaymentSuccess from "@/pages/AgentPaymentSuccess.jsx"
import CaptiveBuy from "@/pages/CaptiveBuy.jsx"
import CaptiveRetrieveVoucher from "@/pages/CaptiveRetrieveVoucher.jsx"
import PortalPaymentSuccess from "@/pages/PortalPaymentSuccess.jsx"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/buy" element={<CaptiveBuy />} />
      <Route path="/portal-payment-success" element={<PortalPaymentSuccess />} />
      <Route path="/retrieve-voucher" element={<CaptiveRetrieveVoucher />} />
      <Route path="/agent-payment-success" element={<AgentPaymentSuccess />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="sales-history" element={<SalesHistory />} />
          <Route path="location-customers" element={<LocationCustomers />} />
          <Route path="packages" element={<Packages />} />
          <Route element={<BlockSalesAgentRoute />}>
            <Route path="reports" element={<Reports />} />
            <Route path="locations" element={<Locations />} />
            <Route path="settings" element={<Settings />} />
            <Route path="revenue-split" element={<RevenueSplit />} />
            <Route path="vouchers/uploaded" element={<UploadedVouchers />} />
            <Route path="vouchers" element={<Vouchers />} />
          </Route>
          <Route element={<AdminOnlyRoute />}>
            <Route path="finance" element={<FinanceSummary />} />
            <Route path="finance/expenses" element={<FinanceExpenses />} />
            <Route path="agent-commissions" element={<AgentCommissions />} />
            <Route path="users" element={<Users />} />
            <Route path="audit-logs" element={<AuditLogs />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

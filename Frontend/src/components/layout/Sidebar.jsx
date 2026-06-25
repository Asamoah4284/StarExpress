import { NavLink } from "react-router-dom"
import {
  BarChart3,
  Phone,
  PieChart,
  ChevronsLeft,
  ChevronsRight,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Satellite,
  ScrollText,
  Settings,
  Table2,
  Ticket,
  Users,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useAppName, useCompanyLogoUrl } from "@/hooks/useAppSettings.js"
import { cn } from "@/lib/utils"
import { roleMayAccessNavPath } from "@/lib/roles.js"

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/packages", label: "Packages", icon: Package },
  { to: "/sales-history", label: "Sales History", icon: History },
  { to: "/location-customers", label: "Customers", icon: Phone },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/revenue-split", label: "Revenue split", icon: PieChart },
  { to: "/vouchers", label: "Upload vouchers", icon: Ticket },
  { to: "/vouchers/uploaded", label: "Vouchers", icon: Table2 },
  { to: "/locations", label: "Locations", icon: MapPin },
  { to: "/agent-commissions", label: "Agent commissions", icon: Wallet },
  { to: "/users", label: "Users", icon: Users },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
]

function SidebarBrandMark({ logoUrl }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="size-10 shrink-0 rounded-full border border-border bg-muted/40 object-cover"
      />
    )
  }
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40"
      aria-hidden
    >
      <Satellite className="size-[18px] stroke-[1.5] text-primary" />
    </div>
  )
}

export function Sidebar({ className, collapsed, onToggleCollapse, onLogout, onNavigate, user }) {
  const appName = useAppName()
  const companyLogoUrl = useCompanyLogoUrl()

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-border bg-card text-card-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-56 sm:w-60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-5">
        <div className={cn("flex min-w-0 items-center gap-3", collapsed && "justify-center")}>
          <SidebarBrandMark logoUrl={companyLogoUrl} />
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold tracking-tight">{appName}</p>
              <p className="text-muted-foreground text-xs font-medium">
                {user?.role === "Sales Agent" ? "Sales workspace" : "Console"}
              </p>
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("hidden shrink-0 text-muted-foreground hover:text-foreground md:inline-flex", collapsed && "mx-auto")}
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4 stroke-[1.5]" /> : <ChevronsLeft className="size-4 stroke-[1.5]" />}
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {items
            .filter(({ to }) => roleMayAccessNavPath(user?.role, to))
            .map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/" || to === "/vouchers"}
              onClick={() => onNavigate?.()}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
                  collapsed && "justify-center px-2",
                  isActive
                    ? "bg-muted font-semibold text-foreground shadow-none"
                    : "hover:bg-muted/60 hover:text-foreground",
                )
              }
              title={collapsed ? label : undefined}
            >
              <Icon className="size-[18px] shrink-0 stroke-[1.5]" aria-hidden />
              {!collapsed ? <span className="truncate">{label}</span> : null}
            </NavLink>
          ))}
        </nav>
      </ScrollArea>

      <div className="mt-auto border-t border-border p-4">
        {!collapsed && user ? (
          <div className="mb-3 space-y-0.5">
            <p className="text-muted-foreground text-xs">Signed in</p>
            <p className="truncate text-sm font-medium leading-snug">{user.email}</p>
            <p className="text-muted-foreground truncate text-xs">{user.role}</p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className={cn("w-full gap-2 font-medium", collapsed && "px-0")}
          onClick={onLogout}
          title={collapsed ? "Log out" : undefined}
        >
          <LogOut className="size-4 shrink-0 stroke-[1.5]" />
          {!collapsed ? "Log out" : null}
        </Button>
      </div>
    </aside>
  )
}

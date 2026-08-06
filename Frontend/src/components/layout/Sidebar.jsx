import { NavLink } from "react-router-dom"
import {
  BarChart3,
  Phone,
  PieChart,
  ChevronsLeft,
  ChevronsRight,
  History,
  LayoutDashboard,
  Landmark,
  LogOut,
  MapPin,
  Package,
  Satellite,
  ScrollText,
  Settings,
  Users,
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
  { to: "/finance", label: "Finance", icon: Landmark },
  { to: "/locations", label: "Locations", icon: MapPin },
  { to: "/users", label: "Users", icon: Users },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
]

function SidebarBrandMark({ logoUrl, collapsed }) {
  if (logoUrl) {
    return (
      <span
        className={cn(
          "border-border bg-card flex shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm",
          collapsed ? "size-10 p-0.5" : "h-12 w-[8.75rem] px-1.5 py-1",
        )}
      >
        <img
          src={logoUrl}
          alt=""
          className={cn(
            "h-full w-full",
            collapsed ? "scale-[1.65] object-cover object-left" : "object-contain object-left",
          )}
        />
      </span>
    )
  }
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40"
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
        collapsed ? "w-[72px]" : "w-60 sm:w-64",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1 px-3 pb-3 pt-5 sm:px-4",
          collapsed ? "flex-col" : "justify-between",
        )}
      >
        <div className={cn("flex min-w-0 items-center gap-2.5", collapsed && "justify-center")}>
          <SidebarBrandMark logoUrl={companyLogoUrl} collapsed={collapsed} />
          {!collapsed && !companyLogoUrl ? (
            <p className="min-w-0 text-[13px] font-semibold leading-snug tracking-tight sm:text-sm">{appName}</p>
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

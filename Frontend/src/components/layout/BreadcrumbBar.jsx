import { Link, useLocation } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const ROUTE_TITLES = {
  "/": "Dashboard",
  "/sales": "Sales",
  "/sales-history": "Sales History",
  "/reports": "Reports",
  "/revenue-split": "Revenue split",
  "/packages": "Packages",
  "/vouchers": "Vouchers",
  "/locations": "Locations",
  "/disputes": "Disputes",
  "/users": "Users",
  "/audit-logs": "Audit Logs",
  "/settings": "Settings",
}

export function BreadcrumbBar({ className }) {
  const { pathname } = useLocation()
  const page = ROUTE_TITLES[pathname] ?? "Page"

  return (
    <nav aria-label="Breadcrumb" className={cn("flex min-w-0 items-center gap-1.5 text-sm", className)}>
      <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
        StarExpress
      </Link>
      <ChevronRight className="text-muted-foreground/70 size-3.5 shrink-0" aria-hidden />
      <span className="truncate font-medium text-foreground">{page}</span>
    </nav>
  )
}

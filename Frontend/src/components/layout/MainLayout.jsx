import * as React from "react"
import { Outlet } from "react-router-dom"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Sidebar } from "@/components/layout/Sidebar.jsx"
import { TopBar } from "@/components/layout/TopBar.jsx"
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed.js"
import { users } from "@/data/users.js"

const currentUser = users[0]

export function MainLayout() {
  const { collapsed, toggle } = useSidebarCollapsed()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const handleLogout = React.useCallback(() => {
    console.info("Logout (UI only — no backend).")
  }, [])

  return (
    <div className="flex h-svh w-full overflow-hidden bg-canvas text-foreground">
      <div className="hidden h-svh shrink-0 md:flex">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={toggle}
          onLogout={handleLogout}
          user={currentUser}
        />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[min(100%,280px)] border-r border-border p-0 md:hidden" showCloseButton>
          <Sidebar
            className="h-full min-h-0 border-0"
            collapsed={false}
            onToggleCollapse={toggle}
            user={currentUser}
            onLogout={() => {
              setMobileOpen(false)
              handleLogout()
            }}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          user={{ name: currentUser.name, role: currentUser.role, email: currentUser.email }}
          onMenuClick={() => setMobileOpen(true)}
          onLogout={handleLogout}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain space-y-8 p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

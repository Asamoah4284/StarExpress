import { LogOut, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BreadcrumbBar } from "@/components/layout/BreadcrumbBar.jsx"
import { cn } from "@/lib/utils"

function initials(name) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export function TopBar({ user, onMenuClick, onLogout, className }) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 lg:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <Menu className="size-5 stroke-[1.5]" />
        </Button>
        <BreadcrumbBar className="min-w-0" />
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="hidden items-center gap-2 text-sm sm:flex">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="text-muted-foreground">Live</span>
        </div>
        <a
          href="https://www.starlink.com"
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground hidden text-sm font-medium transition-colors sm:inline"
        >
          Back to site
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="size-8 border border-border">
                <AvatarFallback className="bg-muted text-muted-foreground text-xs font-semibold">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[120px] flex-col items-start text-left lg:flex">
                <span className="truncate text-sm font-medium leading-none">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">{user.role}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <span className="text-sm font-medium">{user.name}</span>
                <span className="text-muted-foreground text-xs font-normal">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="size-4 stroke-[1.5]" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

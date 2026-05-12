import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Password input with visibility toggle (eye icon).
 * @param {React.ComponentProps<typeof Input> & { id: string }} props
 */
export function PasswordField({ className, id, ...props }) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
        {...props}
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:focus-visible:ring-offset-background"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={id}
      >
        {visible ? <EyeOff className="size-4 shrink-0" strokeWidth={1.75} aria-hidden /> : <Eye className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
      </button>
    </div>
  )
}

import { cn } from "@/lib/utils"

export function PageHeader({ title, description, children, className }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5",
        className,
      )}
    >
      <div className="min-w-0 space-y-1 sm:space-y-2">
        <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}

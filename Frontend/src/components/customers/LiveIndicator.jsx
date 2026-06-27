import { cn } from "@/lib/utils"

/**
 * @param {{ lastUpdated?: Date | null, isFetching?: boolean, className?: string }} props
 */
export function LiveIndicator({ lastUpdated, isFetching = false, className }) {
  const timeLabel =
    lastUpdated != null
      ? lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })
      : null

  return (
    <div
      className={cn(
        "border-border/80 bg-card inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-none",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inline-flex size-full rounded-full opacity-75",
            isFetching ? "bg-primary animate-ping" : "bg-emerald-500 animate-ping",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            isFetching ? "bg-primary" : "bg-emerald-500",
          )}
          aria-hidden
        />
      </span>
      <span className="font-semibold tracking-wide">{isFetching ? "Updating…" : "Live"}</span>
      {timeLabel ? <span className="text-muted-foreground hidden tabular-nums sm:inline">· {timeLabel}</span> : null}
    </div>
  )
}

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DATE_INPUT_DISPLAY_FORMAT,
  formatDateForInput,
  getLastNDaysRange,
  isCompleteDateRange,
  normalizeDateRange,
  parseFlexibleDate,
} from "@/lib/dates.js"
import { cn } from "@/lib/utils"

function useMonthCount() {
  const [count, setCount] = React.useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches ? 2 : 1,
  )

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)")
    const onChange = () => setCount(mq.matches ? 2 : 1)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return count
}

/**
 * @param {{
 *   id: string
 *   label: string
 *   value: string
 *   onChange: (value: string) => void
 *   onCommit: (value: string) => boolean
 *   highlight?: boolean
 *   invalid?: boolean
 * }} props
 */
function RangeDateInput({ id, label, value, onChange, onCommit, highlight, invalid }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder={DATE_INPUT_DISPLAY_FORMAT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onCommit(e.currentTarget.value)
          }
        }}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-9 bg-background text-sm shadow-none tabular-nums",
          highlight && "border-primary/40 ring-1 ring-primary/20",
        )}
      />
    </div>
  )
}

/**
 * @param {{
 *   value?: { from?: Date, to?: Date }
 *   onChange: (range: { from?: Date, to?: Date } | undefined) => void
 *   className?: string
 *   id?: string
 * }} props
 */
export function DateRangePicker({ value, onChange, className, id }) {
  const [open, setOpen] = React.useState(false)
  const monthCount = useMonthCount()
  const calendarStart = React.useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear() - 10, 0, 1)
  }, [])
  const calendarEnd = React.useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 0)
  }, [])
  const today = React.useMemo(() => new Date(), [])
  const fromYear = calendarStart.getFullYear()
  const toYear = today.getFullYear()

  const [draft, setDraft] = React.useState(value)
  const [calendarKey, setCalendarKey] = React.useState(0)
  const [fromText, setFromText] = React.useState("")
  const [toText, setToText] = React.useState("")
  const [fromInvalid, setFromInvalid] = React.useState(false)
  const [toInvalid, setToInvalid] = React.useState(false)

  const syncTextFromDraft = React.useCallback((range) => {
    setFromText(range?.from ? formatDateForInput(range.from) : "")
    setToText(range?.to ? formatDateForInput(range.to) : "")
    setFromInvalid(false)
    setToInvalid(false)
  }, [])

  const defaultMonth = React.useMemo(
    () => draft?.to ?? draft?.from ?? today,
    [draft?.from, draft?.to, today],
  )

  React.useEffect(() => {
    if (!open) return
    setDraft(value)
    syncTextFromDraft(value)
    setCalendarKey((k) => k + 1)
  }, [open, value, syncTextFromDraft])

  const draftComplete = isCompleteDateRange(draft)
  const pickingEnd = Boolean(draft?.from && !draft?.to)

  const label = React.useMemo(() => {
    if (!value?.from) return "Custom date range"
    if (value.to) {
      return `${format(value.from, "MMM d, yyyy")} – ${format(value.to, "MMM d, yyyy")}`
    }
    return `${format(value.from, "MMM d, yyyy")} – …`
  }, [value])

  const commitFrom = (text) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setFromInvalid(false)
      setFromText("")
      setDraft((prev) => (prev?.to ? { to: prev.to } : undefined))
      return true
    }
    const parsed = parseFlexibleDate(trimmed)
    if (!parsed) {
      setFromInvalid(true)
      return false
    }
    setFromInvalid(false)
    setFromText(formatDateForInput(parsed))
    setDraft((prev) => normalizeDateRange({ from: parsed, to: prev?.to }))
    return true
  }

  const commitTo = (text) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setToInvalid(false)
      setToText("")
      setDraft((prev) => (prev?.from ? { from: prev.from } : undefined))
      return true
    }
    const parsed = parseFlexibleDate(trimmed)
    if (!parsed) {
      setToInvalid(true)
      return false
    }
    setToInvalid(false)
    setToText(formatDateForInput(parsed))
    setDraft((prev) => normalizeDateRange({ from: prev?.from, to: parsed }))
    return true
  }

  const applyDraft = () => {
    const fromOk = commitFrom(fromText)
    const toOk = commitTo(toText)
    if (!fromOk || !toOk) return

    const fromParsed = fromText.trim() ? parseFlexibleDate(fromText.trim()) : null
    const toParsed = toText.trim() ? parseFlexibleDate(toText.trim()) : null
    const next = normalizeDateRange({
      from: fromParsed ?? draft?.from,
      to: toParsed ?? draft?.to,
    })
    if (!isCompleteDateRange(next)) return
    setDraft(next)
    syncTextFromDraft(next)
    onChange(next)
    setOpen(false)
  }

  const applyPreset = (days) => {
    const range = getLastNDaysRange(days)
    onChange(range)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full justify-start gap-2 px-3 font-normal shadow-none",
            !value?.from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
        align="start"
        sideOffset={6}
      >
        <div className="border-border space-y-3 border-b px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Custom range</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Type dates below (e.g. Jan 5, 2026 or 2026-01-05) or pick on the calendar, then Apply.
              </p>
            </div>
            {pickingEnd ? (
              <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Select end
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <RangeDateInput
              id="report-range-start"
              label="Start"
              value={fromText}
              onChange={setFromText}
              onCommit={commitFrom}
              highlight={Boolean(draft?.from) && pickingEnd}
              invalid={fromInvalid}
            />
            <RangeDateInput
              id="report-range-end"
              label="End"
              value={toText}
              onChange={setToText}
              onCommit={commitTo}
              highlight={draftComplete}
              invalid={toInvalid}
            />
          </div>
          {fromInvalid || toInvalid ? (
            <p className="text-destructive text-xs" role="alert">
              Use a valid date like Jan 5, 2026, 01/05/2026, or 2026-01-05.
            </p>
          ) : null}
        </div>

        <div className="px-2 pb-2 pt-3 sm:px-4">
          <Calendar
            key={calendarKey}
            mode="range"
            captionLayout="dropdown"
            numberOfMonths={monthCount}
            defaultMonth={defaultMonth}
            startMonth={calendarStart}
            endMonth={calendarEnd}
            fromYear={fromYear}
            toYear={toYear}
            selected={draft}
            onSelect={(range) => {
              const next = normalizeDateRange(range)
              setDraft(next)
              syncTextFromDraft(next)
            }}
            showOutsideDays={false}
          />
        </div>

        <div className="border-border bg-muted/30 flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset(7)}>
            Last 7 days
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset(30)}>
            Last 30 days
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setDraft(undefined)
              syncTextFromDraft(undefined)
            }}
          >
            Clear
          </Button>
          <Button type="button" size="sm" className="ml-auto" disabled={!draftComplete} onClick={applyDraft}>
            Apply range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

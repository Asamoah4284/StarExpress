import { format, isValid, parse } from "date-fns"

/** Display / typed format shown in date range inputs. */
export const DATE_INPUT_DISPLAY_FORMAT = "MMM d, yyyy"

const PARSE_FORMATS = [
  "yyyy-MM-dd",
  "M/d/yyyy",
  "MM/dd/yyyy",
  "M-d-yyyy",
  "MM-dd-yyyy",
  "MMM d, yyyy",
  "MMMM d, yyyy",
  "d/M/yyyy",
  "dd/MM/yyyy",
]

/**
 * Parse flexible user-typed dates (local calendar).
 * @param {string} text
 * @returns {Date | null}
 */
export function parseFlexibleDate(text) {
  const trimmed = text.trim()
  if (!trimmed) return null

  const ref = new Date()
  for (const fmt of PARSE_FORMATS) {
    const d = parse(trimmed, fmt, ref)
    if (isValid(d)) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    }
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (isoMatch) {
    const y = Number(isoMatch[1])
    const m = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    const d = new Date(y, m - 1, day)
    if (d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day) return d
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  if (slashMatch) {
    const a = Number(slashMatch[1])
    const b = Number(slashMatch[2])
    const y = Number(slashMatch[3])
    let m = a
    let day = b
    if (a > 12 && b <= 12) {
      m = b
      day = a
    }
    const d = new Date(y, m - 1, day)
    if (d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day) return d
  }

  return null
}

/**
 * @param {Date} d
 * @returns {string}
 */
export function formatDateForInput(d) {
  return format(d, DATE_INPUT_DISPLAY_FORMAT)
}

/**
 * Display a sale timestamp for tables and exports.
 * Uses full ISO `soldAt` when present; falls back to date-only legacy rows.
 * @param {string | undefined | null} soldAt
 * @param {string | undefined | null} dateFallback
 */
export function formatSaleDateTime(soldAt, dateFallback) {
  const raw = typeof soldAt === "string" && soldAt.trim() ? soldAt.trim() : ""
  if (raw) {
    const d = new Date(raw)
    if (isValid(d)) return format(d, "yyyy-MM-dd, h:mm:ss a")
  }
  const day = typeof dateFallback === "string" ? dateFallback.trim() : ""
  return day || "—"
}

/**
 * @param {Date} d
 * @returns {string} ISO `YYYY-MM-DD` (local calendar date)
 */
export function localDateToIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * @param {string} iso
 * @returns {Date}
 */
export function isoToLocalDate(iso) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Inclusive local calendar dates between two ISO days.
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {string[]}
 */
export function eachIsoDayInRange(fromIso, toIso) {
  if (!fromIso || !toIso) return []
  let start = isoToLocalDate(fromIso)
  let end = isoToLocalDate(toIso)
  if (start > end) {
    const t = start
    start = end
    end = t
  }
  /** @type {string[]} */
  const days = []
  const cursor = new Date(start)
  while (cursor <= end) {
    days.push(localDateToIso(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

/**
 * Last N calendar days ending on `endDate` (default today), local time.
 * @param {number} dayCount
 * @param {Date} [endDate]
 */
export function getLastNDaysRange(dayCount, endDate = new Date()) {
  const n = Math.max(1, Math.floor(dayCount))
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - (n - 1))
  return { from: start, to: end }
}

/**
 * @param {{ from?: Date, to?: Date } | undefined} range
 * @returns {{ from: Date, to?: Date } | undefined}
 */
export function normalizeDateRange(range) {
  if (!range?.from) return undefined
  const from = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate())
  if (!range.to) return { from }
  let to = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate())
  if (from > to) {
    return { from: to, to: from }
  }
  return { from, to }
}

/**
 * Year bounds for calendar month/year dropdowns.
 * @param {Array<{ date?: string }>} sales
 */
export function getSalesDateBounds(sales) {
  const dates = (sales ?? []).map((s) => s.date).filter(Boolean).sort()
  const today = new Date()
  const toYear = today.getFullYear()
  const fromYear = dates.length ? Number(dates[0].slice(0, 4)) : toYear - 2
  return {
    fromYear: Math.min(fromYear, toYear),
    toYear,
  }
}

/**
 * @param {{ from?: Date, to?: Date } | undefined} range
 */
export function formatDateRangeLabel(range) {
  if (!range?.from) return "Select start and end dates"
  const opts = { month: "short", day: "numeric", year: "numeric" }
  const from = range.from.toLocaleDateString(undefined, opts)
  if (!range.to) return `${from} → pick end date`
  if (localDateToIso(range.from) === localDateToIso(range.to)) return from
  return `${from} – ${range.to.toLocaleDateString(undefined, opts)}`
}

export function isCompleteDateRange(range) {
  return Boolean(range?.from && range?.to)
}

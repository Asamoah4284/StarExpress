export const FINANCE_TIMEZONE = "Africa/Accra"

/**
 * ISO `YYYY-MM-DD` for today in Africa/Accra.
 */
export function accraTodayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FINANCE_TIMEZONE }).format(new Date())
}

/**
 * @param {string} isoDate YYYY-MM-DD
 */
function parseIsoDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0))
}

/**
 * @param {Date} d
 */
function toIsoDate(d) {
  return d.toISOString().slice(0, 10)
}

/**
 * Tuesday of the finance week containing `isoDate` (Africa/Accra calendar).
 * Finance weeks run Tuesday–Monday and are finalized each Monday at 9pm.
 * @param {string} isoDate
 */
export function getWeekStartFromDate(isoDate) {
  const d = parseIsoDate(isoDate)
  if (!d) return isoDate
  const day = d.getUTCDay()
  const daysSinceTuesday = day === 0 ? 5 : day === 1 ? 6 : day - 2
  d.setUTCDate(d.getUTCDate() - daysSinceTuesday)
  return toIsoDate(d)
}

/**
 * Monday of the finance week that starts on `weekStart` (Tuesday).
 * @param {string} weekStart
 */
export function getWeekEndFromStart(weekStart) {
  const d = parseIsoDate(weekStart)
  if (!d) return weekStart
  d.setUTCDate(d.getUTCDate() + 6)
  return toIsoDate(d)
}

/**
 * How many Tuesday–Monday finance weeks overlap `[fromIso, toIso]` (inclusive).
 * @param {string} fromIso
 * @param {string} toIso
 */
export function countFinanceWeeksInRange(fromIso, toIso) {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (!from || !to) return 1
  const start = from <= to ? fromIso : toIso
  const end = from <= to ? toIso : fromIso
  let cursor = getWeekStartFromDate(start)
  let n = 0
  while (cursor <= end && n < 104) {
    n += 1
    cursor = shiftWeekStart(cursor, 1)
  }
  return Math.max(1, n)
}

/**
 * @param {string} [isoDate] any date in the target week; defaults to Accra today
 * @returns {{ weekStart: string, weekEnd: string }}
 */
export function resolveWeekRange(isoDate) {
  const anchor = isoDate && parseIsoDate(isoDate) ? String(isoDate).trim().slice(0, 10) : accraTodayIso()
  const weekStart = getWeekStartFromDate(anchor)
  const weekEnd = getWeekEndFromStart(weekStart)
  return { weekStart, weekEnd }
}

/**
 * Resolve an explicit from/to range, or fall back to the finance week for `date`.
 * @param {{ date?: string, from?: string, to?: string }} params
 * @returns {{ weekStart: string, weekEnd: string, isFinanceWeek: boolean, lightBillWeeks: number }}
 */
export function resolveFinancePeriod(params = {}) {
  const from = typeof params.from === "string" ? params.from.trim().slice(0, 10) : ""
  const to = typeof params.to === "string" ? params.to.trim().slice(0, 10) : ""
  if (from && to && parseIsoDate(from) && parseIsoDate(to)) {
    const weekStart = from <= to ? from : to
    const weekEnd = from <= to ? to : from
    const tuesday = getWeekStartFromDate(weekStart)
    const monday = getWeekEndFromStart(tuesday)
    const isFinanceWeek = weekStart === tuesday && weekEnd === monday
    return {
      weekStart,
      weekEnd,
      isFinanceWeek,
      lightBillWeeks: countFinanceWeeksInRange(weekStart, weekEnd),
    }
  }
  const range = resolveWeekRange(params.date || undefined)
  return {
    ...range,
    isFinanceWeek: true,
    lightBillWeeks: 1,
  }
}

/**
 * @param {string} weekStart
 * @param {number} [weeks]
 */
export function shiftWeekStart(weekStart, weeks) {
  const d = parseIsoDate(weekStart)
  if (!d) return weekStart
  d.setUTCDate(d.getUTCDate() + weeks * 7)
  return toIsoDate(d)
}

/**
 * The Tuesday–Monday week that ended on the most recent Monday (Accra).
 * On Monday 9pm cron runs, this is the week ending that day.
 * @returns {{ weekStart: string, weekEnd: string }}
 */
export function previousCompletedWeekRange() {
  const today = accraTodayIso()
  const { weekStart, weekEnd } = resolveWeekRange(today)
  const d = parseIsoDate(today)
  if (d && d.getUTCDay() === 1 && weekEnd === today) {
    return { weekStart, weekEnd }
  }
  const prevStart = shiftWeekStart(weekStart, -1)
  return { weekStart: prevStart, weekEnd: getWeekEndFromStart(prevStart) }
}

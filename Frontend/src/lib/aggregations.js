/**
 * Filter sales by location id or null for all.
 * @param {object[]} allSales
 * @param {string|null} locationId
 */
export function filterSalesByLocation(allSales, locationId) {
  if (!locationId || locationId === "all") return allSales
  return allSales.filter((s) => s.locationId === locationId)
}

/**
 * Total inventory units across catalog (active + inactive stock).
 * @param {{ stockUnits: number }[]} packageList
 */
export function totalPackageUnits(packageList) {
  return packageList.reduce((sum, p) => sum + p.stockUnits, 0)
}

/** Latest calendar date present in `rows` (any status), ISO `YYYY-MM-DD`. */
export function getLatestSaleDateStr(rows) {
  if (!rows.length) return new Date().toISOString().slice(0, 10)
  return rows.map((r) => r.date).sort().at(-1)
}

function prevCalendarDayStr(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function completedRevenueOnDate(rows, dateStr) {
  return rows.filter((s) => s.date === dateStr && s.status === "Completed").reduce((sum, s) => sum + s.amount, 0)
}

function salesCountOnDate(rows, dateStr) {
  return rows.filter((s) => s.date === dateStr).length
}

function completedCountOnDate(rows, dateStr) {
  return rows.filter((s) => s.date === dateStr && s.status === "Completed").length
}

/**
 * Day-over-day changes on the latest data date vs the previous calendar day.
 * @param {object[]} filteredSales
 */
export function getDayOverDaySummary(filteredSales) {
  const latestDate = getLatestSaleDateStr(filteredSales)
  const prevDate = prevCalendarDayStr(latestDate)
  return {
    latestDate,
    prevDate,
    revenueDelta: completedRevenueOnDate(filteredSales, latestDate) - completedRevenueOnDate(filteredSales, prevDate),
    salesDelta: salesCountOnDate(filteredSales, latestDate) - salesCountOnDate(filteredSales, prevDate),
    soldDelta: completedCountOnDate(filteredSales, latestDate) - completedCountOnDate(filteredSales, prevDate),
    prevDayCompletedRevenue: completedRevenueOnDate(filteredSales, prevDate),
  }
}

/** Most recent sale date in set — used as "today" for mock KPIs. */
function getReportingDate(rows) {
  return getLatestSaleDateStr(rows)
}

/**
 * Dashboard metrics from filtered sales.
 * utilizationRate = sold / totalInventory * 100 (sold = completed count).
 * @param {object[]} filteredSales
 * @param {{ stockUnits: number }[]} packageList
 */
export function getDashboardMetrics(filteredSales, packageList) {
  const totalInventory = totalPackageUnits(packageList)
  const completed = filteredSales.filter((s) => s.status === "Completed")
  const sold = completed.length
  const pending = filteredSales.filter((s) => s.status === "Pending").length

  const todayStr = getReportingDate(filteredSales)
  const todaySales = filteredSales.filter((s) => s.date === todayStr)
  const todayCompleted = todaySales.filter((s) => s.status === "Completed")

  const totalRevenue = completed.reduce((sum, s) => sum + s.amount, 0)
  const todayRevenue = todayCompleted.reduce((sum, s) => sum + s.amount, 0)

  const available = Math.max(0, totalInventory - sold)
  const utilizationRate =
    totalInventory > 0 ? Math.min(100, Math.round((sold / totalInventory) * 1000) / 10) : 0

  return {
    totalPackages: totalInventory,
    available,
    todaysSales: todaySales.length,
    totalSales: filteredSales.length,
    sold,
    utilizationRate,
    totalRevenue,
    todaysRevenue: todayRevenue,
    pending,
  }
}

/**
 * @param {{ columns?: Record<string, string> } | undefined} v
 * @returns {string} lowercased status cell from CSV columns, or "" if missing
 */
export function voucherStatusNormalized(v) {
  const cols = v?.columns
  if (!cols || typeof cols !== "object") return ""
  for (const k of Object.keys(cols)) {
    const normalized = String(k).replace(/·/g, ".").trim()
    if (/^status$/i.test(normalized)) return String(cols[k] ?? "").trim().toLowerCase()
  }
  return ""
}

/**
 * Vouchers not marked as used (remaining inventory). Unknown / blank status counts as remaining.
 * @param {Array<{ columns?: Record<string, string> }>} vouchers
 */
export function countRemainingVouchers(vouchers) {
  if (!Array.isArray(vouchers)) return 0
  return vouchers.filter((v) => voucherStatusNormalized(v) !== "used").length
}

/**
 * @param {Array<{ locationId?: string }>} vouchers
 * @param {string} locationId `"all"` or a location id
 */
export function filterVouchersByLocation(vouchers, locationId) {
  if (!Array.isArray(vouchers)) return []
  if (!locationId || locationId === "all") return vouchers
  return vouchers.filter((v) => v.locationId === locationId)
}

/** Last 30 days daily revenue by day for line chart (anchored to latest sale date in data). */
export function getRevenueLast30Days(allSales) {
  const completed = allSales.filter((s) => s.status === "Completed")
  const sortedDates = completed.map((s) => s.date).sort()
  const endStr = sortedDates.length ? sortedDates[sortedDates.length - 1] : new Date().toISOString().slice(0, 10)
  const end = new Date(`${endStr}T12:00:00Z`)

  const byDay = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    byDay[key] = 0
  }
  completed.forEach((s) => {
    if (Object.prototype.hasOwnProperty.call(byDay, s.date)) {
      byDay[s.date] += s.amount
    }
  })
  return Object.keys(byDay)
    .sort()
    .map((date) => ({ date, revenue: byDay[date] }))
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Last `monthCount` calendar months of completed revenue (gross), oldest first.
 * Anchored to the latest sale date in `filteredSales`.
 * @param {object[]} filteredSales
 * @param {number} [monthCount]
 * @returns {{ month: string, revenue: number }[]}
 */
export function getMonthlyGrossRevenueTrend(filteredSales, monthCount = 6) {
  const completed = filteredSales.filter((s) => s.status === "Completed")
  const sortedDates = completed.map((s) => s.date).sort()
  const endStr = sortedDates.length ? sortedDates[sortedDates.length - 1] : new Date().toISOString().slice(0, 10)
  const end = new Date(`${endStr}T12:00:00Z`)
  const endYear = end.getUTCFullYear()
  const endMonth = end.getUTCMonth()

  /** @type {{ key: string, month: string, revenue: number }[]} */
  const series = []
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const d = new Date(Date.UTC(endYear, endMonth, 1))
    d.setUTCMonth(d.getUTCMonth() - offset)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    const key = `${y}-${String(m + 1).padStart(2, "0")}`
    series.push({ key, month: SHORT_MONTHS[m], revenue: 0 })
  }

  completed.forEach((s) => {
    const key = s.date.slice(0, 7)
    const row = series.find((r) => r.key === key)
    if (row) row.revenue += s.amount
  })

  return series.map(({ month, revenue }) => ({ month, revenue }))
}

/** Bar chart: sum of sale amounts by location */
export function getSalesByLocation(allSales, locationList) {
  const map = Object.fromEntries(locationList.map((l) => [l.id, { name: l.name, total: 0 }]))
  allSales
    .filter((s) => s.status === "Completed")
    .forEach((s) => {
      if (map[s.locationId]) map[s.locationId].total += s.amount
    })
  return locationList.map((l) => ({
    name: l.name,
    total: map[l.id].total,
  }))
}

/** Pie chart counts by package type */
export function getPackageTypeDistribution(allSales) {
  const counts = {}
  allSales
    .filter((s) => s.status === "Completed")
    .forEach((s) => {
      counts[s.packageType] = (counts[s.packageType] || 0) + 1
    })
  return Object.entries(counts).map(([name, value]) => ({ name, value }))
}

/**
 * Completed revenue by package type (sorted high → low).
 * @param {object[]} filteredSales
 * @returns {{ name: string, revenue: number }[]}
 */
export function getCompletedRevenueByPackageType(filteredSales) {
  const map = {}
  filteredSales
    .filter((s) => s.status === "Completed")
    .forEach((s) => {
      map[s.packageType] = (map[s.packageType] || 0) + s.amount
    })
  return Object.entries(map)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
}

/** Labels Mon → Sun (UTC weekday buckets). */
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/**
 * Sum of completed sale amounts grouped by weekday (UTC), always 7 rows Mon–Sun.
 * @param {object[]} filteredSales
 * @returns {{ name: string, value: number }[]}
 */
export function getCompletedRevenueByWeekday(filteredSales) {
  const completed = filteredSales.filter((s) => s.status === "Completed")
  const sums = [0, 0, 0, 0, 0, 0, 0]
  for (const s of completed) {
    const d = new Date(`${s.date}T12:00:00Z`)
    const sun0 = d.getUTCDay()
    const mon0 = sun0 === 0 ? 6 : sun0 - 1
    sums[mon0] += s.amount
  }
  return WEEKDAY_LABELS.map((name, i) => ({ name, value: sums[i] }))
}

/** Last N calendar days ending at latest sale date in `filteredSales` (ISO date keys). */
function getSparklineEndDate(filteredSales) {
  const dates = filteredSales.map((s) => s.date).sort()
  return dates.length ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10)
}

function dateBuckets(endStr, dayCount) {
  const keys = []
  const end = new Date(`${endStr}T12:00:00Z`)
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

/** Daily completed revenue per day (y), last `dayCount` days — for sparklines. */
export function getSparklineDailyCompletedRevenue(filteredSales, dayCount = 14) {
  const endStr = getSparklineEndDate(filteredSales)
  const keys = dateBuckets(endStr, dayCount)
  const map = Object.fromEntries(keys.map((k) => [k, 0]))
  filteredSales
    .filter((s) => s.status === "Completed")
    .forEach((s) => {
      if (map[s.date] !== undefined) map[s.date] += s.amount
    })
  return keys.map((date) => ({ x: date, y: map[date] }))
}

/** Cumulative completed revenue over the same window (running sum). */
export function getSparklineCumulativeRevenue(filteredSales, dayCount = 14) {
  const daily = getSparklineDailyCompletedRevenue(filteredSales, dayCount)
  let run = 0
  return daily.map((d) => ({ x: d.x, y: (run += d.y) }))
}

/** Count of all sales per day (any status). */
export function getSparklineDailySalesCount(filteredSales, dayCount = 14) {
  const endStr = getSparklineEndDate(filteredSales)
  const keys = dateBuckets(endStr, dayCount)
  const map = Object.fromEntries(keys.map((k) => [k, 0]))
  filteredSales.forEach((s) => {
    if (map[s.date] !== undefined) map[s.date] += 1
  })
  return keys.map((date) => ({ x: date, y: map[date] }))
}

/** Count of completed sales per day. */
export function getSparklineDailySoldCount(filteredSales, dayCount = 14) {
  const endStr = getSparklineEndDate(filteredSales)
  const keys = dateBuckets(endStr, dayCount)
  const map = Object.fromEntries(keys.map((k) => [k, 0]))
  filteredSales
    .filter((s) => s.status === "Completed")
    .forEach((s) => {
      if (map[s.date] !== undefined) map[s.date] += 1
    })
  return keys.map((date) => ({ x: date, y: map[date] }))
}

/** Export CSV rows from sales */
export function salesToCsv(rows) {
  const header = [
    "id",
    "customerName",
    "customerPhone",
    "paymentNumber",
    "packageType",
    "amount",
    "locationId",
    "date",
    "status",
  ]
  const lines = [header.join(",")]
  for (const r of rows) {
    lines.push(
      [
        r.id,
        `"${String(r.customerName).replace(/"/g, '""')}"`,
        `"${String(r.customerPhone ?? "").replace(/"/g, '""')}"`,
        `"${String(r.paymentNumber ?? "").replace(/"/g, '""')}"`,
        `"${String(r.packageType).replace(/"/g, '""')}"`,
        r.amount,
        r.locationId,
        r.date,
        r.status,
      ].join(","),
    )
  }
  return lines.join("\n")
}

/**
 * Round to 2 decimal places (matches backend finance money rounding).
 * @param {number} n
 */
function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Net profit for a report date range using the same rules as Finance:
 * tithe 10% of gross, light bill per location, manager fee 20% of remainder, minus expenses.
 *
 * @param {{
 *   sales: Array<{ status?: string, locationId?: string, amount?: number }>,
 *   locations: Array<{ id: string, name?: string, commissionRate?: number, lightBillAmount?: number }>,
 *   expenses?: Array<{ amount?: number, locationId?: string | null }>,
 *   locationId?: string | null,
 * }} args
 */
export function computeReportNetProfit({ sales, locations, expenses = [], locationId }) {
  const scopeAll = !locationId || locationId === "all"
  const locs = scopeAll ? locations : locations.filter((l) => l.id === locationId)

  /** @type {Map<string, number>} */
  const revenueByLoc = new Map()
  for (const sale of sales ?? []) {
    if (sale.status !== "Completed") continue
    const id = typeof sale.locationId === "string" ? sale.locationId : ""
    if (!id) continue
    if (!scopeAll && id !== locationId) continue
    revenueByLoc.set(id, roundMoney((revenueByLoc.get(id) || 0) + (Number(sale.amount) || 0)))
  }

  let totalNet = 0
  let totalLocationExpenses = 0

  for (const loc of locs) {
    const gross = revenueByLoc.get(loc.id) ?? 0
    const tithe = roundMoney(gross * 0.1)
    const lightRaw = loc.lightBillAmount
    const light =
      lightRaw !== undefined && lightRaw !== null
        ? roundMoney(Math.max(0, Number(lightRaw) || 0))
        : String(loc.name || "")
              .toUpperCase()
              .includes("OUTDOOR")
          ? 0
          : 50
    const remainder = roundMoney(Math.max(0, gross - tithe - light))
    const rate = Number.isFinite(Number(loc.commissionRate)) ? Number(loc.commissionRate) : 20
    const managerFee = roundMoney(remainder * (rate / 100))
    const locExpenses = roundMoney(
      (expenses ?? [])
        .filter((e) => e.locationId != null && String(e.locationId) === loc.id)
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    )
    totalLocationExpenses += locExpenses
    totalNet += roundMoney(gross - tithe - light - managerFee - locExpenses)
  }

  const generalExpenses = scopeAll
    ? roundMoney(
        (expenses ?? [])
          .filter((e) => e.locationId == null || e.locationId === "")
          .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
      )
    : 0

  return roundMoney(totalNet - generalExpenses)
}

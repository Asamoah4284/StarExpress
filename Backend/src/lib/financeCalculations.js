import { hostelCommissionRateFromDoc, lightBillAmountFromDoc, DEFAULT_HOSTEL_COMMISSION_RATE } from "./locationCommission.js"
import { roundMoney } from "./promoDiscount.js"

/** Share of gross revenue set aside as tithe. */
export const TITHE_RATE = 0.1

export const EXPENSE_CATEGORIES = [
  "data_bundle",
  "router_hardware",
  "starlink_subscription",
  "maintenance",
  "transport",
  "other",
]

/**
 * Tithe = 10% of gross revenue for a location.
 * @param {number} grossRevenue
 */
export function calcTithe(grossRevenue) {
  const gross = Number(grossRevenue) || 0
  return roundMoney(gross * TITHE_RATE)
}

/**
 * Light bill for a location over one or more finance weeks.
 * @param {number} amountPerWeek
 * @param {number} [weeks]
 */
export function calcLightBill(amountPerWeek, weeks = 1) {
  const amount = Math.max(0, Number(amountPerWeek) || 0)
  const w = Math.max(1, Math.floor(Number(weeks) || 1))
  return roundMoney(amount * w)
}

/**
 * Amount left after tithe and light bill (never below 0 for manager-fee base).
 * @param {number} grossRevenue
 * @param {number} tithe
 * @param {number} lightBill
 */
export function calcRemainderAfterTitheAndLight(grossRevenue, tithe, lightBill) {
  return roundMoney(
    Math.max(0, (Number(grossRevenue) || 0) - (Number(tithe) || 0) - (Number(lightBill) || 0)),
  )
}

/**
 * Hostel manager fee = commissionRate% of the remainder after tithe and light bill.
 * Default rate is 20%.
 * @param {number} remainder
 * @param {number} [commissionRate] percent 0–100
 */
export function calcHostelPayout(remainder, commissionRate = DEFAULT_HOSTEL_COMMISSION_RATE) {
  const base = Number(remainder) || 0
  const rate = Number(commissionRate)
  const pct = Number.isFinite(rate) ? rate : DEFAULT_HOSTEL_COMMISSION_RATE
  return roundMoney(base * (pct / 100))
}

/**
 * @param {number} grossRevenue
 * @param {number} tithe
 * @param {number} lightBill
 * @param {number} hostelPayout
 * @param {number} expenseTotal
 */
export function calcNetProfit(grossRevenue, tithe, lightBill, hostelPayout, expenseTotal) {
  return roundMoney(
    (Number(grossRevenue) || 0) -
      (Number(tithe) || 0) -
      (Number(lightBill) || 0) -
      (Number(hostelPayout) || 0) -
      (Number(expenseTotal) || 0),
  )
}

/**
 * @param {import("mongodb").Collection} sales
 * @param {string} weekStart
 * @param {string} weekEnd
 */
export async function aggregateGrossRevenueByLocation(sales, weekStart, weekEnd) {
  const rows = await sales
    .aggregate([
      {
        $match: {
          status: "Completed",
          date: { $gte: weekStart, $lte: weekEnd },
          locationId: { $exists: true, $nin: [null, ""] },
        },
      },
      { $group: { _id: "$locationId", grossRevenue: { $sum: "$amount" } } },
    ])
    .toArray()

  /** @type {Map<string, number>} */
  const map = new Map()
  for (const row of rows) {
    const id = String(row._id || "")
    if (!id) continue
    map.set(id, roundMoney(Number(row.grossRevenue) || 0))
  }
  return map
}

/**
 * @param {import("mongodb").Collection} expenses
 * @param {string} weekStart
 * @param {string} weekEnd
 */
export async function aggregateExpensesByLocation(expenses, weekStart, weekEnd) {
  const rows = await expenses
    .aggregate([
      { $match: { date: { $gte: weekStart, $lte: weekEnd } } },
      {
        $group: {
          _id: { $ifNull: ["$locationId", null] },
          expenseTotal: { $sum: "$amount" },
        },
      },
    ])
    .toArray()

  /** @type {Map<string | null, number>} */
  const map = new Map()
  for (const row of rows) {
    const key = row._id == null ? null : String(row._id)
    map.set(key, roundMoney(Number(row.expenseTotal) || 0))
  }
  return map
}

/**
 * @param {import("mongodb").Collection} locations
 * @param {import("mongodb").Collection} sales
 * @param {import("mongodb").Collection} expenses
 * @param {string} weekStart period start YYYY-MM-DD
 * @param {string} weekEnd period end YYYY-MM-DD
 * @param {number} [lightBillWeeks] overlapping finance weeks (for light bill)
 */
export async function buildWeeklyFinanceSummary(
  locations,
  sales,
  expenses,
  weekStart,
  weekEnd,
  lightBillWeeks = 1,
) {
  const [locationDocs, revenueByLoc, expenseByLoc] = await Promise.all([
    locations.find({}).sort({ name: 1 }).toArray(),
    aggregateGrossRevenueByLocation(sales, weekStart, weekEnd),
    aggregateExpensesByLocation(expenses, weekStart, weekEnd),
  ])

  /** @type {Array<{
   *   locationId: string,
   *   name: string,
   *   commissionRate: number,
   *   grossRevenue: number,
   *   tithe: number,
   *   lightBillAmount: number,
   *   lightBill: number,
   *   remainder: number,
   *   hostelPayout: number,
   *   expenseTotal: number,
   *   netProfit: number,
   * }>} */
  const perLocation = []

  let totalGross = 0
  let totalPayout = 0
  let totalTithe = 0
  let totalLightBill = 0
  let totalLocationExpenses = 0
  const weeks = Math.max(1, Math.floor(Number(lightBillWeeks) || 1))

  for (const loc of locationDocs) {
    const locationId = String(loc._id)
    const commissionRate = hostelCommissionRateFromDoc(loc)
    const lightBillAmount = lightBillAmountFromDoc(loc)
    const grossRevenue = revenueByLoc.get(locationId) ?? 0
    const tithe = calcTithe(grossRevenue)
    const lightBill = calcLightBill(lightBillAmount, weeks)
    const remainder = calcRemainderAfterTitheAndLight(grossRevenue, tithe, lightBill)
    const hostelPayout = calcHostelPayout(remainder, commissionRate)
    const expenseTotal = expenseByLoc.get(locationId) ?? 0
    const netProfit = calcNetProfit(grossRevenue, tithe, lightBill, hostelPayout, expenseTotal)

    perLocation.push({
      locationId,
      name: typeof loc.name === "string" ? loc.name : locationId,
      commissionRate,
      lightBillAmount,
      grossRevenue,
      tithe,
      lightBill,
      remainder,
      hostelPayout,
      expenseTotal,
      netProfit,
    })

    totalGross += grossRevenue
    totalPayout += hostelPayout
    totalTithe += tithe
    totalLightBill += lightBill
    totalLocationExpenses += expenseTotal
  }

  const generalExpenses = expenseByLoc.get(null) ?? 0
  const totalExpenses = roundMoney(totalLocationExpenses + generalExpenses)
  const netProfit = roundMoney(
    roundMoney(totalGross) -
      roundMoney(totalTithe) -
      roundMoney(totalLightBill) -
      roundMoney(totalPayout) -
      totalExpenses,
  )

  return {
    weekStart,
    weekEnd,
    timezone: "Africa/Accra",
    locations: perLocation,
    totals: {
      grossRevenue: roundMoney(totalGross),
      tithe: roundMoney(totalTithe),
      lightBill: roundMoney(totalLightBill),
      hostelPayout: roundMoney(totalPayout),
      locationExpenses: roundMoney(totalLocationExpenses),
      generalExpenses,
      expenses: totalExpenses,
      netProfit,
    },
  }
}

import { buildWeeklyFinanceSummary } from "./financeCalculations.js"
import { FINANCE_TIMEZONE, previousCompletedWeekRange } from "./financeWeek.js"

/**
 * Compute and store the finalized weekly summary for the week that just ended.
 * @param {{
 *   locations: import("mongodb").Collection,
 *   sales: import("mongodb").Collection,
 *   expenses: import("mongodb").Collection,
 *   financeWeeklySnapshots: import("mongodb").Collection,
 * }} deps
 */
export async function finalizePreviousWeek(deps) {
  const { locations, sales, expenses, financeWeeklySnapshots } = deps
  const { weekStart, weekEnd } = previousCompletedWeekRange()
  const summary = await buildWeeklyFinanceSummary(locations, sales, expenses, weekStart, weekEnd)
  const finalizedAt = new Date().toISOString()

  await financeWeeklySnapshots.updateOne(
    { weekStart },
    {
      $set: {
        weekStart,
        weekEnd,
        finalizedAt,
        timezone: FINANCE_TIMEZONE,
        locations: summary.locations,
        totals: summary.totals,
      },
    },
    { upsert: true },
  )

  const payoutSummary = summary.locations
    .filter((l) => l.hostelPayout > 0)
    .map((l) => `${l.name}: GH₵${l.hostelPayout}`)
    .join(", ")

  console.info(
    `[finance-cron] finalized week ${weekStart}–${weekEnd} | net GH₵${summary.totals.netProfit}${
      payoutSummary ? ` | payouts: ${payoutSummary}` : ""
    }`,
  )

  return { weekStart, weekEnd, finalizedAt, totals: summary.totals }
}
